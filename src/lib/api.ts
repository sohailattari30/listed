import { supabase } from './supabase';
import type { CallRow, ContactRow, HomeownerRow, Outcome, SessionRow, UserRow } from './database.types';

type Result<T> = { data: T; error: { message: string } | null };

/** List queries: throws on error, otherwise returns the rows. */
function rows<T>(result: Result<T>): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as NonNullable<T>;
}

/** Single-row queries where "no row" is a normal answer. */
function maybe<T>(result: Result<T>): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Writes: throws on error, returns nothing. */
function done(result: Result<unknown>): void {
  if (result.error) throw new Error(result.error.message);
}

export async function getProfile(userId: string): Promise<UserRow | null> {
  return maybe(await supabase.from('users').select('*').eq('id', userId).maybeSingle());
}

export async function createProfile(userId: string, name: string): Promise<void> {
  done(await supabase.from('users').insert({ id: userId, name, zip: '', city: '' }));
}

export async function updateTerritory(userId: string, zip: string, city: string): Promise<void> {
  done(await supabase.from('users').update({ zip, city }).eq('id', userId));
}

export async function zipHasData(zip: string): Promise<boolean> {
  return rows(await supabase.from('homeowners').select('zip').eq('zip', zip).limit(1)).length > 0;
}

export async function listHomeowners(zip: string): Promise<HomeownerRow[]> {
  let query = supabase.from('homeowners').select('*');
  if (zip) query = query.eq('zip', zip);
  return rows(await query.limit(300));
}

export async function listCalls(userId: string): Promise<Pick<CallRow, 'homeowner_id' | 'outcome'>[]> {
  return rows(await supabase.from('calls').select('homeowner_id,outcome').eq('user_id', userId));
}

export async function insertCall(userId: string, homeownerId: CallRow['homeowner_id'], outcome: Outcome): Promise<void> {
  done(await supabase.from('calls').insert({ user_id: userId, homeowner_id: homeownerId, outcome }));
}

export async function listSessions(userId: string): Promise<SessionRow[]> {
  return rows(await supabase.from('sessions').select('*').eq('user_id', userId));
}

export async function insertSession(userId: string, callsMade: number, hotLeads: number): Promise<void> {
  done(
    await supabase.from('sessions').insert({
      user_id: userId,
      calls_made: callsMade,
      hot_leads: hotLeads,
      session_date: new Date().toISOString().split('T')[0] ?? '',
    }),
  );
}

export async function listContacts(userId: string): Promise<ContactRow[]> {
  return rows(await supabase.from('contacts').select('*').eq('user_id', userId).order('created_at', { ascending: false }));
}

export async function insertContact(contact: Omit<ContactRow, 'id' | 'created_at'>): Promise<void> {
  done(await supabase.from('contacts').insert(contact));
}

export async function deleteContact(id: ContactRow['id']): Promise<void> {
  done(await supabase.from('contacts').delete().eq('id', id));
}
