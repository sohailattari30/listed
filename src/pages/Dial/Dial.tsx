import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { useRequiredProfile } from '../../auth/guards';
import { profileKey } from '../../auth/useProfile';
import { listCalls, listHomeowners, updateTerritory } from '../../lib/api';
import { clearSnapshot } from '../../lib/queue';
import { AVAILABLE_MARKETS } from '../../lib/territory';
import { DialSession } from './DialSession';
import styles from './Dial.module.css';

export function Dial() {
  const { user } = useAuth();
  const userId = (user as NonNullable<typeof user>).id;
  const profile = useRequiredProfile();
  const queryClient = useQueryClient();
  const zip = profile.zip ?? '';

  const homeowners = useQuery({ queryKey: ['homeowners', zip], queryFn: () => listHomeowners(zip), staleTime: 10 * 60_000 });
  const calls = useQuery({ queryKey: ['calls', userId], queryFn: () => listCalls(userId) });

  async function useZip(newZip: string, city: string) {
    await updateTerritory(userId, newZip, city);
    clearSnapshot(localStorage);
    await queryClient.invalidateQueries({ queryKey: profileKey(userId) });
  }

  if (homeowners.isPending || calls.isPending) {
    return (
      <div className={`shell ${styles.page}`}>
        <div className={styles.loadingScreen}>Loading your territory...</div>
      </div>
    );
  }

  if (homeowners.isError || homeowners.data.length === 0) {
    return (
      <div className={`shell ${styles.page}`}>
        <div className={styles.noData}>
          <div className={styles.noDataTitle}>
            No data for
            <br />
            that zip code.
          </div>
          <div className={styles.noDataSub}>We have homeowner data for these markets. Pick one to get started.</div>
          <div className={styles.zipOptions}>
            {AVAILABLE_MARKETS.map((m) => (
              <button className={styles.zipOption} key={m.zip} onClick={() => void useZip(m.zip, m.city)}>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.zip}</div>
                  <div className={styles.zipCity}>{m.city}</div>
                </div>
                <span>→</span>
              </button>
            ))}
          </div>
          <Link className={styles.backLink} to="/today">
            Back to today
          </Link>
        </div>
      </div>
    );
  }

  return <DialSession key={zip} userId={userId} zip={zip} city={profile.city ?? ''} homeowners={homeowners.data} calls={calls.data ?? []} />;
}
