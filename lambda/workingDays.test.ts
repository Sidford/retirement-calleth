import {
  ukBankHolidaysForYear,
  isChristmasClosure,
  isNonWorkingFriday,
  workingDaysBetween,
  workingDaysUntilRetirement,
} from "./workingDays";

function iso(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function isoKeys(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString().slice(0, 10)).sort();
}

describe("ukBankHolidaysForYear", () => {
  it("2026: matches the published gov.uk England & Wales list", () => {
    expect(isoKeys(ukBankHolidaysForYear(2026))).toEqual(
      [
        "2026-01-01", // New Year's Day (Thu, no shift)
        "2026-04-03", // Good Friday
        "2026-04-06", // Easter Monday
        "2026-05-04", // Early May
        "2026-05-25", // Spring
        "2026-08-31", // Summer
        "2026-12-25", // Christmas Day (Fri, no shift)
        "2026-12-28", // Boxing Day substitute (26th is a Sat)
      ].sort()
    );
  });

  it("2027: Christmas Day falls on a Saturday, so both shift", () => {
    expect(isoKeys(ukBankHolidaysForYear(2027))).toEqual(
      [
        "2027-01-01",
        "2027-03-26",
        "2027-03-29",
        "2027-05-03",
        "2027-05-31",
        "2027-08-30",
        "2027-12-27", // Christmas Day substitute (25th is a Sat)
        "2027-12-28", // Boxing Day substitute (26th is a Sun)
      ].sort()
    );
  });

  it("2028: New Year's Day falls on a Saturday and shifts to the Monday", () => {
    expect(ukBankHolidaysForYear(2028)).toContainEqual(iso(2028, 1, 3));
  });
});

describe("isChristmasClosure", () => {
  it("covers 25 Dec through 31 Dec and 1 Jan, inclusive", () => {
    expect(isChristmasClosure(iso(2026, 12, 24))).toBe(false);
    expect(isChristmasClosure(iso(2026, 12, 25))).toBe(true);
    expect(isChristmasClosure(iso(2026, 12, 29))).toBe(true);
    expect(isChristmasClosure(iso(2026, 12, 31))).toBe(true);
    expect(isChristmasClosure(iso(2027, 1, 1))).toBe(true);
    expect(isChristmasClosure(iso(2027, 1, 2))).toBe(false);
  });
});

describe("isNonWorkingFriday", () => {
  const anchor = iso(2026, 7, 31); // a known non-working Friday

  it("is off on the anchor Friday itself", () => {
    expect(isNonWorkingFriday(anchor, anchor)).toBe(true);
  });
  it("is working on the Friday before the anchor", () => {
    expect(isNonWorkingFriday(iso(2026, 7, 24), anchor)).toBe(false);
  });
  it("is working on the Friday after the anchor", () => {
    expect(isNonWorkingFriday(iso(2026, 8, 7), anchor)).toBe(false);
  });
  it("is off two Fridays after the anchor", () => {
    expect(isNonWorkingFriday(iso(2026, 8, 14), anchor)).toBe(true);
  });
  it("is never true for a non-Friday", () => {
    expect(isNonWorkingFriday(iso(2026, 7, 30), anchor)).toBe(false);
  });
});

describe("workingDaysBetween", () => {
  const anchor = iso(2026, 7, 31);

  it("returns 0 when target is today or in the past", () => {
    const today = iso(2026, 7, 22);
    expect(workingDaysBetween(today, today, anchor)).toBe(0);
    expect(workingDaysBetween(iso(2026, 7, 21), today, anchor)).toBe(0);
  });

  it("counts a single ordinary working weekday", () => {
    // Wed 2026-07-22 -> Thu 2026-07-23: one ordinary weekday, no holiday/Friday involved
    expect(workingDaysBetween(iso(2026, 7, 23), iso(2026, 7, 22), anchor)).toBe(1);
  });

  it("excludes a weekend", () => {
    // Fri 2026-07-24 (working Friday) -> Mon 2026-07-27: only the Monday counts
    expect(workingDaysBetween(iso(2026, 7, 27), iso(2026, 7, 24), anchor)).toBe(1);
  });

  it("counts the working Friday", () => {
    expect(workingDaysBetween(iso(2026, 7, 24), iso(2026, 7, 23), anchor)).toBe(1);
  });

  it("excludes the non-working Friday", () => {
    expect(workingDaysBetween(iso(2026, 7, 31), iso(2026, 7, 30), anchor)).toBe(0);
  });

  it("excludes a UK bank holiday", () => {
    // Thu 2026-04-02 -> Mon 2026-04-06: Good Friday (4/3) and Easter Monday (4/6)
    // are both bank holidays, weekend 4/4-5 in between. Nothing counts.
    expect(workingDaysBetween(iso(2026, 4, 6), iso(2026, 4, 2), anchor)).toBe(0);
  });

  it("excludes the Christmas-to-New-Year closure even on plain weekdays", () => {
    // Wed 2026-12-23 -> Fri 2027-01-01: 24th (Thu, ordinary working day, +1),
    // then 25 Dec - 1 Jan is entirely closure/bank-holiday, nothing else counts.
    expect(workingDaysBetween(iso(2027, 1, 1), iso(2026, 12, 23), anchor)).toBe(1);
  });

  it("resumes counting normally in the new year", () => {
    // Fri 2027-01-01 (closure) -> Mon 2027-01-04: only the Monday counts.
    expect(workingDaysBetween(iso(2027, 1, 4), iso(2027, 1, 1), anchor)).toBe(1);
  });
});

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

describe("workingDaysUntilRetirement", () => {
  it("wires today/target/anchor strings through to workingDaysBetween", () => {
    const result = workingDaysUntilRetirement(
      "2026-07-27",
      "2026-07-31",
      new Date("2026-07-24T09:00:00Z")
    );
    // Same as the "excludes a weekend" case above.
    expect(result).toBe(1);
  });

  it("defaults `today` to now when omitted", () => {
    expect(typeof workingDaysUntilRetirement("2099-01-01", "2026-07-31")).toBe("number");
  });
});
