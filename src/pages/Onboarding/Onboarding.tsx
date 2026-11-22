import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { useProfile } from '../../auth/useProfile';
import { updateTerritory } from '../../lib/api';
import { parseTerritory } from '../../lib/territory';
import styles from './Onboarding.module.css';

export function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile, isPending } = useProfile();
  const [territory, setTerritory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Already picked a market: nothing to do here.
  if (!isPending && profile && (profile.zip || profile.city)) return <Navigate to="/today" replace />;

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = parseTerritory(territory);
    if (!parsed) return setError('Please enter a zip code or city');
    if (!user) return;
    setError(null);
    setSaving(true);
    try {
      await updateTerritory(user.id, parsed.zip, parsed.city);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      navigate('/today');
    } catch (err) {
      setError('Something went wrong: ' + (err instanceof Error ? err.message : 'unknown error'));
      setSaving(false);
    }
  }

  return (
    <form className={styles.page} onSubmit={save} noValidate>
      <div>
        <div className={styles.wordmark}>Listed.</div>
        <h1 className={styles.headline}>
          Your
          <br />
          <em>market?</em>
        </h1>
        <div className={styles.desc}>We'll pull 50 long-term homeowners there every morning.</div>
        <div className={styles.field}>
          <label htmlFor="f-territory">Zip code or city</label>
          <input id="f-territory" type="text" value={territory} onChange={(e) => setTerritory(e.target.value)} placeholder="94536 or Fremont, CA" autoComplete="off" />
          {error && (
            <div className={styles.err} role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button className={styles.btn} type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Get my numbers →'}
        </button>
        <div className={styles.fine}>Long-term owners only · Real numbers · Refreshed daily</div>
      </div>
    </form>
  );
}
