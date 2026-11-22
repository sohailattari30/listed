export interface CoachText {
  headline: string | null;
  insights: string[];
  today: string | null;
}

/** Splits the coach's plain-text answer ("headline / - insight / Today: ...") for display. */
export function parseCoachText(text: string): CoachText {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let headline: string | null = null;
  let today: string | null = null;
  const insights: string[] = [];
  lines.forEach((line, i) => {
    if (/^today:/i.test(line)) today = line.replace(/^today:\s*/i, '');
    else if (line.startsWith('-')) insights.push(line.replace(/^-\s*/, ''));
    else if (i === 0) headline = line;
    else insights.push(line);
  });
  return { headline, insights, today };
}
