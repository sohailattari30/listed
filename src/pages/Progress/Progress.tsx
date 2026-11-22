import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { Portal } from '../../components/Portal';
import { useRequiredProfile } from '../../auth/guards';
import { listCalls, listSessions, updateTerritory, zipHasData } from '../../lib/api';
import { buildMilestones } from '../../lib/milestones';
import { AVAILABLE_MARKETS, CANDIDATE_ZIPS, isZip, parseTerritory, territoryLabel } from '../../lib/territory';
import styles from './Progress.module.css';

function ChangeTerritoryModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = parseTerritory(value);
    if (!parsed) return setError('Please enter a zip code or city');
    setError(null);
    setSaving(true);
    try {
      if (isZip(parsed.city) && !(await zipHasData(parsed.city))) {
        const checks = await Promise.all(CANDIDATE_ZIPS.map(async (z) => ((await zipHasData(z)) ? z : null)));
        const available = checks.filter(Boolean).join(', ') || 'none loaded yet';
        setError(`No data for ${parsed.city}. Available: ${available}`);
        setSaving(false);
        return;
      }
      await updateTerritory(userId, parsed.zip, parsed.city);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      localStorage.removeItem('listed_session');
      onClose();
    } catch (err) {
      setError('Error: ' + (err instanceof Error ? err.message : 'unknown error'));
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.box} onSubmit={save} noValidate>
        <div className={styles.modalTitle}>Change territory</div>
        <label className={styles.modalLabel} htmlFor="new-zip">
          Zip code or city
        </label>
        <input id="new-zip" className={styles.modalInput} value={value} onChange={(e) => setValue(e.target.value)} placeholder="94536 or Fremont, CA" autoFocus />
        {error && (
          <div className={styles.modalErr} role="alert">
            {error}
          </div>
        )}
        <div className={styles.hint}>Available: {AVAILABLE_MARKETS.map((m) => `${m.zip} (${m.city.split(',')[0]})`).join(' · ')}</div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
    </Portal>
  );
}

export function Progress() {
  const { user, signOut } = useAuth();
  const userId = (user as NonNullable<typeof user>).id;
  const profile = useRequiredProfile();
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);

  const calls = useQuery({ queryKey: ['calls', userId], queryFn: () => listCalls(userId) });
  const sessions = useQuery({ queryKey: ['sessions', userId], queryFn: () => listSessions(userId) });

  const milestones =
    calls.data && sessions.data
      ? buildMilestones({
          name: profile.name,
          totalCalls: calls.data.length,
          hotLeads: calls.data.filter((c) => c.outcome === 'sell').length,
          totalSessions: sessions.data.length,
        })
      : null;

  return (
    <div className={`shell fade ${styles.page}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          First listing
          <br />
          <em>incoming.</em>
        </h1>
        <div className={styles.sub}>Agents who call daily list within 60 days.</div>
        <div className={styles.zipTag}>
          <div className={styles.zipDot} />
          <span>{territoryLabel(profile)}</span>
        </div>
      </div>

      <div className={styles.list}>
        {!milestones ? (
          <div className={styles.loading}>Loading...</div>
        ) : (
          milestones.map((m) => (
            <div className={styles.ms} key={m.title}>
              <div className={`${styles.node} ${styles[m.state]}`}>
                {m.state === 'done' && <div className={styles.check} />}
                {m.state === 'here' && <div className={styles.dot} />}
              </div>
              <div>
                <div className={`${styles.msTitle} ${m.dim ? styles.dim : ''}`}>{m.title}</div>
                <div className={styles.msSub}>{m.sub}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <Link className="btn" to="/today">
          Back to today
        </Link>
        <button className={styles.changeZip} onClick={() => setChanging(true)}>
          Change zip code / city
        </button>
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

      {changing && <ChangeTerritoryModal userId={userId} onClose={() => setChanging(false)} />}
    </div>
  );
}
