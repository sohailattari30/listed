import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createProfile, getProfile } from '../lib/api';

/** Landing page for OAuth sign-in: make sure a profile exists, then route to onboarding or Today. */
export function AuthCallback() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Processing...');
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;

    async function finish() {
      if (!user) {
        setStatus('No session found — redirecting...');
        setTimeout(() => navigate('/', { replace: true }), 2000);
        return;
      }
      try {
        setStatus('Logged in! Setting up your account...');
        const profile = await getProfile(user.id);
        if (!profile) {
          const meta = user.user_metadata as { full_name?: string } | undefined;
          await createProfile(user.id, meta?.full_name || user.email || 'Agent');
          navigate('/onboarding', { replace: true });
        } else if (!profile.zip && !profile.city) {
          navigate('/onboarding', { replace: true });
        } else {
          navigate('/today', { replace: true });
        }
      } catch (err) {
        setStatus('Error: ' + (err instanceof Error ? err.message : 'unknown error'));
        setTimeout(() => navigate('/', { replace: true }), 2000);
      }
    }
    void finish();
  }, [loading, user, navigate]);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div style={{ color: 'rgba(0,0,0,.4)', fontSize: 15, fontWeight: 500 }}>Signing you in...</div>
      <div style={{ color: 'rgba(0,0,0,.25)', fontSize: 12 }}>{status}</div>
    </div>
  );
}
