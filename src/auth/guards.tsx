import { createContext, useContext } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { FullScreenMessage } from '../components/FullScreenMessage';
import type { UserRow } from '../lib/database.types';
import { useAuth } from './AuthProvider';
import { useProfile } from './useProfile';

/** Sends signed-out visitors to the login page. */
export function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}

const ProfileContext = createContext<UserRow | null>(null);

/**
 * Loads the signed-in user's profile and sends them to onboarding if it is missing
 * (or, with `territory`, if they have not picked a market yet).
 */
export function RequireProfile({ territory = false }: { territory?: boolean }) {
  const { data: profile, isPending, error } = useProfile();
  if (isPending) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (error) return <FullScreenMessage>Something went wrong: {error.message}</FullScreenMessage>;
  if (!profile || (territory && !profile.zip && !profile.city)) return <Navigate to="/onboarding" replace />;
  return (
    <ProfileContext.Provider value={profile}>
      <Outlet />
    </ProfileContext.Provider>
  );
}

export function useRequiredProfile(): UserRow {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error('useRequiredProfile must be used under <RequireProfile>');
  return profile;
}
