# Month countdown in the email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a calendar-based "N months, D days to go" headline to the retirement countdown email, with the existing working-days count demoted to a secondary caption, and feed the same figure into the Bedrock joke prompt.

**Architecture:** One new pure function (`monthsAndDaysUntil`) computes the calendar months/days remaining from two ISO date strings, matching the existing pattern of `progressPct`. `renderEmail` takes the result as two new `RenderInput` fields and renders it in the hero block, a new secondary caption, and the text body. `handler.ts` computes the figure once per run and threads it into both `generateJoke` (prompt flavour) and `renderEmail` (display).

**Tech Stack:** TypeScript, Jest (`ts-jest`), no new dependencies.

## Global Constraints

- `stageForDays`, `fucksToGivePct`, and the subject-line logic are **not**
  touched — they stay keyed on working days exactly as today.
- The new calculation is **calendar-based** (weekends/holidays count),
  deliberately different from the working-days figure.
- No new CDK context, environment variables, or infrastructure changes.
- English pluralisation only (`month`/`months`, `day`/`days`), matching the
  existing `unit` handling for working days.
- `renderEmail` and `monthsAndDaysUntil` stay pure and AWS-free — no new
  mocking needed in tests.

---

### Task 1: `monthsAndDaysUntil` calendar calculation

**Files:**
- Modify: `lambda/email.ts` (add function near `progressPct`, currently at `lambda/email.ts:97-112`)
- Test: `lambda/email.test.ts` (add new `describe("monthsAndDaysUntil", ...)` block after the existing `progressPct` block, currently ending at `lambda/email.test.ts:86`)

**Interfaces:**
- Produces: `export function monthsAndDaysUntil(fromISO: string, toISO: string): { months: number; days: number }` — used by Task 2 (via `RenderInput`, supplied by the caller) and Task 3 (`handler.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `lambda/email.test.ts`, after the closing `});` of the `progressPct` describe block:

```ts
describe("monthsAndDaysUntil", () => {
  it("returns a whole number of months with no leftover days", () => {
    expect(monthsAndDaysUntil("2026-01-15", "2026-07-15")).toEqual({ months: 6, days: 0 });
  });
  it("returns months plus leftover days", () => {
    expect(monthsAndDaysUntil("2026-01-15", "2026-07-27")).toEqual({ months: 6, days: 12 });
  });
  it("borrows the correct day count from the preceding month, including across a leap-year February", () => {
    expect(monthsAndDaysUntil("2028-02-15", "2028-03-10")).toEqual({ months: 0, days: 24 });
  });
  it("returns days only within the same calendar month", () => {
    expect(monthsAndDaysUntil("2026-06-01", "2026-06-20")).toEqual({ months: 0, days: 19 });
  });
  it("returns zero for the same day", () => {
    expect(monthsAndDaysUntil("2026-06-01", "2026-06-01")).toEqual({ months: 0, days: 0 });
  });
  it("clamps to zero when the target date is not after the start date", () => {
    expect(monthsAndDaysUntil("2026-07-01", "2026-06-01")).toEqual({ months: 0, days: 0 });
  });
});
```

Also update the import at the top of `lambda/email.test.ts`:

```ts
import { stageForDays, progressPct, monthsAndDaysUntil, fucksToGivePct, renderEmail } from "./email";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- email.test.ts`
Expected: FAIL — `monthsAndDaysUntil is not a function` / TypeScript error that it doesn't exist.

- [ ] **Step 3: Implement `monthsAndDaysUntil`**

In `lambda/email.ts`, add immediately after the `progressPct` function (after line 112, before the `RenderInput` interface):

```ts
function parseIsoParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month - 1, day };
}

export function monthsAndDaysUntil(fromISO: string, toISO: string): { months: number; days: number } {
  const from = parseIsoParts(fromISO);
  const to = parseIsoParts(toISO);

  let months = (to.year - from.year) * 12 + (to.month - from.month);
  let days = to.day - from.day;

  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(to.year, to.month, 0)).getUTCDate();
  }

  if (months < 0) {
    return { months: 0, days: 0 };
  }

  return { months, days };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- email.test.ts`
Expected: PASS (all `monthsAndDaysUntil` tests green; pre-existing tests still pass since nothing else changed yet).

- [ ] **Step 5: Commit**

```bash
git add lambda/email.ts lambda/email.test.ts
git commit -m "feat: add monthsAndDaysUntil calendar countdown calculation"
```

---

### Task 2: Render months/days headline and working-days caption

**Files:**
- Modify: `lambda/email.ts` (`RenderInput` interface at `lambda/email.ts:114-119`, `renderEmail` function at `lambda/email.ts:137-227`)
- Test: `lambda/email.test.ts` (`renderEmail` describe block, `lambda/email.test.ts:88-152`)

**Interfaces:**
- Consumes: `monthsAndDaysUntil` from Task 1 only for its return shape (`{ months: number; days: number }`) — `renderEmail` itself takes plain numbers, it does not call `monthsAndDaysUntil`.
- Produces: `RenderInput` gains `monthsRemaining: number` and `daysRemainder: number` (both required). `renderEmail`'s return shape (`RenderedEmail`) is unchanged. New exported helper: `export function monthsDaysPhrase(months: number, days: number): string` (e.g. `"6 months, 12 days"`, `"6 months"`, `"12 days"`) — consumed by Task 3 for the joke prompt.

- [ ] **Step 1: Write the failing tests**

In `lambda/email.test.ts`, every existing `renderEmail({...})` call must gain `monthsRemaining` and `daysRemainder`. Replace the entire `describe("renderEmail", ...)` block (`lambda/email.test.ts:88-152`) with:

```ts
describe("renderEmail", () => {
  it("far-off email: hero number, joke, progress, plain subject", () => {
    const stage = stageForDays(621);
    const out = renderEmail({
      days: 621,
      joke: "Only 621 sleeps left.",
      stage,
      pct: 43,
      monthsRemaining: 20,
      daysRemainder: 15,
    });
    expect(out.subject).toBe("🗓️ 621 working days to go");
    expect(out.html).toContain(`>20 ${stage.emoji}<`);
    expect(out.html).toContain(">months, 15 days to go<");
    expect(out.html).toContain("621 working days to go");
    expect(out.html).toContain("Only 621 sleeps left.");
    expect(out.html).toContain("43% of the way there");
    expect(out.html).toContain(stage.accent);
    expect(out.text).toContain("20 months, 15 days until retirement");
    expect(out.text).toContain("621 working days to go");
    expect(out.text).toContain("Only 621 sleeps left.");
    expect(out.text).toContain("— your retirement countdown bot");
  });

  it("final-week email: ALL-CAPS subject with bangs", () => {
    const stage = stageForDays(3);
    const out = renderEmail({
      days: 3,
      joke: "Three. More. Days.",
      stage,
      pct: 98,
      monthsRemaining: 0,
      daysRemainder: 3,
    });
    expect(out.subject).toBe("🎉 3 WORKING DAYS TO GO!!!");
  });

  it("the day: celebratory subject and heading, no months line or working-days caption", () => {
    const stage = stageForDays(0);
    const out = renderEmail({
      days: 0,
      joke: "Go!",
      stage,
      pct: 100,
      monthsRemaining: 0,
      daysRemainder: 0,
    });
    expect(out.subject).toBe("🥳 TODAY'S THE DAY!");
    expect(out.html).toContain("TODAY'S THE DAY");
    expect(out.text).toContain("TODAY'S THE DAY");
    expect(out.html).toContain("Congratulations — you made it.");
    expect(out.html).toContain("text-transform:none;");
    expect(out.html).not.toContain("months");
    expect(out.html).not.toContain("working day");
    expect(out.text).not.toContain("working day");
  });

  it("escapes HTML in the joke", () => {
    const stage = stageForDays(200);
    const out = renderEmail({
      days: 200,
      joke: "<script>alert(1)</script>",
      stage,
      pct: 10,
      monthsRemaining: 6,
      daysRemainder: 15,
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("uses singular unit for one day", () => {
    const stage = stageForDays(1);
    const out = renderEmail({
      days: 1,
      joke: "!",
      stage,
      pct: 99,
      monthsRemaining: 0,
      daysRemainder: 1,
    });
    expect(out.subject).toBe("🎉 1 WORKING DAY TO GO!!!");
  });

  it("hero and caption use singular wording at the 1/1 boundary", () => {
    const stage = stageForDays(1);
    const out = renderEmail({
      days: 1,
      joke: "!",
      stage,
      pct: 99,
      monthsRemaining: 0,
      daysRemainder: 1,
    });
    expect(out.html).toContain(">day to go<");
    expect(out.html).not.toContain("days to go");
    expect(out.html).toContain("1 working day to go");
    expect(out.html).not.toContain("1 working days to go");
  });

  it("hero omits the day clause when leftover days is zero", () => {
    const stage = stageForDays(180);
    const out = renderEmail({
      days: 180,
      joke: "!",
      stage,
      pct: 40,
      monthsRemaining: 6,
      daysRemainder: 0,
    });
    expect(out.html).toContain(`>6 ${stage.emoji}<`);
    expect(out.html).toContain(">months to go<");
    expect(out.html).not.toContain("0 days to go");
  });

  it("hero falls back to days-only phrasing in the final month", () => {
    const stage = stageForDays(15);
    const out = renderEmail({
      days: 15,
      joke: "!",
      stage,
      pct: 90,
      monthsRemaining: 0,
      daysRemainder: 18,
    });
    expect(out.html).toContain(`>18 ${stage.emoji}<`);
    expect(out.html).toContain(">days to go<");
    expect(out.html).not.toContain("months");
  });

  it("hero uses singular month wording at the 1 month boundary", () => {
    const stage = stageForDays(25);
    const out = renderEmail({
      days: 25,
      joke: "!",
      stage,
      pct: 95,
      monthsRemaining: 1,
      daysRemainder: 1,
    });
    expect(out.html).toContain(`>1 ${stage.emoji}<`);
    expect(out.html).toContain(">month, 1 day to go<");
  });

  it("includes the F**ks-to-give meter in HTML and text", () => {
    const stage = stageForDays(30);
    const out = renderEmail({
      days: 30,
      joke: "Whatever.",
      stage,
      pct: 50,
      monthsRemaining: 1,
      daysRemainder: 2,
    });
    expect(out.html).toContain("63% F**ks left to give");
    expect(out.text).toContain("63% F**ks left to give");
  });

  it("F**ks-to-give meter reaches 0% on the day", () => {
    const stage = stageForDays(0);
    const out = renderEmail({
      days: 0,
      joke: "Go!",
      stage,
      pct: 100,
      monthsRemaining: 0,
      daysRemainder: 0,
    });
    expect(out.html).toContain("0% F**ks left to give");
    expect(out.text).toContain("0% F**ks left to give");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- email.test.ts`
Expected: FAIL — TypeScript errors (`monthsRemaining`/`daysRemainder` missing from `RenderInput`) and/or assertion failures against the old hero/caption text.

- [ ] **Step 3: Implement the rendering changes**

In `lambda/email.ts`, update the `RenderInput` interface (currently `lambda/email.ts:114-119`):

```ts
export interface RenderInput {
  days: number;
  joke: string;
  stage: Stage;
  pct: number;
  monthsRemaining: number;
  daysRemainder: number;
}
```

Add these helpers directly above `renderEmail` (after the `escapeHtml` function):

```ts
function monthWord(n: number): string {
  return n === 1 ? "month" : "months";
}

function dayWord(n: number): string {
  return n === 1 ? "day" : "days";
}

export function monthsDaysPhrase(months: number, days: number): string {
  if (months > 0) {
    return days > 0
      ? `${months} ${monthWord(months)}, ${days} ${dayWord(days)}`
      : `${months} ${monthWord(months)}`;
  }
  return `${days} ${dayWord(days)}`;
}

function heroSubheading(months: number, days: number): string {
  if (months > 0) {
    return days > 0
      ? `${monthWord(months)}, ${days} ${dayWord(days)} to go`
      : `${monthWord(months)} to go`;
  }
  return `${dayWord(days)} to go`;
}
```

Replace the body of `renderEmail` (currently `lambda/email.ts:137-227`) with:

```ts
export function renderEmail({
  days,
  joke,
  stage,
  pct,
  monthsRemaining,
  daysRemainder,
}: RenderInput): RenderedEmail {
  const unit = days === 1 ? "working day" : "working days";
  const fucksPct = fucksToGivePct(days);

  let subject: string;
  if (stage.key === "theday") {
    subject = `${stage.subjectPrefix} TODAY'S THE DAY!`;
  } else {
    const core = `${days} ${unit} to go`;
    subject = stage.allCaps
      ? `${stage.subjectPrefix} ${core.toUpperCase()}!!!`
      : `${stage.subjectPrefix} ${core}`;
  }

  const heroNumber = monthsRemaining > 0 ? monthsRemaining : daysRemainder;
  const heading =
    stage.key === "theday"
      ? `TODAY'S THE DAY ${stage.emoji}`
      : `${heroNumber} ${stage.emoji}`;
  const subheading =
    stage.key === "theday"
      ? "Congratulations — you made it."
      : heroSubheading(monthsRemaining, daysRemainder);
  // The short stage labels ("day to go") read well in caps; the celebratory
  // sentence does not, so only the label stages get the uppercase treatment.
  const subheadingTransform = stage.key === "theday" ? "none" : "uppercase";

  const safeJoke = escapeHtml(joke);
  const workingDaysCaption = `${days} ${unit} to go`;

  const text = [
    stage.key === "theday"
      ? `TODAY'S THE DAY! ${stage.emoji}`
      : `${monthsDaysPhrase(monthsRemaining, daysRemainder)} until retirement`,
    ...(stage.key === "theday" ? [] : [workingDaysCaption]),
    "",
    `"${joke}"`,
    "",
    `${pct}% of the way there`,
    `${fucksPct}% F**ks left to give`,
    "",
    "— your retirement countdown bot",
  ].join("\n");

  const captionRow =
    stage.key === "theday"
      ? ""
      : `<tr>
          <td align="center" style="padding:16px 28px 0 28px;font-size:14px;color:#64748b;">${workingDaysCaption}</td>
        </tr>`;

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.12);">
        <tr>
          <td align="center" style="background:${stage.accent};background-image:${stage.gradient};padding:40px 24px;">
            <div style="font-size:64px;line-height:1;font-weight:800;color:#ffffff;">${heading}</div>
            <div style="font-size:16px;color:#ffffff;opacity:0.9;margin-top:8px;letter-spacing:1px;text-transform:${subheadingTransform};">${subheading}</div>
          </td>
        </tr>
        ${captionRow}
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <div style="border-left:4px solid ${stage.accent};background:#f8fafc;border-radius:8px;padding:16px 18px;font-size:18px;line-height:1.5;color:#0f172a;">${safeJoke}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 28px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e2e8f0;border-radius:999px;">
              <tr><td style="padding:0;">
                <table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0">
                  <tr><td style="background:${stage.accent};height:12px;border-radius:999px;font-size:0;line-height:0;">&nbsp;</td></tr>
                </table>
              </td></tr>
            </table>
            <div style="font-size:13px;color:#64748b;margin-top:8px;text-align:right;">${pct}% of the way there</div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e2e8f0;border-radius:999px;">
              <tr><td style="padding:0;">
                <table role="presentation" width="${fucksPct}%" cellpadding="0" cellspacing="0">
                  <tr><td style="background:${FUCKS_METER_COLOR};height:12px;border-radius:999px;font-size:0;line-height:0;">&nbsp;</td></tr>
                </table>
              </td></tr>
            </table>
            <div style="font-size:13px;color:#64748b;margin-top:8px;text-align:right;">${fucksPct}% F**ks left to give</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 28px 28px 28px;font-size:12px;color:#94a3b8;">— your retirement countdown bot</td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- email.test.ts`
Expected: PASS (all `renderEmail` tests, plus `stageForDays`/`fucksToGivePct`/`progressPct`/`monthsAndDaysUntil` tests, green).

- [ ] **Step 5: Commit**

```bash
git add lambda/email.ts lambda/email.test.ts
git commit -m "feat: render months/days countdown headline with working-days caption"
```

---

### Task 3: Wire the countdown into the Lambda handler and joke prompt

**Files:**
- Modify: `lambda/handler.ts` (import at line 5, `generateJoke` at lines 52-88, `sendEmail` at lines 90-105, `handler()` at lines 107-121)

**Interfaces:**
- Consumes: `monthsAndDaysUntil(fromISO: string, toISO: string): { months: number; days: number }` and `monthsDaysPhrase(months: number, days: number): string` from `./email` (Tasks 1 & 2). `renderEmail`'s `RenderInput` now requires `monthsRemaining`/`daysRemainder` (Task 2).
- Produces: no new exports — `handler()` remains the sole Lambda entry point with an unchanged signature (`(): Promise<void>`).

- [ ] **Step 1: Update the import**

In `lambda/handler.ts`, change line 5:

```ts
import { stageForDays, progressPct, fucksToGivePct, renderEmail, monthsAndDaysUntil, monthsDaysPhrase } from "./email";
```

- [ ] **Step 2: Thread the figure through `generateJoke`**

Replace the `generateJoke` function (currently `lambda/handler.ts:52-88`) with:

```ts
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
```

- [ ] **Step 3: Thread the figure through `sendEmail`**

Replace the `sendEmail` function (currently `lambda/handler.ts:90-105`) with:

```ts
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
```

- [ ] **Step 4: Compute the figure once per run in `handler()`**

Replace `handler()` (currently `lambda/handler.ts:107-121`) with:

```ts
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
```

- [ ] **Step 5: Type-check and run the full test suite**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (confirms `handler.ts` compiles against the updated `email.ts` signatures).

Run: `npm test`
Expected: PASS — all suites (`email.test.ts`, `workingDays.test.ts`, `holidays.test.ts`) green. `handler.ts` has no dedicated unit tests (it's an AWS-orchestration wrapper, consistent with the rest of the codebase), so the build + full suite is the verification for this task.

- [ ] **Step 6: Commit**

```bash
git add lambda/handler.ts
git commit -m "feat: pass calendar months/days countdown to email and joke prompt"
```

---

### Task 4: Document the new headline in the README

**Files:**
- Modify: `README.md` (paragraph after the F**ks-to-Give meter description, currently `README.md:22-28`; test-coverage summary, currently `README.md:145-150`)

**Interfaces:**
- Consumes: none (documentation only).
- Produces: none.

- [ ] **Step 1: Add a paragraph describing the new headline**

In `README.md`, immediately after the existing paragraph that ends `...the existing countdown-stage tone.` (end of the F**ks-to-Give meter paragraph, line 28), add:

```markdown

The email's headline leads with a calendar-based countdown — **N months,
D days to go** — computed from today's date to the retirement date via
`monthsAndDaysUntil` in [lambda/email.ts](lambda/email.ts). The working-days
count (which still drives the mood stage and the F**ks-to-Give meter) is
shown underneath as a secondary line.
```

- [ ] **Step 2: Update the test-coverage summary**

In `README.md`, in the "Run the tests" section, change the sentence (currently ending `...HTML/text output).`) to:

```markdown
Covers the working-day calculation (`lambda/workingDays.ts`: UK bank
holidays, Christmas closure, the fortnightly Friday, booked holidays, day
counting), booked-holiday storage (`lambda/holidays.ts`: add/remove/list
against a mocked DynamoDB table), and email rendering (`lambda/email.ts`:
stage/tone selection, progress bar, the F**ks-to-Give meter, the calendar
months/days countdown, HTML/text output).
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the calendar months/days countdown headline"
```
