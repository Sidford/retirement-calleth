import { stageForDays, progressPct, monthsAndDaysUntil, fucksToGivePct, renderEmail } from "./email";

describe("stageForDays", () => {
  it("returns calm above 365 days", () => {
    expect(stageForDays(366).key).toBe("calm");
  });
  it("boundary 365 is cheeky", () => {
    expect(stageForDays(365).key).toBe("cheeky");
  });
  it("boundary 100 is unhinged", () => {
    expect(stageForDays(100).key).toBe("unhinged");
  });
  it("boundary 30 is chaotic", () => {
    expect(stageForDays(30).key).toBe("chaotic");
  });
  it("boundary 7 is peak", () => {
    expect(stageForDays(7).key).toBe("peak");
  });
  it("1 day is peak", () => {
    expect(stageForDays(1).key).toBe("peak");
  });
  it("0 and negative are theday", () => {
    expect(stageForDays(0).key).toBe("theday");
    expect(stageForDays(-3).key).toBe("theday");
  });
  it("preserves the exact calm tone string", () => {
    expect(stageForDays(400).tone).toBe(
      "deadpan sarcasm masked as professionalism. Gently mock the absurdity of still having to work."
    );
  });
});

describe("fucksToGivePct", () => {
  it("is 0% on the day", () => {
    expect(fucksToGivePct(0)).toBe(0);
  });
  it("is 0% for negative days", () => {
    expect(fucksToGivePct(-5)).toBe(0);
  });
  it("is near 100% far out", () => {
    expect(fucksToGivePct(365)).toBe(100);
  });
  it("is high but not maxed at 100 days", () => {
    expect(fucksToGivePct(100)).toBe(96);
  });
  it("is around the midpoint at 30 days", () => {
    expect(fucksToGivePct(30)).toBe(63);
  });
  it("is low in the final week", () => {
    expect(fucksToGivePct(7)).toBe(21);
  });
  it("is nearly zero on the last day", () => {
    expect(fucksToGivePct(1)).toBe(3);
  });
  it("decreases monotonically as days decreases", () => {
    const samples = [365, 200, 100, 60, 30, 14, 7, 3, 1, 0];
    const pcts = samples.map(fucksToGivePct);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeLessThanOrEqual(pcts[i - 1]);
    }
  });
});

describe("progressPct", () => {
  it("is 0% at the start date", () => {
    expect(progressPct("2026-01-01", "2028-01-01", new Date("2026-01-01T12:00:00Z"))).toBe(0);
  });
  it("is 100% at the retirement date", () => {
    expect(progressPct("2026-01-01", "2028-01-01", new Date("2028-01-01T00:00:00Z"))).toBe(100);
  });
  it("is ~50% at the midpoint", () => {
    expect(progressPct("2026-01-01", "2028-01-01", new Date("2027-01-01T00:00:00Z"))).toBe(50);
  });
  it("clamps to 0 when today is before the start", () => {
    expect(progressPct("2026-01-01", "2028-01-01", new Date("2025-06-01T00:00:00Z"))).toBe(0);
  });
  it("clamps to 100 when today is past retirement", () => {
    expect(progressPct("2026-01-01", "2028-01-01", new Date("2030-01-01T00:00:00Z"))).toBe(100);
  });
  it("returns 0 for a malformed start date", () => {
    expect(progressPct("not-a-date", "2028-01-01", new Date("2027-01-01T00:00:00Z"))).toBe(0);
  });
  it("returns 0 when start is not before retirement", () => {
    expect(progressPct("2028-01-01", "2026-01-01", new Date("2027-01-01T00:00:00Z"))).toBe(0);
  });
});

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
  it("borrows across more than one short month when the start day is late in its month", () => {
    expect(monthsAndDaysUntil("2026-01-31", "2026-03-01")).toEqual({ months: 0, days: 29 });
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
