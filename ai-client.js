// Calls the "ai" Supabase Edge Function as the signed-in user. Requires supabase-client.js (db).
async function callAI(body) {
  const { data, error } = await db.functions.invoke('ai', { body });
  if (error) {
    let msg = 'AI is unavailable right now.';
    try {
      const j = await error.context.json();
      if (j && j.error) msg = j.error;
    } catch (e) {}
    throw new Error(msg);
  }
  return data;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
