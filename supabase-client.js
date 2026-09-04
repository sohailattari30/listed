// Shared Supabase client — imported by every page
const SUPABASE_URL = 'https://ryswljmdqzbnquppktne.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5c3dsam1kcXpibnF1cHBrdG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NjQ0NDcsImV4cCI6MjA5NDA0MDQ0N30.ICzN48heFa2RPvK-gXbJLn1e8_mQt4cXoaUX265ii_Y';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
