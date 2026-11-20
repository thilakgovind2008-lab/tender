import { supabase } from '../lib/supabase';
import type {
  ChatLanguage,
  IntegrationBoundaries,
  SessionState,
} from '../../server/types';

export async function authenticatedFetch(url: string, init?: RequestInit) {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(init?.headers);
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);
  return globalThis.fetch(url, { ...init, headers });
}

const fetch = authenticatedFetch;

export type {
  AuditEvent,
  ChatLanguage,
  ChatTurn,
  EvidenceMatch,
  HumanDecision,
  IntegrationBoundaries,
  RescueAction,
  SessionState,
  TenderRequirement,
  ValidationFinding,
  ValidationStatus,
} from '../../server/types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly category?: string;

  constructor(message: string, status: number, extra?: { code?: string; category?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = extra?.code;
    this.category = extra?.category;
  }
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(text || `HTTP ${res.status}`, res.status);
  }
}

export async function checkServerHealth(): Promise<{
  ok: boolean;
  provider: string;
  model: string;
  keyConfigured: boolean;
  integrations: IntegrationBoundaries;
}> {
  const res = await fetch('/api/health');
  const data = await parseJsonSafe<Record<string, unknown>>(res);
  if (!res.ok) {
    throw new ApiError(String(data.error || 'Health check failed'), res.status);
  }
  return data as unknown as {
    ok: boolean;
    provider: string;
    model: string;
    keyConfigured: boolean;
    integrations: IntegrationBoundaries;
  };
}

export async function createSampleSessionApi(): Promise<{
  session: SessionState;
  progressSteps: string[];
}> {
  const res = await fetch('/api/sessions/sample', { method: 'POST' });
  const data = await parseJsonSafe<{
    ok: boolean;
    session: SessionState;
    progressSteps?: string[];
    error?: string;
  }>(res);
  if (!res.ok || !data.ok) {
    throw new ApiError(data.error || 'Failed to create Sample Mode session.', res.status);
  }
  return { session: data.session, progressSteps: data.progressSteps || [] };
}

export async function analyzeLiveBidApi(params: {
  companyName: string;
  district: string;
  sector: string;
  deadline: string;
  tenderReference?: string;
  email?: string;
  tenderPdf: File;
  supplierZip: File;
  corrigendumPdf?: File | null;
  idempotencyKey?: string;
}): Promise<{ session: SessionState; progressSteps: string[] }> {
  const form = new FormData();
  form.append('companyName', params.companyName);
  form.append('district', params.district);
  form.append('sector', params.sector);
  form.append('deadline', params.deadline);
  if (params.tenderReference) form.append('tenderReference', params.tenderReference);
  if (params.email) form.append('email', params.email);
  form.append('tenderPdf', params.tenderPdf);
  form.append('supplierZip', params.supplierZip);
  if (params.corrigendumPdf) {
    form.append('corrigendumPdf', params.corrigendumPdf);
  }

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['x-idempotency-key'] = params.idempotencyKey;
  }

  const res = await fetch('/api/sessions/analyze', {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    progressSteps?: string[];
    error?: string;
    category?: string;
  }>(res);

  if (!res.ok || !data.ok || !data.session) {
    throw new ApiError(
      data.error || 'Tender analysis failed.',
      res.status,
      { category: data.category }
    );
  }
  return { session: data.session, progressSteps: data.progressSteps || [] };
}

export async function fetchSessionApi(sessionId: string): Promise<SessionState> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    code?: string;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.session) {
    throw new ApiError(data.error || 'Failed to load session.', res.status, { code: data.code });
  }
  return data.session;
}

export async function sendChatMessageApi(params: {
  sessionId: string;
  message: string;
  language: ChatLanguage;
  revision?: number;
}): Promise<{
  session: SessionState;
  reply: string;
  toolUsed: string;
  progressSteps: string[];
  citedRequirements: string[];
  exportReady?: boolean;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(params.sessionId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: params.message,
      language: params.language,
      revision: params.revision,
    }),
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    reply?: string;
    toolUsed?: string;
    progressSteps?: string[];
    citedRequirements?: string[];
    exportReady?: boolean;
    code?: string;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.session) {
    throw new ApiError(data.error || 'Chat request failed.', res.status, { code: data.code });
  }
  return {
    session: data.session,
    reply: data.reply || '',
    toolUsed: data.toolUsed || '',
    progressSteps: data.progressSteps || [],
    citedRequirements: data.citedRequirements || [],
    exportReady: data.exportReady,
  };
}

export async function recordDecisionApi(params: {
  sessionId: string;
  requirementId: string;
  action: 'agree' | 'dispute' | 'approve';
  note: string;
  language: ChatLanguage;
  revision?: number;
}): Promise<{ ok: boolean; session: SessionState; message?: string }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(params.sessionId)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirementId: params.requirementId,
      action: params.action,
      note: params.note,
      language: params.language,
      revision: params.revision,
    }),
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    message?: string;
    error?: string;
    code?: string;
  }>(res);

  if (!data.session) {
    throw new ApiError(data.error || data.message || 'Decision failed.', res.status, {
      code: data.code,
    });
  }
  return {
    ok: Boolean(data.ok),
    session: data.session,
    message: data.message,
  };
}

export async function uploadCorrectedPdfApi(params: {
  sessionId: string;
  correctedPdf: File;
  targetRequirementId?: string;
  revision?: number;
}): Promise<{
  session: SessionState;
  affectedRequirements: string[];
  progressSteps: string[];
}> {
  const form = new FormData();
  form.append('correctedPdf', params.correctedPdf);
  if (params.targetRequirementId) {
    form.append('targetRequirementId', params.targetRequirementId);
  }
  if (typeof params.revision === 'number') {
    form.append('revision', String(params.revision));
  }

  const res = await fetch(`/api/sessions/${encodeURIComponent(params.sessionId)}/correct`, {
    method: 'POST',
    body: form,
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    affectedRequirements?: string[];
    progressSteps?: string[];
    error?: string;
    code?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.session) {
    throw new ApiError(data.error || 'Corrected upload failed.', res.status, { code: data.code });
  }
  return {
    session: data.session,
    affectedRequirements: data.affectedRequirements || [],
    progressSteps: data.progressSteps || [],
  };
}

export async function fetchReportPreviewApi(sessionId: string): Promise<{ html: string; revision: number }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/report?format=json`);
  const data = await parseJsonSafe<{ ok: boolean; html?: string; revision?: number; error?: string }>(
    res
  );
  if (!res.ok || !data.ok || !data.html) {
    throw new ApiError(data.error || 'Failed to load report.', res.status);
  }
  return { html: data.html, revision: data.revision || 1 };
}

export async function downloadReport(sessionId: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/report`);
  if (!response.ok) throw new ApiError('Could not download the report. Check your sign-in and retry.', response.status);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'NammaTender_Report.html';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function transcribeVoiceApi(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'voice.webm');
  const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
  const data = await parseJsonSafe<{ ok: boolean; transcript?: string; error?: string }>(res);
  if (!res.ok || !data.ok || !data.transcript) {
    throw new ApiError(data.error || 'Voice transcription failed.', res.status);
  }
  return data.transcript;
}

export async function speakVoiceApi(
  text: string,
  language: 'ta-IN' | 'en-IN'
): Promise<{ audio_base64: string; mime_type: string }> {
  const res = await fetch('/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    audio_base64?: string;
    mime_type?: string;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.audio_base64 || !data.mime_type) {
    throw new ApiError(data.error || 'Voice playback failed.', res.status);
  }
  return { audio_base64: data.audio_base64, mime_type: data.mime_type };
}

export async function dispatchAutomationApi(params: {
  sessionId: string;
  confirmDispatch: boolean;
  recipientEmail?: string;
}): Promise<{ session: SessionState; message: string }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(params.sessionId)}/automate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmDispatch: params.confirmDispatch,
      recipientEmail: params.recipientEmail,
    }),
  });
  const data = await parseJsonSafe<{
    ok: boolean;
    session?: SessionState;
    message?: string;
    error?: string;
  }>(res);
  if (!res.ok || !data.ok || !data.session) {
    throw new ApiError(data.error || 'Automation dispatch failed.', res.status);
  }
  return {
    session: data.session,
    message: data.message || 'Compliance reminder dispatched.',
  };
}
