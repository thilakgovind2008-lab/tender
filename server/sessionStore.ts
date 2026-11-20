import crypto from 'node:crypto';
import type { SessionState } from './types.ts';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface StoredEntry {
  session: SessionState;
  expiresAtMs: number;
  locked: boolean;
}

const sessions = new Map<string, StoredEntry>();
const expiredSessionIds = new Set<string>();
const idempotencyKeys = new Map<string, { sessionId: string; createdAtMs: number }>();

function markExpiredId(sessionId: string): void {
  if (expiredSessionIds.size > 500) {
    const first = expiredSessionIds.values().next().value;
    if (first) expiredSessionIds.delete(first);
  }
  expiredSessionIds.add(sessionId);
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function createSessionRecord(
  initial: Omit<SessionState, 'sessionId' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'revision'>,
  options?: { ttlMs?: number; idempotencyKey?: string }
): SessionState {
  const now = Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

  if (options?.idempotencyKey) {
    const existing = idempotencyKeys.get(options.idempotencyKey);
    if (existing && now - existing.createdAtMs < 60_000) {
      const entry = sessions.get(existing.sessionId);
      if (entry && entry.expiresAtMs > now) {
        return entry.session;
      }
    }
  }

  const sessionId = generateId('tk');
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();

  const session: SessionState = {
    ...initial,
    sessionId,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    revision: 1,
  };

  sessions.set(sessionId, {
    session,
    expiresAtMs: now + ttlMs,
    locked: false,
  });

  if (options?.idempotencyKey) {
    idempotencyKeys.set(options.idempotencyKey, { sessionId, createdAtMs: now });
  }

  pruneExpiredSessions();
  return session;
}

export type SessionLookupResult =
  | { status: 'found'; session: SessionState }
  | { status: 'missing' }
  | { status: 'expired' };

export function lookupSession(sessionId: string): SessionLookupResult {
  if (!sessionId || typeof sessionId !== 'string') {
    return { status: 'missing' };
  }
  const entry = sessions.get(sessionId);
  if (!entry) {
    return expiredSessionIds.has(sessionId) ? { status: 'expired' } : { status: 'missing' };
  }
  if (Date.now() > entry.expiresAtMs) {
    sessions.delete(sessionId);
    markExpiredId(sessionId);
    return { status: 'expired' };
  }
  return { status: 'found', session: entry.session };
}

export type UpdateSessionResult =
  | { ok: true; session: SessionState }
  | { ok: false; code: 'missing' | 'expired' | 'conflict' | 'busy'; message: string; currentRevision?: number };

export async function updateSession(
  sessionId: string,
  expectedRevision: number | undefined,
  mutator: (session: SessionState) => Promise<void> | void
): Promise<UpdateSessionResult> {
  const entry = sessions.get(sessionId);
  if (!entry) {
    if (expiredSessionIds.has(sessionId)) {
      return {
        ok: false,
        code: 'expired',
        message: 'This Namma Tender session has expired. Please re-upload documents or load Sample Mode.',
      };
    }
    return {
      ok: false,
      code: 'missing',
      message: 'Session not found. The server may have restarted or the session ID is invalid.',
    };
  }
  if (Date.now() > entry.expiresAtMs) {
    sessions.delete(sessionId);
    markExpiredId(sessionId);
    return {
      ok: false,
      code: 'expired',
      message: 'This Namma Tender session has expired. Please re-upload documents or load Sample Mode.',
    };
  }
  if (entry.locked) {
    return {
      ok: false,
      code: 'busy',
      message: 'Another update is currently modifying this session. Please retry in a moment.',
      currentRevision: entry.session.revision,
    };
  }
  if (typeof expectedRevision === 'number' && expectedRevision !== entry.session.revision) {
    return {
      ok: false,
      code: 'conflict',
      message: `Session revision conflict (expected v${expectedRevision}, current v${entry.session.revision}). Reloading latest session state.`,
      currentRevision: entry.session.revision,
    };
  }

  entry.locked = true;
  try {
    // Work on a deep clone so failed mutations never leave partial state
    const draft: SessionState = structuredClone(entry.session);
    await mutator(draft);
    draft.revision = entry.session.revision + 1;
    draft.updatedAt = new Date().toISOString();
    entry.session = draft;
    return { ok: true, session: draft };
  } finally {
    entry.locked = false;
  }
}

export function deleteSession(sessionId: string): boolean {
  expiredSessionIds.delete(sessionId);
  return sessions.delete(sessionId);
}

export function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions.entries()) {
    if (now > entry.expiresAtMs) {
      sessions.delete(id);
      markExpiredId(id);
    }
  }
  for (const [key, rec] of idempotencyKeys.entries()) {
    if (now - rec.createdAtMs > 120_000) {
      idempotencyKeys.delete(key);
    }
  }
}
