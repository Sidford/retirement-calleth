export type StageKey =
  | "calm"
  | "cheeky"
  | "unhinged"
  | "chaotic"
  | "peak"
  | "theday";

export interface Stage {
  key: StageKey;
  tone: string;
  emoji: string;
  accent: string;
  gradient: string;
  subjectPrefix: string;
  allCaps: boolean;
}

const STAGES: Record<StageKey, Stage> = {
  calm: {
    key: "calm",
    tone: "deadpan sarcasm masked as professionalism. Gently mock the absurdity of still having to work.",
    emoji: "🗓️",
    accent: "#2563eb",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    subjectPrefix: "🗓️",
    allCaps: false,
  },
  cheeky: {
    key: "cheeky",
    tone: "sarcastic and irreverent, snide remarks about work culture, sharp observational humor.",
    emoji: "😏",
    accent: "#0d9488",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
    subjectPrefix: "😏",
    allCaps: false,
  },
  unhinged: {
    key: "unhinged",
    tone: "cynical and escalating, ranting about meetings and corporate nonsense, mock-desperate longing.",
    emoji: "🤪",
    accent: "#d97706",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    subjectPrefix: "🤪",
    allCaps: false,
  },
  chaotic: {
    key: "chaotic",
    tone: "UNHINGED RAGE AGAINST THE MACHINE, frantic countdown energy, mocking the final death throes of work.",
    emoji: "🔥",
    accent: "#ea580c",
    gradient: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
    subjectPrefix: "🔥",
    allCaps: true,
  },
  peak: {
    key: "peak",
    tone: "MANIC CELEBRATION mixed with spite, giddy contempt for the job you're leaving, FREEDOM IS NIGH.",
    emoji: "🎉",
    accent: "#db2777",
    gradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
    subjectPrefix: "🎉",
    allCaps: true,
  },
  theday: {
    key: "theday",
    tone: "TODAY IS THE DAY — triumphant vindication, you made it out alive, the corporate overlords cannot touch you now.",
    emoji: "🥳",
    accent: "#f59e0b",
    gradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
    subjectPrefix: "🥳",
    allCaps: true,
  },
};

export function stageForDays(n: number): Stage {
  if (n > 365) return STAGES.calm;
  if (n > 100) return STAGES.cheeky;
  if (n > 30) return STAGES.unhinged;
  if (n > 7) return STAGES.chaotic;
  if (n > 0) return STAGES.peak;
  return STAGES.theday;
}

// Exponential saturation curve: sits near 100% while retirement is hundreds
// of days out, then craters through the final weeks as `days` shrinks toward
// zero (e.g. ~96% at 100 days, ~63% at 30, ~21% at 7, ~3% at 1, 0% on the day).
// FUCKS_DECAY_CONSTANT controls how sharply the crash concentrates near the end.
const FUCKS_DECAY_CONSTANT = 30;

export function fucksToGivePct(days: number): number {
  if (days <= 0) return 0;
  const pct = 100 * (1 - Math.exp(-days / FUCKS_DECAY_CONSTANT));
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function progressPct(
  startISO: string,
  retirementISO: string,
  today: Date
): number {
  const start = Date.parse(`${startISO}T00:00:00Z`);
  const end = Date.parse(`${retirementISO}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const pct = ((now - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function parseIsoParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month - 1, day };
}

export function monthsAndDaysUntil(fromISO: string, toISO: string): { months: number; days: number } {
  const from = parseIsoParts(fromISO);
  const to = parseIsoParts(toISO);

  let months = (to.year - from.year) * 12 + (to.month - from.month);
  let days = to.day - from.day;

  let borrowMonth = to.month;
  let borrowYear = to.year;
  while (days < 0) {
    months -= 1;
    borrowMonth -= 1;
    if (borrowMonth < 0) {
      borrowMonth = 11;
      borrowYear -= 1;
    }
    days += new Date(Date.UTC(borrowYear, borrowMonth + 1, 0)).getUTCDate();
  }

  if (months < 0) {
    return { months: 0, days: 0 };
  }

  return { months, days };
}

export interface RenderInput {
  days: number;
  joke: string;
  stage: Stage;
  pct: number;
  monthsRemaining: number;
  daysRemainder: number;
}

const FUCKS_METER_COLOR = "#dc2626";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
