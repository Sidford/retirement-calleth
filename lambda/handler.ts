import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { stageForDays, progressPct, fucksToGivePct, renderEmail, monthsAndDaysUntil, monthsDaysPhrase } from "./email";
import { workingDaysUntilRetirement } from "./workingDays";
import { getBookedHolidays } from "./holidays";

const bedrock = new BedrockRuntimeClient({});
const ses = new SESClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const RETIREMENT_DATE = process.env.RETIREMENT_DATE as string;
const SENDER_EMAIL = process.env.SENDER_EMAIL as string;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL as string;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID as string;
const TABLE_NAME = process.env.TABLE_NAME as string;
const COUNTDOWN_START_DATE = process.env.COUNTDOWN_START_DATE as string;
const NON_WORKING_FRIDAY_ANCHOR = process.env.NON_WORKING_FRIDAY_ANCHOR as string;
const HISTORY_KEY = "HISTORY";
const MAX_HISTORY = 10;

async function daysLeft(bookedHolidays: Set<number>): Promise<number> {
  return workingDaysUntilRetirement(
    RETIREMENT_DATE,
    NON_WORKING_FRIDAY_ANCHOR,
    new Date(),
    bookedHolidays
  );
}

async function getRecentJokes(): Promise<string[]> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { date: HISTORY_KEY } }));
  return (res.Item?.jokes as string[]) ?? [];
}

async function saveJoke(joke: string, recent: string[]): Promise<void> {
  const updated = [...recent, joke].slice(-MAX_HISTORY);
  await ddb.send(
    new PutCommand({ TableName: TABLE_NAME, Item: { date: HISTORY_KEY, jokes: updated } })
  );
  // Also keep a per-day record for 90 days, handy for debugging
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { date: new Date().toISOString().slice(0, 10), joke, ttl },
    })
  );
}

async function generateJoke(
  days: number,
  monthsRemaining: number,
  daysRemainder: number,
  recentJokes: string[]
): Promise<string> {
  const tone = stageForDays(days).tone;
  const fucksPct = fucksToGivePct(days);
  const avoid = recentJokes.length
    ? `Avoid repeating the style or punchline of these recent messages:\n${recentJokes
        .map((j) => `- ${j}`)
        .join("\n")}`
    : "";

  const systemPrompt =
    "You write short, funny daily countdown emails for someone counting down to their retirement. " +
    "Keep it to 2-4 sentences. Make it a piss-take — sarcastic, irreverent, tongue-in-cheek. " +
    "Mock office culture, corporate nonsense, or the existential dread of work. Be sharp, not corny. No hashtags.";

  const userPrompt =
    `Days remaining until retirement: ${days}. ` +
    `On the calendar, that's ${monthsDaysPhrase(monthsRemaining, daysRemainder)} left. ` +
    `Tone for today: ${tone} ` +
    `The user also has a "F**ks left to give" meter reading ${fucksPct}%, tracking how much they still care about doing a good job — ` +
    `it starts near 100% (still trying, still giving a damn) and craters toward 0% as retirement approaches (checked out, running on autopilot, ` +
    `can no longer be bothered pretending to care). Let the joke's attitude reflect where that meter currently sits, on top of the tone above. ${avoid}`;

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const response = await bedrock.send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body));
  return payload.content?.[0]?.text?.trim() ?? "Countdown joke generator took the day off.";
}

async function sendEmail(
  days: number,
  monthsRemaining: number,
  daysRemainder: number,
  joke: string
): Promise<void> {
  const stage = stageForDays(days);
  const pct = progressPct(COUNTDOWN_START_DATE, RETIREMENT_DATE, new Date());
  const { subject, html, text } = renderEmail({ days, joke, stage, pct, monthsRemaining, daysRemainder });

  await ses.send(
    new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: { ToAddresses: [RECIPIENT_EMAIL] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html }, Text: { Data: text } },
      },
    })
  );
}

export async function handler(): Promise<void> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const bookedHolidays = await getBookedHolidays(todayIso, RETIREMENT_DATE);

  const days = await daysLeft(bookedHolidays);
  const { months: monthsRemaining, days: daysRemainder } = monthsAndDaysUntil(todayIso, RETIREMENT_DATE);
  const recentJokes = await getRecentJokes();
  const joke = await generateJoke(days, monthsRemaining, daysRemainder, recentJokes);

  await sendEmail(days, monthsRemaining, daysRemainder, joke);
  await saveJoke(joke, recentJokes);
}
