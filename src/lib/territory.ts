export const AVAILABLE_MARKETS = [
  { zip: '94536', city: 'Fremont, CA' },
  { zip: '94587', city: 'Union City, CA' },
  { zip: '94022', city: 'Los Altos, CA' },
] as const;

/** Zips probed to tell the user what data exists when theirs has none. */
export const CANDIDATE_ZIPS = ['94022', '94536', '94587', '94538', '94539', '94540', '94541', '94542', '94543', '94544', '94545'];

export const isZip = (value: string): boolean => /^\d{5}$/.test(value);

/** A territory is either a 5-digit zip or a free-text city. Returns null for empty input. */
export function parseTerritory(input: string): { zip: string; city: string } | null {
  const value = input.trim();
  if (!value) return null;
  return { zip: isZip(value) ? value : '', city: value };
}

export function territoryLabel(profile: { zip: string | null; city: string | null }): string {
  return (profile.zip ? `${profile.zip} · ${profile.city ?? ''}` : profile.city) || 'Not set';
}
