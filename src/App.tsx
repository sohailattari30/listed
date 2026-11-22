import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireProfile } from './auth/guards';
import { AppLayout } from './components/AppLayout';
import { FullScreenMessage } from './components/FullScreenMessage';
import { Login } from './pages/Login/Login';

// Everything behind the login page is split into its own chunk, so signed-out visitors
// don't download the dialer, the coach or the AI client.
const AuthCallback = lazy(() => import('./pages/AuthCallback').then((m) => ({ default: m.AuthCallback })));
const Contacts = lazy(() => import('./pages/Contacts/Contacts').then((m) => ({ default: m.Contacts })));
const Dial = lazy(() => import('./pages/Dial/Dial').then((m) => ({ default: m.Dial })));
const Onboarding = lazy(() => import('./pages/Onboarding/Onboarding').then((m) => ({ default: m.Onboarding })));
const Progress = lazy(() => import('./pages/Progress/Progress').then((m) => ({ default: m.Progress })));
const Today = lazy(() => import('./pages/Today/Today').then((m) => ({ default: m.Today })));

export function App() {
  return (
    <Suspense fallback={<FullScreenMessage>Loading…</FullScreenMessage>}>
    <Routes>
      <Route path="/" element={<Login />} />
      {/* The .html path is kept because it is already allow-listed as the OAuth redirect URL. */}
      <Route path="/auth-callback.html" element={<AuthCallback />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<AppLayout />}>
          <Route element={<RequireProfile territory />}>
            <Route path="/today" element={<Today />} />
          </Route>
          <Route element={<RequireProfile />}>
            <Route path="/dial" element={<Dial />} />
            <Route path="/progress" element={<Progress />} />
          </Route>
          <Route path="/contacts" element={<Contacts />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
