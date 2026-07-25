# AWS Well-Architected Framework Review

Scope: the `RetirementCountdownStack` CDK stack and `lambda/handler.ts` as
they exist in this repository — a single scheduled Lambda function with
DynamoDB, Bedrock, SES and a CloudWatch/SNS error alert. This is a
low-traffic, single-recipient personal utility, so recommendations are
calibrated to that scale rather than treated as production-service gaps.

## 1. Operational Excellence

**Observations**
- No CI/CD: deploys are manual (`npx cdk deploy`) from a developer machine.
  There's no automated build/lint/test/synth gate before a change reaches
  production.
- `lambda/workingDays.ts`, `lambda/email.ts`, and `lambda/holidays.ts` have a
  Jest unit-test suite (`npm test`), but `bin/manage-holidays.ts` (the CLI)
  and the CDK stack itself have no automated tests, so an accidental IAM or
  schedule regression in `lib/retirement-countdown-stack.ts`, or a CLI
  argument-parsing bug, wouldn't be caught automatically — matching the
  existing pattern where `bin/retirement-countdown.ts` is also untested.
- Logging exists (default Lambda → CloudWatch Logs) but log retention is
  unset, so `NodejsFunction`'s default log group keeps logs indefinitely.
- The single `CountdownFunctionName` CfnOutput is the only operational
  surface exposed post-deploy; there's no dashboard.
- Runbook knowledge (how to re-verify SES identities, request Bedrock
  access, rotate the retirement date) lives only in the README.

**Recommendations**
- Add a `LogGroup` construct with an explicit `retention` (e.g. one month)
  passed to `NodejsFunction` to avoid unbounded log storage.
- Add a CDK `Template`-based snapshot/assertions test for the stack to
  guard against accidental IAM/schedule regressions (the Lambda-side logic
  already has unit test coverage).
- Consider a simple GitHub Actions workflow that runs `npm ci && npx cdk
  synth` (and tests, once added) on PRs — cheap insurance even without a
  full deploy pipeline.

## 2. Security

**Observations**
- **SES grant is scoped to the sender identity**: `ses:SendEmail`/
  `ses:SendRawEmail` are granted on the sender's identity ARN
  (`arn:aws:ses:<region>:<account>:identity/<senderEmail>`) in
  `lib/retirement-countdown-stack.ts`, rather than `resources: ["*"]`. A
  misused execution role can still send *from* that identity to any
  recipient — SES has no resource-level ARN for the destination address —
  but it can no longer send as an *arbitrary* verified identity in the
  account, which is the scoping SES actually supports.
- **Bedrock and DynamoDB grants are correctly least-privilege**: Bedrock is
  scoped to a single model ARN. Of the two DynamoDB tables, `JokeHistoryTable`
  uses `grantReadWriteData` (the Lambda both reads and writes joke history);
  `BookedHolidaysTable` uses `grantReadData` only — the Lambda never writes
  booked holidays, so a compromised or buggy execution context cannot alter
  the holiday calendar, only read it. All holiday mutation happens via
  `bin/manage-holidays.ts`, run locally under a human's own AWS credentials,
  outside the Lambda's execution role entirely.
- No VPC / network isolation is needed or used — correct call, since the
  function only calls AWS service APIs and has no need to reach private
  network resources.
- No encryption-at-rest customization: DynamoDB uses AWS-owned default
  encryption (not a customer-managed KMS key). For this data (joke text,
  no PII beyond what's already in env vars) that's a reasonable,
  proportionate choice, not a gap.
- `retirementDate`, `senderEmail`, `recipientEmail`, and
  `nonWorkingFridayAnchor` are personal/situational data and are **not**
  committed to source: `bin/retirement-countdown.ts` reads them via CDK
  context (`-c` flags, or a gitignored `cdk.context.json`) and fails fast
  with a clear error if any is missing, so real addresses (or a work
  schedule) never land in git history. `bedrockModelId` stays hardcoded
  since it isn't personal data.
- No secrets are used (no API keys / passwords) — nothing here needs
  Secrets Manager.
- No input validation beyond presence-checking on the context values; a
  malformed `retirementDate` or `nonWorkingFridayAnchor` would still cause
  `workingDaysUntilRetirement()` to produce `NaN`/`Invalid Date` and error
  out loudly at runtime (fails safe, but only on first invocation rather
  than at `cdk synth` time).

**Recommendations**
- Add a `cdk-nag` or similar automated IAM/security lint check to the
  (currently absent) CI pipeline to catch broad grants like this going
  forward.
- Validate `retirementDate` is a well-formed ISO date in the CDK app
  (`bin/retirement-countdown.ts`) — alongside the existing presence check —
  so a typo fails at `cdk synth`/`deploy` time, not at 06:00 UTC the next
  morning.

## 3. Reliability

**Observations**
- Single Lambda invocation per day with no automatic retry configured on
  the EventBridge target; a transient Bedrock/SES throttle or timeout fails
  the whole run for that day with no retry.
- `FunctionErrorAlarm` correctly surfaces failures via email
  (`treatMissingData: NOT_BREACHING` is the right choice so "no invocation
  today" isn't misreported as an error).
- No dead-letter queue (DLQ) on the Lambda target, so a failed async
  invocation's context is lost beyond the CloudWatch Logs entry — acceptable
  for a low-stakes daily job, but means troubleshooting relies entirely on
  logs.
- `sendEmail` and `saveJoke` in `lambda/handler.ts` run sequentially with no
  partial-failure handling: if `SendEmailCommand` succeeds but the
  subsequent `PutCommand` throws, the email still goes out but joke history
  isn't updated (minor — the next day's history is just slightly stale) —
  low impact, no action needed.
- Single-region deployment, no multi-region failover — appropriate for
  this workload; AWS-region-wide outages affecting Lambda/SES/Bedrock
  simultaneously are rare and the impact (a missed joke email) is trivial.

**Recommendations**
- Add `retryAttempts` / a DLQ (or at minimum an SQS DLQ target) on the
  EventBridge → Lambda target so a single transient failure doesn't
  silently rely only on the CloudWatch alarm for visibility.
- Optionally wrap the Bedrock call with a short retry/backoff for
  throttling (`ThrottlingException`), since Bedrock on-demand throughput
  can be rate-limited under load elsewhere in the account.

## 4. Performance Efficiency

**Observations**
- 256 MB / 30 s Lambda configuration is generously sized for a handler
  doing one DynamoDB read, one Bedrock call, one SES send, two DynamoDB
  writes — well within typical single-digit-second execution time.
- `PAY_PER_REQUEST` DynamoDB billing avoids any capacity-planning work and
  matches the extremely low, spiky (once-daily) access pattern.
- No performance-sensitive path exists (nothing user-facing, no latency
  SLO) — the design is appropriately simple for the workload.

**Recommendations**
- None required at this scale. If memory/duration ever becomes a concern,
  CloudWatch already captures `Duration`/`Memory Used` for right-sizing.

## 5. Cost Optimization

**Observations**
- All components (Lambda, EventBridge, DynamoDB on-demand, SNS, CloudWatch
  alarm) are effectively free at one invocation/day; Bedrock and SES are the
  only per-use costs, both fractions of a cent per run, as the README
  already notes.
- `RemovalPolicy.DESTROY` on the DynamoDB table avoids orphaned
  pay-per-request tables accumulating cost/clutter after a `cdk destroy`.
- No idle/always-on infrastructure (no NAT gateway, no provisioned
  capacity, no VPC endpoints) — nothing here bleeds cost between
  invocations.
- A compromised or buggy trigger path (e.g., something with
  `lambda:InvokeFunction` calling the function in a loop) could run up
  Bedrock/SES costs; there's no budget alarm to catch that.

**Recommendations**
- Optional: add an AWS Budgets alert (or a CloudWatch billing alarm) as a
  cheap backstop against unexpected invocation volume, since nothing in
  the stack currently limits how often the function can be invoked
  on-demand outside its schedule.

## 6. Sustainability

**Observations**
- Serverless, pay-per-use components with no idle compute is already the
  most sustainable pattern available for this workload's shape (once
  daily, sub-second of actual compute).
- No over-provisioning: memory/timeout are modest, storage is on-demand,
  and TTL cleanup (90-day expiry on per-day DynamoDB records) prevents
  unbounded data growth.

**Recommendations**
- None — the architecture is already minimal. No changes needed.

## Summary

| Pillar | Status | Top action |
|---|---|---|
| Operational Excellence | Adequate for scale | Add log retention + minimal tests |
| Security | Fixed | SES grant now scoped to the sender identity ARN |
| Reliability | Adequate for scale | Add DLQ/retry on the EventBridge target |
| Performance Efficiency | Good | None |
| Cost Optimization | Good | Optional budget alarm |
| Sustainability | Good | None |

The architecture is well-suited to its actual requirements — a personal,
single-recipient, once-a-day notification. The previously unscoped SES
`SendEmail` permission has been narrowed to the sender identity ARN; the
remaining items above are optional hardening rather than open gaps.
