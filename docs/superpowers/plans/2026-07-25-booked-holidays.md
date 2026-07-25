# Booked Holidays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: Shipped.** All 6 tasks below were implemented, reviewed, and deployed. This document has been updated after the fact to match what's actually in the codebase — see "Post-ship fixes" at the bottom for what changed based on the final whole-branch review and a follow-up user request.

**Goal:** Allow users to register and amend booked holidays so the working days remaining calculation excludes these dates.

**Architecture:** Add a DynamoDB table to store booked holidays (individual dates or date ranges). Create a CLI tool to manage holidays and modify `workingDaysBetween()` to exclude booked holidays from the count. The Lambda handler loads holidays at runtime before calculating working days.

**Tech Stack:** TypeScript, DynamoDB (on-demand billing), Node.js CLI

## Global Constraints

- Use TypeScript throughout
- DynamoDB uses on-demand billing mode
- Holidays are ISO date strings (YYYY-MM-DD)
- CLI tool invoked with AWS_PROFILE environment variable
- Working days calculation must remain pure (accept holidays as parameter)

---

## File Structure

**New files:**
- `lambda/holidays.ts` - Holiday storage/retrieval functions
- `bin/manage-holidays.ts` - CLI tool for holiday management
- `lambda/holidays.test.ts` - Tests for holiday functions

**Modified files:**
- `lib/retirement-countdown-stack.ts` - Add holidays DynamoDB table and Lambda permissions
- `lambda/workingDays.ts` - Update `workingDaysBetween()` signature to accept booked holidays
- `lambda/handler.ts` - Load holidays from DynamoDB before calculating working days
- `lambda/workingDays.test.ts` - Add tests for working days with booked holidays

---

## Task 1: Create holidays DynamoDB table in CDK stack

**Files:**
- Modify: `lib/retirement-countdown-stack.ts` (after line 40, before the Lambda function)

**Interfaces:**
- Produces: DynamoDB table for storing holidays

> **Note (post-ship):** this task's original interface note said the table name would be "exposed via stack output," but no `CfnOutput` was actually added here — the CLI (Task 5) had no documented way to discover the table name until the final whole-branch review caught it as a Critical gap. See "Post-ship fixes" at the bottom.

- [x] **Step 1: Add holidays table to the CDK stack**

After the `jokeHistoryTable` definition (line 40), add:

```typescript
const holidaysTable = new dynamodb.Table(this, "BookedHolidaysTable", {
  partitionKey: { name: "type", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
});
```

- [x] **Step 2: Grant Lambda read permissions on the holidays table**

After granting permissions on `jokeHistoryTable` (line 59), add:

```typescript
holidaysTable.grantReadData(countdownFn);
```

- [x] **Step 3: Add table name to Lambda environment variables**

In the `countdownFn` environment block (line 48-56), add:

```typescript
HOLIDAYS_TABLE_NAME: holidaysTable.tableName,
```

- [x] **Step 4: Commit**

```bash
git add lib/retirement-countdown-stack.ts
git commit -m "feat: add DynamoDB table for booked holidays"
```

---

## Task 2: Create holiday management functions

**Files:**
- Create: `lambda/holidays.ts`
- Create: `lambda/holidays.test.ts`

**Interfaces:**
- Consumes: DynamoDB table name from environment
- Produces: 
  - `getBookedHolidays(startDate: string, endDate: string): Promise<Set<number>>` - Returns Set of millisecond timestamps
  - `addHoliday(date: string): Promise<void>` - Add single holiday (ISO date)
  - `addHolidayRange(startDate: string, endDate: string): Promise<void>` - Add date range
  - `listHolidays(): Promise<string[]>` - List all booked holidays (sorted ISO dates)

- [x] **Step 1: Create holidays.ts with DynamoDB operations**

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.HOLIDAYS_TABLE_NAME as string;

function parseIsoDateUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Get all booked holidays between startDate and endDate (inclusive) as millisecond timestamps */
export async function getBookedHolidays(startDate: string, endDate: string): Promise<Set<number>> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#type = :type AND #date BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#type": "type", "#date": "date" },
      ExpressionAttributeValues: { ":type": "holiday", ":start": startDate, ":end": endDate },
    })
  );

  const holidays = new Set<number>();
  for (const item of res.Items || []) {
    holidays.add(parseIsoDateUtc(item.date).getTime());
  }
  return holidays;
}

/** Add a single booked holiday */
export async function addHoliday(date: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { type: "holiday", date, addedAt: new Date().toISOString() },
    })
  );
}

/** Add a range of booked holidays (inclusive) */
export async function addHolidayRange(startDate: string, endDate: string): Promise<void> {
  let current = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  const now = new Date().toISOString();

  while (current.getTime() <= end.getTime()) {
    const iso = dateToIso(current);
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { type: "holiday", date: iso, addedAt: now },
      })
    );
    current = addDays(current, 1);
  }
}

/** List all booked holidays in chronological order */
export async function listHolidays(): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#type = :type",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":type": "holiday" },
    })
  );

  const dates = (res.Items || []).map((item) => item.date).sort();
  return dates;
}
```

- [x] **Step 2: Create holidays.test.ts**

```typescript
import { getBookedHolidays, addHoliday, addHolidayRange, listHolidays } from "./holidays";

// Mock DynamoDB
jest.mock("@aws-sdk/client-dynamodb");
jest.mock("@aws-sdk/lib-dynamodb");

describe("Holiday Management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty set when no holidays are booked", async () => {
    const holidays = await getBookedHolidays("2026-08-01", "2026-08-31");
    expect(holidays.size).toBe(0);
  });

  it("adds a single holiday", async () => {
    await addHoliday("2026-08-15");
    const holidays = await listHolidays();
    expect(holidays).toContain("2026-08-15");
  });

  it("adds a holiday range", async () => {
    await addHolidayRange("2026-08-15", "2026-08-17");
    const holidays = await listHolidays();
    expect(holidays.length).toBe(3);
    expect(holidays).toContain("2026-08-15");
    expect(holidays).toContain("2026-08-16");
    expect(holidays).toContain("2026-08-17");
  });

  it("returns holidays in the given range as timestamps", async () => {
    await addHolidayRange("2026-08-10", "2026-08-12");
    const holidays = await getBookedHolidays("2026-08-01", "2026-08-31");
    expect(holidays.size).toBe(3);
  });
});
```

- [x] **Step 3: Commit**

```bash
git add lambda/holidays.ts lambda/holidays.test.ts
git commit -m "feat: add holiday management functions"
```

---

## Task 3: Update workingDaysBetween to accept booked holidays

**Files:**
- Modify: `lambda/workingDays.ts` (function signature and logic)
- Modify: `lambda/workingDays.test.ts` (update existing tests)

**Interfaces:**
- Consumes: Nothing new
- Produces: Updated `workingDaysBetween()` signature accepts optional `bookedHolidays?: Set<number>` parameter

- [x] **Step 1: Update workingDaysBetween signature**

Change line 106 from:

```typescript
export function workingDaysBetween(target: Date, from: Date, nonWorkingFridayAnchor: Date): number {
```

to:

```typescript
export function workingDaysBetween(
  target: Date,
  from: Date,
  nonWorkingFridayAnchor: Date,
  bookedHolidays: Set<number> = new Set()
): number {
```

- [x] **Step 2: Update working day check to exclude booked holidays**

In the `workingDaysBetween` function (around line 116), change:

```typescript
const isWorkingDay =
  !isWeekend(cursor) &&
  !isChristmasClosure(cursor) &&
  !holidays.has(cursor.getTime()) &&
  !isNonWorkingFriday(cursor, nonWorkingFridayAnchor);
```

to:

```typescript
const isWorkingDay =
  !isWeekend(cursor) &&
  !isChristmasClosure(cursor) &&
  !holidays.has(cursor.getTime()) &&
  !bookedHolidays.has(cursor.getTime()) &&
  !isNonWorkingFriday(cursor, nonWorkingFridayAnchor);
```

- [x] **Step 3: Update workingDaysUntilRetirement to accept booked holidays**

Change the function signature (around line 127-130) from:

```typescript
export function workingDaysUntilRetirement(
  retirementDateIso: string,
  nonWorkingFridayAnchorIso: string,
  today: Date = new Date()
): number {
```

to:

```typescript
export function workingDaysUntilRetirement(
  retirementDateIso: string,
  nonWorkingFridayAnchorIso: string,
  today: Date = new Date(),
  bookedHolidays: Set<number> = new Set()
): number {
```

- [x] **Step 4: Pass bookedHolidays to workingDaysBetween**

In `workingDaysUntilRetirement`, change line 135 from:

```typescript
return workingDaysBetween(target, from, anchor);
```

to:

```typescript
return workingDaysBetween(target, from, anchor, bookedHolidays);
```

- [x] **Step 5: Add test for working days with booked holidays**

In `lambda/workingDays.test.ts`, after the existing tests, add:

```typescript
describe("workingDaysBetween with booked holidays", () => {
  it("excludes booked holidays from working days count", () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const target = new Date("2026-08-10T00:00:00Z"); // 10 days
    const anchor = new Date("2025-07-18T00:00:00Z");
    
    // Without holidays
    const withoutHolidays = workingDaysBetween(target, from, anchor);
    
    // With one business day as holiday
    const bookedHolidays = new Set([new Date("2026-08-05T00:00:00Z").getTime()]);
    const withHolidays = workingDaysBetween(target, from, anchor, bookedHolidays);
    
    expect(withHolidays).toBe(withoutHolidays - 1);
  });

  it("excludes holiday ranges from working days count", () => {
    const from = new Date("2026-08-01T00:00:00Z");
    const target = new Date("2026-08-10T00:00:00Z");
    const anchor = new Date("2025-07-18T00:00:00Z");
    
    const bookedHolidays = new Set([
      new Date("2026-08-05T00:00:00Z").getTime(),
      new Date("2026-08-06T00:00:00Z").getTime(),
      new Date("2026-08-07T00:00:00Z").getTime(),
    ]);
    const withHolidays = workingDaysBetween(target, from, anchor, bookedHolidays);
    const withoutHolidays = workingDaysBetween(target, from, anchor);
    
    expect(withHolidays).toBe(withoutHolidays - 3);
  });
});
```

- [x] **Step 6: Run tests to verify**

```bash
npm test lambda/workingDays.test.ts
```

Expected: All tests pass.

- [x] **Step 7: Commit**

```bash
git add lambda/workingDays.ts lambda/workingDays.test.ts
git commit -m "feat: update workingDaysBetween to exclude booked holidays"
```

---

## Task 4: Update Lambda handler to load and use booked holidays

**Files:**
- Modify: `lambda/handler.ts`

**Interfaces:**
- Consumes: `getBookedHolidays()` function, updated `workingDaysUntilRetirement()` signature
- Produces: Handler now loads booked holidays before calculating days remaining

- [x] **Step 1: Import getBookedHolidays**

At the top of `lambda/handler.ts`, add to imports:

```typescript
import { getBookedHolidays } from "./holidays";
```

- [x] **Step 2: Update daysLeft function to accept and use booked holidays**

Change the `daysLeft()` function (line 22-24) from:

```typescript
function daysLeft(): number {
  return workingDaysUntilRetirement(RETIREMENT_DATE, NON_WORKING_FRIDAY_ANCHOR);
}
```

to:

```typescript
async function daysLeft(bookedHolidays: Set<number>): Promise<number> {
  return workingDaysUntilRetirement(
    RETIREMENT_DATE,
    NON_WORKING_FRIDAY_ANCHOR,
    new Date(),
    bookedHolidays
  );
}
```

- [x] **Step 3: Update handler to load and use booked holidays**

Change the `handler()` function (line 96-103) from:

```typescript
export async function handler(): Promise<void> {
  const days = daysLeft();
  const recentJokes = await getRecentJokes();
  const joke = await generateJoke(days, recentJokes);

  await sendEmail(days, joke);
  await saveJoke(joke, recentJokes);
}
```

to:

```typescript
export async function handler(): Promise<void> {
  const today = new Date();

  const bookedHolidays = await getBookedHolidays(
    today.toISOString().slice(0, 10),
    RETIREMENT_DATE
  );

  const days = await daysLeft(bookedHolidays);
  const recentJokes = await getRecentJokes();
  const joke = await generateJoke(days, recentJokes);

  await sendEmail(days, joke);
  await saveJoke(joke, recentJokes);
}
```

> **Note (post-ship):** the code block above has been edited from what actually shipped in the Task 4 commit — the original included an unused `const retirementDate = new Date(...)` line (dead code, flagged by the task reviewer as plan-mandated). It was removed in a follow-up fix commit (`ac3ffc6`) after the user chose to strip it. See "Post-ship fixes" at the bottom.

- [x] **Step 4: Commit**

```bash
git add lambda/handler.ts
git commit -m "feat: load booked holidays in handler before calculating working days"
```

---

## Task 5: Create CLI tool for managing holidays

**Files:**
- Create: `bin/manage-holidays.ts`

**Interfaces:**
- Consumes: Holiday management functions from `lambda/holidays.ts`
- Produces: CLI tool with `add`, `range`, `list` commands

> **Note (post-ship):** the code block below is the original `add`/`range`/`list`-only version from Task 5's commit (`c5af967`). It does not include `remove`/`remove-range` — those were added afterward in a separate follow-up commit (`fe365b5`) after the user pointed out that "register **and amend**" (the original feature request) has no removal path without them. See "Post-ship fixes" at the bottom for the current, complete CLI.

- [x] **Step 1: Create manage-holidays.ts CLI tool**

```typescript
import { addHoliday, addHolidayRange, listHolidays } from "../lambda/holidays";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error(`Usage:
  npx ts-node bin/manage-holidays.ts add <date>          Add a single holiday (YYYY-MM-DD)
  npx ts-node bin/manage-holidays.ts range <from> <to>   Add a holiday range (inclusive)
  npx ts-node bin/manage-holidays.ts list                 List all booked holidays
`);
    process.exit(1);
  }

  try {
    if (command === "add") {
      const date = args[1];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.error("Error: date must be in YYYY-MM-DD format");
        process.exit(1);
      }
      await addHoliday(date);
      console.log(`✓ Added holiday: ${date}`);
    } else if (command === "range") {
      const from = args[1];
      const to = args[2];
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        console.error("Error: dates must be in YYYY-MM-DD format");
        process.exit(1);
      }
      if (from > to) {
        console.error("Error: start date must be before or equal to end date");
        process.exit(1);
      }
      await addHolidayRange(from, to);
      console.log(`✓ Added holidays: ${from} to ${to}`);
    } else if (command === "list") {
      const holidays = await listHolidays();
      if (holidays.length === 0) {
        console.log("No booked holidays.");
      } else {
        console.log("Booked holidays:");
        for (const date of holidays) {
          console.log(`  ${date}`);
        }
      }
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
```

- [x] **Step 2: Commit**

```bash
git add bin/manage-holidays.ts
git commit -m "feat: add CLI tool for managing booked holidays"
```

---

## Task 6: Build, test, and deploy

**Files:**
- Run tests and build
- Deploy CDK stack

- [x] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass (40+ tests).

- [x] **Step 2: Build TypeScript**

```bash
npm run build
```

Expected: No compilation errors.

- [x] **Step 3: Deploy CDK stack**

```bash
AWS_PROFILE=lza-management npm run cdk -- deploy --require-approval never \
  -c retirementDate=2028-04-01 \
  -c senderEmail=guy@dunite.uk \
  -c recipientEmail=guy@sidford.org \
  -c nonWorkingFridayAnchor=2025-07-18
```

Expected: Stack deployment succeeds.

- [x] **Step 4: Test CLI tool locally (optional smoke test)**

```bash
AWS_PROFILE=lza-management npx ts-node bin/manage-holidays.ts list
```

Expected: Shows "No booked holidays." or lists existing holidays.

- [x] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: add booked holidays feature with CLI management"
```

- [x] **Step 6: Push to remote**

```bash
git push origin main
```

---

## Summary of Changes

| Task | Files | What | Tested |
|------|-------|------|--------|
| 1 | `lib/retirement-countdown-stack.ts` | Add holidays table + permissions | Via CDK deploy |
| 2 | `lambda/holidays.ts`, `lambda/holidays.test.ts` | Holiday CRUD functions | Unit tests |
| 3 | `lambda/workingDays.ts`, `.test.ts` | Update calculation to exclude holidays | Unit tests |
| 4 | `lambda/handler.ts` | Load holidays at runtime | Functional test |
| 5 | `bin/manage-holidays.ts` | CLI for managing holidays | Manual CLI test |
| 6 | Integration | Build, test, deploy | Full deployment |

---

## Post-ship fixes

After Task 6, a final whole-branch review (Opus, covering `37610d4..c5af967`) and a follow-up user request added work beyond the original 6 tasks:

**1. Dead code removed from Task 4** (commit `ac3ffc6`) — the task reviewer flagged `const retirementDate = ...` in `handler()` as unused, plan-mandated dead code. The user chose to strip it; a fix subagent removed the line, re-ran the full suite (46/46 pass), and the task reviewer re-approved.

**2. Table name exposed via CfnOutput** (commit `636fc3b`) — the final review found this as **Critical**: `bin/manage-holidays.ts` reads `HOLIDAYS_TABLE_NAME` from the environment, but nothing set that variable outside the Lambda, and the table had no `CfnOutput`, so there was no documented way for a human to discover its name. Added:

```typescript
new cdk.CfnOutput(this, "BookedHolidaysTableName", {
  value: holidaysTable.tableName,
});
```

**3. README updated** (commit `636fc3b`) — added a "Managing booked holidays" section with the table-discovery command and full CLI usage, updated the project-layout table to list `bin/manage-holidays.ts` and `lambda/holidays.ts`, and corrected a stale "07:00 UTC" schedule reference (actual schedule is 06:00 UTC).

**4. `remove`/`remove-range` commands added** (commit `fe365b5`) — the final review's Important finding: the original feature request was "register **and amend** booked holidays," but Task 5 only ever specified `add`/`range`/`list`, with no way to undo a booking. Added to `lambda/holidays.ts`:

```typescript
/** Remove a single booked holiday */
export async function removeHoliday(date: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { type: "holiday", date },
    })
  );
}

/** Remove a range of booked holidays (inclusive) */
export async function removeHolidayRange(startDate: string, endDate: string): Promise<void> {
  let current = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);

  while (current.getTime() <= end.getTime()) {
    const iso = dateToIso(current);
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { type: "holiday", date: iso },
      })
    );
    current = addDays(current, 1);
  }
}
```

And in `bin/manage-holidays.ts`, mirroring the `add`/`range` commands:

```
npx ts-node bin/manage-holidays.ts remove <date>              Remove a single holiday (YYYY-MM-DD)
npx ts-node bin/manage-holidays.ts remove-range <from> <to>   Remove a holiday range (inclusive)
```

This also required swapping the now-unused `GetCommand` import in `lambda/holidays.ts` for `DeleteCommand` (the original `GetCommand` import was dead code from the start — flagged as Minor in Task 2's review and never actually used).

**Final commit count:** 8 commits (`b25158e` through `636fc3b`), all on `main`, all pushed to `origin/main`.

