// England & Wales bank holidays only — Scotland/NI observe a different set
// (e.g. St Andrew's Day, an early-August rather than late-August Summer
// bank holiday) which this does not account for.

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseIsoDateUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of Easter Sunday.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthIndex = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, monthIndex, day));
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const offset = (lastDay.getUTCDay() - weekday + 7) % 7;
  return addDays(lastDay, -offset);
}

function substituteIfWeekend(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, 2); // Saturday -> Monday
  if (day === 0) return addDays(date, 1); // Sunday -> Monday
  return date;
}

// Christmas Day and Boxing Day are always given as two consecutive
// non-working days, shifted off any weekend as a pair rather than
// independently (so they never collide on the same substitute day).
function christmasAndBoxingDayHolidays(year: number): [Date, Date] {
  const christmas = new Date(Date.UTC(year, 11, 25));
  const boxing = new Date(Date.UTC(year, 11, 26));
  switch (christmas.getUTCDay()) {
    case 5: // Fri/Sat -> Boxing Day alone shifts to the following Monday
      return [christmas, addDays(boxing, 2)];
    case 6: // Sat/Sun -> both shift, to Monday and Tuesday
      return [addDays(christmas, 2), addDays(boxing, 2)];
    case 0: // Sun/Mon -> only Christmas Day shifts, to Tuesday
      return [addDays(christmas, 2), boxing];
    default:
      return [christmas, boxing];
  }
}

/** England & Wales bank holidays for a given year, as UTC midnight Dates. */
export function ukBankHolidaysForYear(year: number): Date[] {
  const easter = easterSunday(year);
  return [
    substituteIfWeekend(new Date(Date.UTC(year, 0, 1))), // New Year's Day
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    nthWeekdayOfMonth(year, 4, 1, 1), // Early May bank holiday
    lastWeekdayOfMonth(year, 4, 1), // Spring bank holiday
    lastWeekdayOfMonth(year, 7, 1), // Summer bank holiday
    ...christmasAndBoxingDayHolidays(year),
  ];
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// Treated as non-working regardless of weekday or bank-holiday status,
// separately from (and in addition to) the Christmas Day/Boxing Day
// bank holidays above.
export function isChristmasClosure(date: Date): boolean {
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return (month === 11 && day >= 25) || (month === 0 && day === 1);
}

// Fortnightly non-working Friday: `anchor` is any known non-working Friday,
// and the pattern alternates every 7 days from there in both directions.
export function isNonWorkingFriday(date: Date, anchor: Date): boolean {
  if (date.getUTCDay() !== 5) return false;
  const diffWeeks = Math.round((date.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return ((diffWeeks % 2) + 2) % 2 === 0;
}

/** Counts working days strictly after `from` up to and including `target`. */
export function workingDaysBetween(
  target: Date,
  from: Date,
  nonWorkingFridayAnchor: Date,
  bookedHolidays: Set<number> = new Set()
): number {
  if (target.getTime() <= from.getTime()) return 0;

  const holidays = new Set<number>();
  for (let year = from.getUTCFullYear(); year <= target.getUTCFullYear(); year++) {
    for (const holiday of ukBankHolidaysForYear(year)) holidays.add(holiday.getTime());
  }

  let count = 0;
  for (let cursor = addDays(from, 1); cursor.getTime() <= target.getTime(); cursor = addDays(cursor, 1)) {
    const isWorkingDay =
      !isWeekend(cursor) &&
      !isChristmasClosure(cursor) &&
      !holidays.has(cursor.getTime()) &&
      !bookedHolidays.has(cursor.getTime()) &&
      !isNonWorkingFriday(cursor, nonWorkingFridayAnchor);
    if (isWorkingDay) count++;
  }
  return count;
}

/** Working days remaining until (and including) `retirementDateIso`, from `today`. */
export function workingDaysUntilRetirement(
  retirementDateIso: string,
  nonWorkingFridayAnchorIso: string,
  today: Date = new Date(),
  bookedHolidays: Set<number> = new Set()
): number {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const target = parseIsoDateUtc(retirementDateIso);
  const anchor = parseIsoDateUtc(nonWorkingFridayAnchorIso);
  return workingDaysBetween(target, from, anchor, bookedHolidays);
}
