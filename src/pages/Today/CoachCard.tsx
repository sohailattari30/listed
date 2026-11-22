import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CoachSchema, fetchCoach, type CoachResult } from '../../lib/ai';
import { parseCoachText } from '../../lib/coach';
import styles from './CoachCard.module.css';

const cacheKey = () => `listed_coach_${new Date().toDateString()}`;

function readCached(): CoachResult | null {
  try {
    const raw = sessionStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = CoachSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The coach is an agent: it picks its own tools, reads this user's data, then answers. Cached per day. */
export function CoachCard() {
  const [result, setResult] = useState<CoachResult | null>(readCached);
  const coach = useMutation({
    mutationFn: fetchCoach,
    onSuccess: (r) => {
      setResult(r);
      try {
        sessionStorage.setItem(cacheKey(), JSON.stringify(r));
      } catch {
        // storage unavailable: the card still works, it just re-asks next visit
      }
    },
  });

  const parsed = result ? parseCoachText(result.text) : null;

  return (
    <div className={styles.card}>
      <div className={styles.label}>AI coach</div>
      {result && parsed ? (
        <>
          {parsed.headline && <div className={styles.head}>{parsed.headline}</div>}
          {parsed.insights.map((line) => (
            <div className={styles.line} key={line}>
              {line}
            </div>
          ))}
          {parsed.today && <div className={styles.today}>Today: {parsed.today}</div>}
          {result.steps.length > 0 && (
            <div className={styles.steps}>
              <div className={styles.stepsLabel}>What the coach checked</div>
              {result.steps.map((s, i) => (
                <div className={styles.step} key={`${s.tool}-${i}`}>
                  {s.summary}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {coach.error && (
            <div className={styles.err} role="alert">
              {coach.error.message}
            </div>
          )}
          <button className={styles.btn} disabled={coach.isPending} onClick={() => coach.mutate()}>
            {coach.isPending ? 'Coach is reading your numbers...' : coach.error ? 'Try again' : 'Analyze my calls'}
          </button>
        </>
      )}
    </div>
  );
}
