# Month countdown in the email — design

**Date:** 2026-07-29
**Status:** Approved (design), pending implementation plan
**Branch:** TBD (current branch: `main`)

## Problem

The email's hero headline shows only the working-days count (e.g.
`142 🔥 working days to go`). Working days is the operationally accurate
number (it drives the mood stage and F**ks-to-Give meter), but it's a
clunky way to feel how far off retirement actually is — "months" is a more
intuitive, human-scale unit for anything more than a few weeks out.

## Goal

Add a calendar-based "N months, D days to go" figure as the email's primary
headline, while keeping the existing working-days figure visible as a
secondary caption. Stage selection (colour/emoji/tone) and the F**ks-to-Give
meter stay driven by working days, unchanged. The new figure also gets fed
into the Bedrock joke prompt so jokes can reference it.

## Non-goals (YAGNI)

- No change to `stageForDays`, `fucksToGivePct`, or the subject line — all
  stay keyed on working days as today.
- No change to the progress bar or `countdownStartDate` behaviour.
- No new CDK context/config — purely a derived display value computed from
  existing `RETIREMENT_DATE` and today's date.
- No locale/i18n handling — English pluralisation only, matching the
  existing `unit` handling for working days.

## Design

### Calculation: `monthsAndDaysUntil`

New pure function in `lambda/email.ts`, alongside `progressPct`:

```ts
export function monthsAndDaysUntil(
  fromISO: string,
  toISO: string
): { months: number; days: number }
```

Standard calendar year/month/day diff (the same approach as an "age
calculator"): whole months between the two dates, plus the leftover days
once those months are subtracted off. Calendar-based — weekends and
holidays count — deliberately different from the working-days figure,
since "months" is inherently a calendar concept, not a working-day one.

If `toISO` is not strictly after `fromISO`, clamps to `{ months: 0, days: 0 }`
(mirrors `progressPct`'s clamping behaviour for degenerate ranges).

Algorithm:

```
months = (toYear - fromYear) * 12 + (toMonth - fromMonth)
days   = toDay - fromDay
if days < 0:
  months -= 1
  days += daysInMonthBefore(toMonth, toYear)
if months < 0: months = 0; days = 0
```

### Email rendering (`renderEmail`)

`RenderInput` gains two fields:

```ts
export interface RenderInput {
  days: number;              // working days (unchanged)
  joke: string;
  stage: Stage;
  pct: number;
  monthsRemaining: number;   // new
  daysRemainder: number;     // new
}
```

**Hero block** (big number + subheading), when `stage.key !== "theday"`:

- If `monthsRemaining > 0`: heading = `{monthsRemaining} {emoji}`;
  subheading = `month(s)[, N day(s)] to go` — the day clause is omitted
  when `daysRemainder === 0`.
  - Examples: `"months, 12 days to go"`, `"6 months to go"`,
    `"1 month, 1 day to go"`.
- If `monthsRemaining === 0` (final calendar month): heading =
  `{daysRemainder} {emoji}`; subheading = `day(s) to go` — same shape as
  today's working-days hero, just calendar days instead.

The `theday` stage is unchanged (`TODAY'S THE DAY 🥳` / congratulations
copy) — `monthsRemaining`/`daysRemainder` are `{0, 0}` in that case and are
not rendered.

**New secondary caption**, placed directly below the hero block and above
the joke callout: today's current headline, demoted —
`"{days} working day(s) to go"` (reusing the existing singular/pluralised
`unit` logic).

**Text version**: mirrors the HTML — months/days phrase first line,
working-days caption second line, then the existing joke/progress/meter
lines unchanged.

### Joke prompt (`lambda/handler.ts`)

`generateJoke` gains `monthsRemaining: number` and `daysRemainder: number`
parameters. The `userPrompt` gets one additional sentence stating the
calendar months/days remaining, alongside the existing working-days and
F**ks-meter context, so the model can reference it (e.g. "6 months left")
without it being the sole driver of tone (tone stays anchored on the
working-days-derived `stage.tone`).

`handler()` computes `monthsAndDaysUntil(todayISO, RETIREMENT_DATE)` once
per run (same `today` used for `daysLeft`/`progressPct`) and threads the
result into both `generateJoke` and `sendEmail`/`renderEmail`.

### Data flow (unchanged except email build)

EventBridge → Lambda → (DynamoDB history read) → `monthsAndDaysUntil` +
`stageForDays` + `progressPct` → Bedrock joke (now also given months/days)
→ `renderEmail` → SES multipart send → DynamoDB history write.

### Error handling

`monthsAndDaysUntil` is pure and total for well-formed ISO input (same
contract as `progressPct`); malformed dates aren't a realistic runtime
case since `RETIREMENT_DATE` is validated at deploy time via required CDK
context, so no new error handling is introduced.

## Testing (TDD)

Add unit tests in `lambda/email.test.ts` for `monthsAndDaysUntil`:

- Simple whole-month case (e.g. exactly 6 months, 0 days).
- Month + leftover days case (e.g. 6 months, 12 days).
- Month-boundary rollover (leftover days computed from the correct
  preceding month's length, including a Feb/leap-year case).
- Same-month (`months === 0`, only days remain).
- Same-day (`{0, 0}`).
- `toISO` before/equal `fromISO` → clamped to `{0, 0}`.
- Singular vs plural boundaries (1 month/1 day vs 2+, mirroring the
  existing `unit` test pattern for working days).

Update `renderEmail` tests to cover:

- Hero shows months+days phrasing when `monthsRemaining > 0`, with the
  day clause omitted when `daysRemainder === 0`.
- Hero falls back to days-only phrasing when `monthsRemaining === 0`.
- New working-days caption line present and correctly pluralised.
- `theday` stage unaffected (no months line rendered).
- Text version contains both the months/days phrase and the working-days
  caption.

No AWS mocking required — `monthsAndDaysUntil` and `renderEmail` stay pure,
consistent with the rest of `lambda/email.ts`.

## Rollout

- Implement + test on a feature branch; `cdk synth` clean.
- Deploy to `lza-management` (eu-west-2) and verify with a live
  `lambda invoke`, confirming the new headline and caption render correctly
  in both HTML and text bodies.
- Update `README.md` with a brief mention alongside the existing
  F**ks-to-Give-meter description.
- Commit, push, open a PR.
