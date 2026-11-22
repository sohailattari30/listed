import { useQuery } from '@tanstack/react-query';
import { getProfile } from '../lib/api';
import { useAuth } from './AuthProvider';

export const profileKey = (userId: string | undefined) => ['profile', userId] as const;

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: profileKey(user?.id),
    queryFn: () => getProfile((user as NonNullable<typeof user>).id),
    enabled: !!user,
  });
}
