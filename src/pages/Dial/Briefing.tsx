import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBriefing } from '../../lib/ai';
import type { Id } from '../../lib/database.types';
import styles from './Briefing.module.css';

/** One model call (not an agent): opener, angle and objection replies for this homeowner. Fetched on tap and cached. */
export function Briefing({ homeownerId }: { homeownerId: Id }) {
  const queryClient = useQueryClient();
  const queryKey = ['briefing', homeownerId];
  const [requested, setRequested] = useState(() => queryClient.getQueryData(queryKey) !== undefined);
  const briefing = useQuery({
    queryKey,
    queryFn: () => fetchBriefing(homeownerId),
    enabled: requested,
    staleTime: Infinity,
    retry: false,
  });

  if (briefing.data) {
    const b = briefing.data;
    return (
      <div className={styles.card}>
        <div className={styles.label}>Opener</div>
        <div className={styles.opener}>{b.opener}</div>
        <div className={styles.label}>Why this call</div>
        <div className={styles.text}>{b.angle}</div>
        <div className={styles.label}>If they say...</div>
        {b.objections.map((o) => (
          <div className={styles.objection} key={o.objection}>
            <b>{o.objection}</b>
            <br />
            <span>{o.response}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {briefing.error && (
        <div className={styles.err} role="alert">
          {briefing.error.message}
        </div>
      )}
      <button
        className={styles.btn}
        disabled={briefing.isFetching}
        onClick={() => (requested ? void briefing.refetch() : setRequested(true))}
      >
        <span>{briefing.isFetching ? 'Preparing briefing...' : briefing.error ? 'Try briefing again' : 'Get call briefing'}</span>
        <span className={styles.tag}>AI</span>
      </button>
    </>
  );
}
