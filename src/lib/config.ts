// The anon key is public by design: Supabase row-level security is what protects the data.
// Override per environment with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://ryswljmdqzbnquppktne.supabase.co';
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5c3dsam1kcXpibnF1cHBrdG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NjQ0NDcsImV4cCI6MjA5NDA0MDQ0N30.ICzN48heFa2RPvK-gXbJLn1e8_mQt4cXoaUX265ii_Y';
