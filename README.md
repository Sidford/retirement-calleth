# retirement-calleth

![AWS CDK](https://img.shields.io/badge/AWS%20CDK-2.150.0-orange?logo=amazonaws&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)
![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?logo=awslambda&logoColor=white)
![Amazon Bedrock](https://img.shields.io/badge/Amazon-Bedrock-232F3E?logo=amazonaws&logoColor=white)
![Serverless](https://img.shields.io/badge/architecture-serverless-4B32C3)

A serverless AWS application that emails a daily retirement countdown, complete
with an AI-generated joke that gets progressively more unhinged as the date
approaches, and a **F**ks-to-Give Meter** that craters toward zero on the
same schedule. Built with AWS CDK (TypeScript).

Every morning at 06:00 UTC, a Lambda function calculates the number of
**working days** left until a configured retirement date, asks Amazon
Bedrock (Claude) for a short joke matching the mood of that countdown
stage, and emails the result via Amazon SES. Recent jokes are kept in
DynamoDB so the model avoids repeating itself, and a CloudWatch alarm
emails a separate ops alert if a run fails.

The email also carries a second meter alongside the progress bar: a
**F**ks-to-Give %**, which starts near 100% while retirement is far off and
decays exponentially toward 0% as the date approaches (still trying today,
running on autopilot by the end). It's a pure function of days remaining —
see `fucksToGivePct` in [lambda/email.ts](lambda/email.ts) — and its current
reading is also fed into the Bedrock prompt so the joke's attitude can track
it alongside the existing countdown-stage tone.

"Working days" excludes weekends, England & Wales bank holidays, the
Christmas Day–New Year's Day closure period, a fortnightly non-working
Friday, and any booked holidays registered via the CLI below — see
[docs/architecture.md](docs/architecture.md#working-day-calculation)
for the exact rules.

## Architecture

```mermaid
flowchart LR
    EB[EventBridge<br/>cron 06:00 UTC] --> L[Lambda<br/>CountdownFunction]
    L --> BR[Bedrock<br/>Claude model]
    L --> DDB[(DynamoDB<br/>JokeHistoryTable)]
    L --> SES[SES]
    SES --> Recipient((Recipient inbox))
    L -. errors .-> CW[CloudWatch Alarm]
    CW --> SNS[SNS Topic]
    SNS --> Recipient
```

See [docs/architecture.md](docs/architecture.md) for a full component
breakdown, [docs/well-architected-review.md](docs/well-architected-review.md)
for an AWS Well-Architected Framework review, and
[docs/threat-model.md](docs/threat-model.md) for a STRIDE threat model.

## Project layout

```
bin/retirement-countdown.ts        CDK app entry point + stack configuration
bin/manage-holidays.ts             CLI to register/amend booked holidays (see below)
lib/retirement-countdown-stack.ts  CDK stack: Lambda, EventBridge, DynamoDB, SES IAM, alarms
lambda/handler.ts                  Lambda handler: countdown, Bedrock joke, SES send, DynamoDB history
lambda/workingDays.ts              UK bank holidays, Christmas closure, fortnightly Friday, day counting
lambda/holidays.ts                 Booked-holiday storage: add/remove/list against DynamoDB
lambda/email.ts                    Countdown stage/tone, progress bar, HTML + text email rendering
```

## Before deploying

1. **Verify SES identities.** In a new/sandboxed SES account, both the
   sender and recipient addresses must be verified:
   ```bash
   aws ses verify-email-identity --email-address your-verified-sender@example.com
   aws ses verify-email-identity --email-address your-recipient@example.com
   ```
   Check your inbox for the verification links. (Request SES production
   access if you want to skip recipient verification later.)

2. **Enable Bedrock model access.** In the AWS Console → Bedrock → Model
   access, request access to the Claude model set as `bedrockModelId` in
   `bin/retirement-countdown.ts` (hardcoded, since it's not personal data).
   This is a one-time, per-account/region approval.

## Deploy

`retirementDate`, `senderEmail`, `recipientEmail`, and
`nonWorkingFridayAnchor` are **not** hardcoded — they're personal data, so
they must be passed as CDK context on every `deploy`/`synth`/`destroy`
invocation instead of being committed to source. `nonWorkingFridayAnchor`
is the ISO date of *any* Friday you know you don't work — it anchors the
fortnightly on/off pattern (see
[docs/architecture.md](docs/architecture.md#working-day-calculation)):

```bash
npm install
npx cdk bootstrap \
  -c retirementDate=2028-04-01 \
  -c senderEmail=your-verified-sender@example.com \
  -c recipientEmail=your-recipient@example.com \
  -c nonWorkingFridayAnchor=2026-07-31   # first time only, per account/region

npx cdk deploy \
  -c retirementDate=2028-04-01 \
  -c senderEmail=your-verified-sender@example.com \
  -c recipientEmail=your-recipient@example.com \
  -c nonWorkingFridayAnchor=2026-07-31
```

Omitting any of these fails fast with a clear error before anything is
deployed. To avoid retyping them, put them in `cdk.context.json` (gitignored)
or export them once as shell variables and reuse `-c retirementDate=$RETIREMENT_DATE ...`.

`countdownStartDate` is optional context (defaults to today) used only for
the email's progress bar, not the working-day count.

## Managing booked holidays

Booked holidays are stored in their own DynamoDB table and excluded from
the working-days count automatically — the Lambda reads them fresh on
every run, so a change made via the CLI is picked up by the very next
scheduled email. The CLI runs outside the Lambda, so it needs the table
name and your own AWS credentials:

```bash
# One-time: find the table name from the stack output
aws cloudformation describe-stacks --stack-name RetirementCountdownStack \
  --query "Stacks[0].Outputs[?OutputKey=='BookedHolidaysTableName'].OutputValue" \
  --output text

export HOLIDAYS_TABLE_NAME=<value from above>
export AWS_PROFILE=<your profile>   # or any other way of supplying credentials

npx ts-node bin/manage-holidays.ts add 2026-09-01                 # single day
npx ts-node bin/manage-holidays.ts range 2026-09-10 2026-09-14    # inclusive range
npx ts-node bin/manage-holidays.ts remove 2026-09-01              # undo a single day
npx ts-node bin/manage-holidays.ts remove-range 2026-09-10 2026-09-14
npx ts-node bin/manage-holidays.ts list                           # all booked holidays
```

## Run the tests

```bash
npm test
```

Covers the working-day calculation (`lambda/workingDays.ts`: UK bank
holidays, Christmas closure, the fortnightly Friday, booked holidays, day
counting), booked-holiday storage (`lambda/holidays.ts`: add/remove/list
against a mocked DynamoDB table), and email rendering (`lambda/email.ts`:
stage/tone selection, progress bar, the F**ks-to-Give meter, HTML/text
output).

## Test it immediately

```bash
aws lambda invoke --function-name <CountdownFunctionName-from-stack-output> out.json
cat out.json
```

## Notes

- **DST**: the schedule is fixed at 06:00 UTC (07:00 BST / 06:00 GMT). It
  won't auto-shift with daylight saving — adjust the cron in
  `lib/retirement-countdown-stack.ts` if exact local time matters year-round.
- **Joke history**: stored in DynamoDB so the prompt can tell Bedrock what
  to avoid repeating. Per-day records expire after 90 days (TTL).
- **Alerts**: a CloudWatch alarm on Lambda errors emails the recipient
  address separately if a run fails, so a silent break doesn't go unnoticed.
- **Cost**: this is comfortably within AWS free tier for a single daily
  invocation — Lambda, EventBridge, and DynamoDB costs are negligible.
  Bedrock and SES have small per-use costs (fractions of a cent/day).

## Tear down

```bash
npx cdk destroy
```
