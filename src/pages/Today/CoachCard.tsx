import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchCoach } from '../../lib/ai';
import { parseCoachText } from '../../lib/coach';
import { hasNewCalls, readCollapsed, readCoachCache, writeCollapsed, writeCoachCache, type CoachCache } from '../../lib/coachCache';
import styles from './CoachCard.module.css';

/**
 * The coach is an agent: it picks its own tools, reads this user's data, then answers.
 * The answer is saved for the day, can be hidden, and can be re-run on demand.
 */
export function CoachCard({ callCount }: { callCount: number | undefined }) {
  const [cache, setCache] = useState<CoachCache | null>(() => readCoachCache(localStorage));
  const [collapsed, setCollapsed] = useState(() => readCollapsed(localStorage));
  const coach = useMutation({
    mutationFn: fetchCoach,
    onSuccess: (result) => setCache(writeCoachCache(localStorage, result, callCount ?? null)),
  });

  const parsed = cache ? parseCoachText(cache.result.text) : null;
  const stale = cache ? hasNewCalls(cache, callCount) : false;

  function toggle() {
    setCollapsed((c) => {
      writeCollapsed(localStorage, !c);
      return !c;
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={styles.label}>AI coach</div>
        {cache && (
          <div className={styles.actions}>
            <button className={styles.link} disabled={coach.isPending} onClick={() => coach.mutate()}>
              {coach.isPending ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className={styles.link} aria-expanded={!collapsed} onClick={toggle}>
              {collapsed ? 'Show' : 'Hide'}
            </button>
          </div>
        )}
      </div>

      {coach.error && (
        <div className={styles.err} role="alert">
          {coach.error.message}
        </div>
      )}

      {cache && parsed ? (
        <>
          {parsed.headline && <div className={styles.head}>{parsed.headline}</div>}
          {!collapsed && (
            <div className={styles.body}>
              {parsed.insights.map((line) => (
                <div className={styles.line} key={line}>
                  {line}
                </div>
              ))}
              {parsed.today && <div className={styles.today}>Today: {parsed.today}</div>}
              {cache.result.steps.length > 0 && (
                <div className={styles.steps}>
                  <div className={styles.stepsLabel}>What the coach checked</div>
                  {cache.result.steps.map((s, i) => (
                    <div className={styles.step} key={`${s.tool}-${i}`}>
                      {s.summary}
                    </div>
                  ))}
                </div>
              )}
              <div className={`${styles.meta} ${stale ? styles.stale : ''}`}>
                {stale
                  ? "You've logged calls since this was written. Tap Refresh to update it."
                  : `Updated ${new Date(cache.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
              </div>
            </div>
          )}
        </>
      ) : (
        <button className={styles.btn} disabled={coach.isPending} onClick={() => coach.mutate()}>
          {coach.isPending ? 'Coach is reading your numbers...' : coach.error ? 'Try again' : 'Analyze my calls'}
        </button>
      )}
    </div>
  );
}
