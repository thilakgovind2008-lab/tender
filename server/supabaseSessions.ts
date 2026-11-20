import { createClient } from '@supabase/supabase-js';
import type { SessionState } from './types.ts';

export function createSessionRepository() {
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const table = () => client.from('bid_session_snapshots');

  return {
    async create(ownerId: string, state: SessionState) {
      const { error } = await table().upsert(
        {
          session_id: state.sessionId,
          owner_id: ownerId,
          revision: state.revision,
          state,
        },
        { onConflict: 'session_id', ignoreDuplicates: true }
      );
      if (error) throw new Error('Could not save the bid session.');
    },
    async get(ownerId: string, id: string): Promise<SessionState | null> {
      const { data, error } = await table()
        .select('state')
        .eq('owner_id', ownerId)
        .eq('session_id', id)
        .maybeSingle();
      if (error) throw new Error('Could not load the bid session.');
      return data?.state ?? null;
    },
    async list(ownerId: string, limit = 10): Promise<Array<{ sessionId: string; updatedAt: string; state: SessionState }>> {
      const { data, error } = await table()
        .select('session_id, updated_at, state')
        .eq('owner_id', ownerId)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error('Could not list saved bid sessions.');
      return (data || []).map((row) => ({
        sessionId: String(row.session_id),
        updatedAt: String(row.updated_at),
        state: row.state as SessionState,
      }));
    },
    async update(ownerId: string, state: SessionState, previousRevision: number) {
      const { data, error } = await table()
        .update({ state, revision: state.revision, updated_at: state.updatedAt })
        .eq('owner_id', ownerId)
        .eq('session_id', state.sessionId)
        .eq('revision', previousRevision)
        .select('session_id')
        .maybeSingle();
      if (error) throw new Error('Could not update the bid session.');
      return Boolean(data);
    },
    async remove(ownerId: string, id: string) {
      const { error } = await table().delete().eq('owner_id', ownerId).eq('session_id', id);
      if (error) throw new Error('Could not delete the bid session.');
    },
  };
}
