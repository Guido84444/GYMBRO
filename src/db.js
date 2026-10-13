import { supabase } from './supabase.js';

// ── SESSIONI ──────────────────────────────────────────────────────────────────

export async function saveSessioDB(session, userId) {
  const payload = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: session.name,
    scheda_id: session.schedaId,
    body_kg: session.bodyKg,
    duration: session.duration,
    kcal: session.kcal,
    exercises: session.exercises,
    created_at: new Date(session.date).toISOString(),
  };
  console.log('Saving session payload:', JSON.stringify(payload));
  const { error } = await supabase.from('sessions').upsert(payload);
  if (error) console.log('Supabase error:', JSON.stringify(error));
  return error;
}

export async function loadSessioniDB(userId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => ({
    id: row.id,
    name: row.name,
    schedaId: row.scheda_id,
    bodyKg: row.body_kg,
    duration: row.duration,
    kcal: row.kcal,
    exercises: row.exercises,
    date: new Date(row.created_at).getTime(),
  }));
}

export async function deleteSessioneDB(sessionId) {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId);
  return error;
}