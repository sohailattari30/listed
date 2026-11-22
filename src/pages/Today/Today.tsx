import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { useRequiredProfile } from '../../auth/guards';
import { listCalls } from '../../lib/api';
import { buildForecast, CALLS_PER_DAY } from '../../lib/forecast';
import { CoachCard } from './CoachCard';
import styles from './Today.module.css';

const greetingFor = (hour: number) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

export function Today() {
  const { user, signOut } = useAuth();
  const userId = (user as NonNullable<typeof user>).id;
  const profile = useRequiredProfile();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const calls = useQuery({ queryKey: ['calls', userId], queryFn: () => listCalls(userId) });
  const hotLeads = calls.data?.filter((c) => c.outcome === 'sell').length ?? 0;
  const forecast = calls.data ? buildForecast(calls.data.length, hotLeads) : null;

  const now = new Date();
  const firstName = (profile.name ?? '').split(' ')[0] || 'Agent';

  return (
    <div className={`shell fade ${styles.page}`}>
      <div className={styles.top}>
        <div className={styles.wordmark}>Listed.</div>
        <div className={styles.date}>{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1 className={styles.headline}>
          Your
          <br />
          job
          <br />
          <em>today.</em>
        </h1>
        <div className={styles.market}>50 long-term owners · {profile.city || profile.zip}</div>

        <button className={styles.forecastWrap} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <div className={styles.pill}>
            <div className={styles.dot} />
            <div className={styles.pillText}>
              First listing forecast:{' '}
              {forecast ? <span>{forecast.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span> : 'calculating...'}
            </div>
          </div>
        </button>
        {expanded && forecast && (
          <div className={styles.expanded}>
            <div className={styles.row}>
              <div className={styles.rowLabel}>Warm leads so far</div>
              <div className={styles.rowValue}>{hotLeads}</div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>Leads still needed</div>
              <div className={styles.rowValue}>{forecast.leadsStillNeeded > 0 ? `${forecast.leadsStillNeeded} more` : '✓ Enough leads'}</div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>Your call rate</div>
              <div className={styles.rowValue}>{CALLS_PER_DAY} calls/day</div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>Days to listing</div>
              <div className={`${styles.rowValue} ${styles.green}`}>~{forecast.totalDays} days</div>
            </div>
            <div className={styles.note}>
              {forecast.personalized
                ? `Based on your conversion rate of ${(forecast.conversionRate * 100).toFixed(1)}%, blended with the industry average.`
                : 'Based on industry averages. Gets more accurate as you call more.'}
            </div>
          </div>
        )}
      </div>

      <CoachCard callCount={calls.data?.length} />

      <div className={styles.bottom}>
        <div className={styles.greeting}>
          {greetingFor(now.getHours())}, {firstName}.
        </div>
        <Link className="btn" to="/dial">
          Start calling →
        </Link>
        <button
          className={styles.signout}
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
