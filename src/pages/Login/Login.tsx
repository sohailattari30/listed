import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { createProfile } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import styles from './Login.module.css';

type View = 'login' | 'signup';
type Message = { kind: 'err' | 'ok'; text: string };

const EYE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EYE_OFF = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.6 19.6 0 0 1 5.06-6.06M9.9 4.24A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a19.7 19.7 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

function PasswordField(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`${styles.field} ${styles.fieldPass}`}>
      <label htmlFor={props.id}>Password</label>
      <input
        id={props.id}
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
      />
      <button type="button" className={styles.passToggle} aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((v) => !v)}>
        {visible ? EYE_OFF : EYE}
      </button>
    </div>
  );
}

function SocialButtons({ onProvider }: { onProvider: (p: 'google' | 'apple') => void }) {
  return (
    <>
      <div className={styles.divider}>or</div>
      <button type="button" className={styles.social} onClick={() => onProvider('google')}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.27a12 12 0 0 0 0 10.73z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.63l4 3.1c.95-2.85 3.6-4.98 6.73-4.98z" />
        </svg>
        Continue with Google
      </button>
      <button type="button" className={styles.social} onClick={() => onProvider('apple')}>
        <svg viewBox="0 0 24 24" fill="#0A0A0A" aria-hidden="true">
          <path d="M16.36 1c.1 1.1-.32 2.18-.98 2.98-.68.82-1.8 1.46-2.9 1.37-.13-1.07.38-2.2 1.02-2.94C14.2 1.6 15.32 1.02 16.36 1zm3.9 17.13c-.4.93-.88 1.83-1.5 2.66-.85 1.13-1.55 1.9-2.62 1.92-1.03.02-1.37-.67-2.56-.67-1.2 0-1.57.65-2.56.69-1.03.04-1.82-1.22-2.68-2.34-1.46-1.9-2.58-5.37-1.08-7.71.74-1.16 2.06-1.9 3.5-1.92 1-.02 1.95.68 2.56.68.6 0 1.75-.84 2.95-.72.5.02 1.92.2 2.83 1.53-.07.05-1.69.99-1.67 2.95.02 2.35 2.06 3.13 2.09 3.14z" />
        </svg>
        Continue with Apple
      </button>
    </>
  );
}

export function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>('login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const show = (next: View) => {
    setView(next);
    setMessage(null);
    setPassword('');
  };
  const fail = (text: string) => setMessage({ kind: 'err', text });

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return fail('Please enter email and password.');
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      fail(error.message);
      setBusy(false);
      return;
    }
    navigate('/today');
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) return fail('Please fill in all fields.');
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    if (error) {
      fail(error.message);
      setBusy(false);
      return;
    }
    if (data.user && data.session) {
      try {
        await createProfile(data.user.id, name.trim());
      } catch {
        // A database trigger may already have created the profile row.
      }
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      navigate('/onboarding');
      return;
    }
    setBusy(false);
    setMessage({ kind: 'ok', text: 'Check your email to confirm your account, then sign in.' });
  }

  async function handleProvider(provider: 'google' | 'apple') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth-callback.html` },
    });
    if (error) fail(error.message);
  }

  async function handleForgot() {
    setMessage(null);
    if (!email.trim()) return fail('Enter your email above first, then tap "Forgot password?".');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) return fail(error.message);
    setMessage({ kind: 'ok', text: 'Check your email for a reset link.' });
  }

  if (session && !busy) return <Navigate to="/today" replace />;

  const feedback = message && (
    <div className={message.kind === 'err' ? styles.err : styles.ok} role={message.kind === 'err' ? 'alert' : 'status'}>
      {message.text}
    </div>
  );

  return (
    <div className={styles.shell}>
      <div className={styles.formPanel}>
        <div className={styles.brand}>
          <div className={styles.wordmark}>Listed.</div>
        </div>

        {view === 'login' ? (
          <form className={styles.view} onSubmit={handleSignIn} noValidate>
            <h1 className={styles.title}>Sign in</h1>
            <div className={styles.sub}>
              Don't have an account?{' '}
              <button type="button" className={styles.link} onClick={() => show('signup')}>
                Create now
              </button>
            </div>

            <div className={styles.field}>
              <label htmlFor="l-email">Email</label>
              <input id="l-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alex@email.com" autoComplete="email" />
            </div>
            <PasswordField id="l-pass" value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />

            <div className={styles.rowBetween}>
              <label className={styles.remember}>
                <input type="checkbox" defaultChecked />
                <span>Remember me</span>
              </label>
              <button type="button" className={styles.linkMuted} onClick={handleForgot}>
                Forgot password?
              </button>
            </div>

            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
            {feedback}
            <SocialButtons onProvider={handleProvider} />
          </form>
        ) : (
          <form className={styles.view} onSubmit={handleSignUp} noValidate>
            <h1 className={styles.title}>Create account</h1>
            <div className={styles.sub}>
              Already have an account?{' '}
              <button type="button" className={styles.link} onClick={() => show('login')}>
                Sign in
              </button>
            </div>

            <div className={styles.field}>
              <label htmlFor="s-name">First name</label>
              <input id="s-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" autoComplete="given-name" />
            </div>
            <div className={styles.field}>
              <label htmlFor="s-email">Email</label>
              <input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alex@email.com" autoComplete="email" />
            </div>
            <PasswordField id="s-pass" value={password} onChange={setPassword} placeholder="At least 6 characters" autoComplete="new-password" />

            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? 'Creating account...' : 'Create account'}
            </button>
            {feedback}
            <SocialButtons onProvider={handleProvider} />
          </form>
        )}
      </div>

      <aside className={styles.visualPanel} aria-hidden="true">
        <svg className={styles.rings} viewBox="0 0 280 280">
          <circle cx="140" cy="140" r="50" />
          <circle cx="140" cy="140" r="90" />
          <circle cx="140" cy="140" r="130" />
        </svg>
        <div className={styles.visualTop}>
          <a className={styles.help} href="mailto:support@listed.app" tabIndex={-1}>
            <svg viewBox="0 0 24 24">
              <path d="M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1v-8H4v-2a8 8 0 0 1 16 0v2h-3v8h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z" />
            </svg>
            Support
          </a>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Hit your streak faster</div>
          <div className={styles.cardText}>50 verified homeowner numbers, queued and ready to dial — every single morning.</div>
          <div className={styles.cardStat}>
            <span className={styles.statLabel}>Today's calls</span>
            <span className={styles.statValue}>41 / 50</span>
          </div>
        </div>
        <div className={styles.visualBottom}>
          <div className={styles.visualHeading}>Introducing streak tracking</div>
          <div className={styles.visualSub}>See exactly how many days in a row you've hit your calling goal, and what it's done for your pipeline.</div>
          <div className={styles.dots}>
            <span className={`${styles.dot} ${styles.dotActive}`} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </div>
        </div>
      </aside>
    </div>
  );
}
