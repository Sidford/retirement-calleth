import { stageForDays, progressPct, fucksToGivePct, renderEmail } from "./email";

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

describe("renderEmail", () => {
  it("far-off email: hero number, joke, progress, plain subject", () => {
    const stage = stageForDays(621);
    const out = renderEmail({ days: 621, joke: "Only 621 sleeps left.", stage, pct: 43 });
    expect(out.subject).toBe("🗓️ 621 working days to go");
    expect(out.html).toContain("621");
    expect(out.html).toContain("Only 621 sleeps left.");
    expect(out.html).toContain("43% of the way there");
    expect(out.html).toContain(stage.accent);
    expect(out.text).toContain("621 working days until retirement");
    expect(out.text).toContain("Only 621 sleeps left.");
    expect(out.text).toContain("— your retirement countdown bot");
  });

  it("final-week email: ALL-CAPS subject with bangs", () => {
    const stage = stageForDays(3);
    const out = renderEmail({ days: 3, joke: "Three. More. Days.", stage, pct: 98 });
    expect(out.subject).toBe("🎉 3 WORKING DAYS TO GO!!!");
  });

  it("the day: celebratory subject and heading", () => {
    const stage = stageForDays(0);
    const out = renderEmail({ days: 0, joke: "Go!", stage, pct: 100 });
    expect(out.subject).toBe("🥳 TODAY'S THE DAY!");
    expect(out.html).toContain("TODAY'S THE DAY");
    expect(out.text).toContain("TODAY'S THE DAY");
    // The celebratory sentence keeps its natural case (not shouted in caps).
    expect(out.html).toContain("Congratulations — you made it.");
    expect(out.html).toContain("text-transform:none;");
  });

  it("escapes HTML in the joke", () => {
    const stage = stageForDays(200);
    const out = renderEmail({ days: 200, joke: "<script>alert(1)</script>", stage, pct: 10 });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("uses singular unit for one day", () => {
    const stage = stageForDays(1);
    const out = renderEmail({ days: 1, joke: "!", stage, pct: 99 });
    expect(out.subject).toBe("🎉 1 WORKING DAY TO GO!!!");
  });

  it("uses singular subheading label in the HTML for one day", () => {
    const stage = stageForDays(1);
    const out = renderEmail({ days: 1, joke: "!", stage, pct: 99 });
    expect(out.html).toContain(">working day to go<");
    expect(out.html).not.toContain("working days to go");
  });

  it("includes the F**ks-to-give meter in HTML and text", () => {
    const stage = stageForDays(30);
    const out = renderEmail({ days: 30, joke: "Whatever.", stage, pct: 50 });
    expect(out.html).toContain("63% F**ks left to give");
    expect(out.text).toContain("63% F**ks left to give");
  });

  it("F**ks-to-give meter reaches 0% on the day", () => {
    const stage = stageForDays(0);
    const out = renderEmail({ days: 0, joke: "Go!", stage, pct: 100 });
    expect(out.html).toContain("0% F**ks left to give");
    expect(out.text).toContain("0% F**ks left to give");
  });
});
