import { reminderRequest } from './server/reminder.ts';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeminiStructuredProbe } from './server/geminiProbe.ts';
import { handleSessionChatTurn } from './server/chat.ts';
import {
  createRateLimiter,
  isSafeExternalWebhookUrl,
  isValidOptionalEmail,
  isValidSessionId,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_COMPANY_NAME_CHARS,
  MAX_NOTE_CHARS,
  MAX_REF_CHARS,
  redactSecrets,
  sanitizeSingleLineInput,
} from './server/guardrails.ts';
import { IngestionError, MAX_ZIP_BYTES } from './server/ingest.ts';
import { getActiveGeminiModel } from './server/llm.ts';
import {
  PipelineError,
  recheckCorrectedDocumentInSession,
  runLiveAnalysisPipeline,
} from './server/pipeline.ts';
import { renderHtmlReadinessReport } from './server/report.ts';
import {
  createSampleSession,
  getSampleCorrectedIsoPdfBuffer,
} from './server/sampleData.ts';
import {
  deleteSession,
  generateId,
  lookupSession,
  updateSession as updateMemorySession,
  type UpdateSessionResult,
} from './server/sessionStore.ts';
import { executeGroundedTool } from './server/tools.ts';
import { speak, transcribe, VoiceError } from './server/sarvam.ts';
import { createSessionRepository } from './server/supabaseSessions.ts';
import type { SessionState } from './server/types.ts';
import type { ChatLanguage, IntegrationBoundaries } from './server/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ZIP_BYTES,
    files: 4,
  },
});

function getIntegrationBoundaries(): IntegrationBoundaries {
  const sarvamReady = Boolean(process.env.SARVAM_API_KEY?.trim());
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  const n8nSecret = process.env.AUTOMATION_SHARED_SECRET?.trim();
  const n8nReady = Boolean(process.env.N8N_REMINDERS_VERIFIED === 'true' && n8nWebhookUrl && n8nSecret && /^https?:\/\//i.test(n8nWebhookUrl));
  return {
    sarvamVoice: {
      connected: sarvamReady,
      purpose: 'Tamil & mixed Tanglish speech-to-text and voice playback',
      note: sarvamReady
        ? 'Sarvam is enabled for server-side Tamil/English transcription and speech. Review the transcript before it is sent.'
        : 'Sarvam AI access is not configured; browser Web Speech API fallback and editable text input are active.',
    },
    n8nAutomation: {
      connected: n8nReady,
      requiresExplicitAuthorization: true,
      purpose: 'Authorized external reminders and compliance notifications',
      note: n8nReady
        ? 'n8n compliance reminder dispatcher is configured. Reminders only send when explicitly authorized by you.'
        : 'The n8n workflow is prepared. Add N8N_WEBHOOK_URL and AUTOMATION_SHARED_SECRET to enable explicit dispatch.',
    },
  };
}

export function applySecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
  res.setHeader('X-XSS-Protection', '0');
  next();
}

export function createApiRouter(options?: { maxAiRequestsPerMinute?: number }) {
  const router = express.Router();
  router.use(applySecurityHeaders);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const aiRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: options?.maxAiRequestsPerMinute ?? 40,
  });

  const repository = createSessionRepository();
  const liveOwners = new Map<string, string>();
  const projectUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)?.trim();
  const publishableKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  )?.trim();
  const auth = projectUrl && publishableKey
    ? createClient(projectUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  async function requireUser(req: Request, res: Response, next: NextFunction) {
    if (!auth) {
      if (!process.env.VERCEL) {
        res.locals.ownerId = 'local-dev';
        next();
        return;
      }
      res.status(401).json({ ok: false, error: 'Sign in to use live bid analysis.' });
      return;
    }
    const token = req.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ ok: false, error: 'Sign in to use live bid analysis.' });
      return;
    }
    try {
      const { data, error } = await auth.auth.getUser(token);
      if (error || !data.user || data.user.is_anonymous) {
        res.status(401).json({ ok: false, error: 'Sign in again to continue.' });
        return;
      }
      res.locals.ownerId = data.user.id;
      next();
    } catch {
      res.status(503).json({ ok: false, error: 'Sign-in verification is temporarily unavailable.' });
    }
  }

  router.use('/sessions/:id', (req, res, next) => {
    const id = req.params.id;
    if (req.method === 'POST' && (id === 'analyze' || id === 'sample')) return next();
    if (!isValidSessionId(id)) {
      res.status(400).json({ ok: false, error: 'Invalid session ID format.' });
      return;
    }
    const found = lookupSession(id);
    if (repository && !(found.status === 'found' && found.session.mode === 'SAMPLE')) {
      void requireUser(req, res, () => {
        void repository.get(res.locals.ownerId, id).then((session) => {
          if (!session) {
            res.status(404).json({ ok: false, code: 'missing', error: 'Session not found.' });
            return;
          }
          res.locals.savedSession = session;
          next();
        }).catch(next);
      });
      return;
    }
    if (found.status !== 'found' || found.session.mode === 'SAMPLE') {
      if (found.status === 'expired') liveOwners.delete(id);
      next();
      return;
    }
    void requireUser(req, res, () => {
      if (liveOwners.get(id) !== res.locals.ownerId) {
        res.status(404).json({ ok: false, error: 'Session not found.' });
        return;
      }
      next();
    });
  });

  function requestSession(req: Request, res: Response) {
    const session: SessionState | undefined = res.locals.savedSession;
    return session ? { status: 'found' as const, session } : lookupSession(req.params.id);
  }

  async function updateSession(
    res: Response,
    id: string,
    expectedRevision: number | undefined,
    mutate: (draft: SessionState) => void | Promise<void>,
  ): Promise<UpdateSessionResult> {
    const state: SessionState | undefined = res.locals.savedSession;
    if (!repository || !state) return updateMemorySession(id, expectedRevision, mutate);
    const conflict = { ok: false as const, code: 'conflict' as const, message: 'Session changed. Reload before retrying.' };
    if (expectedRevision !== undefined && state.revision !== expectedRevision) return conflict;
    const draft = structuredClone(state);
    await mutate(draft);
    draft.revision++;
    draft.updatedAt = new Date().toISOString();
    return await repository.update(res.locals.ownerId, draft, state.revision)
      ? { ok: true, session: draft }
      : conflict;
  }

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'namma-tender-api',
      provider: process.env.LLM_PROVIDER || 'gemini',
      model: getActiveGeminiModel(),
      keyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      supabaseConfigured: Boolean(auth),
      integrations: getIntegrationBoundaries(),
    });
  });

  router.get('/integrations/status', (_req, res) => {
    res.json(getIntegrationBoundaries());
  });

  router.post('/automation/jobs/execute', (req, res) => {
    const expectedSecret = process.env.AUTOMATION_SHARED_SECRET?.trim();
    const suppliedSecret = req.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!expectedSecret) {
      res.status(503).json({ ok: false, error: 'Automation is not configured.' });
      return;
    }
    if (!suppliedSecret || suppliedSecret !== expectedSecret) {
      res.status(401).json({ ok: false, error: 'Unauthorized automation request.' });
      return;
    }
    const { job_id: jobId, action, expected_revision: expectedRevision } = req.body || {};
    if (typeof jobId !== 'string' || !jobId.trim() || typeof action !== 'string' || !action.trim()) {
      res.status(400).json({ ok: false, error: 'job_id and action are required.' });
      return;
    }
    res.status(202).json({
      ok: true,
      status: 'accepted',
      job_id: jobId,
      action,
      expected_revision: typeof expectedRevision === 'number' ? expectedRevision : null,
      message: 'Authorized automation job accepted for processing.',
    });
  });

  router.get('/sessions', requireUser, async (_req, res, next) => {
    if (!repository) {
      res.json({ ok: true, sessions: [] });
      return;
    }
    try {
      const rows = await repository.list(res.locals.ownerId);
      res.json({
        ok: true,
        sessions: rows.map((r) => ({
          sessionId: r.sessionId,
          updatedAt: r.updatedAt,
          companyName: r.state.profile.companyName,
          tenderReference: r.state.profile.tenderReference,
          mode: r.state.mode,
          blockersCount: r.state.validation.filter((v) => v.status !== 'PASS' && v.status !== 'NOT_APPLICABLE').length,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/voice/transcribe', aiRateLimiter, upload.single('audio'), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ ok: false, error: 'Audio file is required.' });
        return;
      }
      const result = await transcribe(req.file.buffer, req.file.mimetype || 'audio/webm');
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof VoiceError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/voice/speak', aiRateLimiter, async (req, res, next) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text : '';
      const language = req.body?.language === 'en-IN' ? 'en-IN' : 'ta-IN';
      const result = await speak(text, language);
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof VoiceError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/gemini/probe', aiRateLimiter, async (req, res) => {
    const requestedModel =
      typeof req.body?.model === 'string' && req.body.model.trim()
        ? sanitizeSingleLineInput(req.body.model, 80)
        : getActiveGeminiModel();
    const result = await runGeminiStructuredProbe(requestedModel);
    if (!result.ok) {
      res.status(result.httpStatus).json(result);
      return;
    }
    res.json(result);
  });

  // Sample Mode endpoints
  router.post('/sessions/sample', (_req, res) => {
    const session = createSampleSession();
    res.status(201).json({
      ok: true,
      session,
      progressSteps: session.chatHistory[0]?.progressSteps || [],
    });
  });

  router.get('/sample/corrected-iso.pdf', (_req, res) => {
    const pdfBuf = getSampleCorrectedIsoPdfBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Sample_Renewed_ISO_9001.pdf"');
    res.send(pdfBuf);
  });

  // Live Mode document intake + analysis
  router.post(
    '/sessions/analyze',
    aiRateLimiter,
    requireUser,
    upload.fields([
      { name: 'tenderPdf', maxCount: 1 },
      { name: 'supplierZip', maxCount: 1 },
      { name: 'corrigendumPdf', maxCount: 1 },
    ]),
    async (req, res, next) => {
      try {
        const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
        const tenderFile = files.tenderPdf?.[0];
        const supplierZipFile = files.supplierZip?.[0];
        const corrigendumFile = files.corrigendumPdf?.[0];

        const companyName = sanitizeSingleLineInput(req.body?.companyName, MAX_COMPANY_NAME_CHARS);
        const district = sanitizeSingleLineInput(req.body?.district, 80);
        const sector = sanitizeSingleLineInput(req.body?.sector, 120);
        const deadline = sanitizeSingleLineInput(req.body?.deadline, 40);
        const tenderReference =
          sanitizeSingleLineInput(req.body?.tenderReference, MAX_REF_CHARS) || undefined;
        const email = sanitizeSingleLineInput(req.body?.email, 254) || undefined;
        const idempotencyKey =
          typeof req.headers['x-idempotency-key'] === 'string'
            ? sanitizeSingleLineInput(req.headers['x-idempotency-key'], 128)
            : undefined;

        if (!companyName || !district || !sector || !deadline) {
          res.status(400).json({
            ok: false,
            error: 'Company name, Tamil Nadu district, sector, and confirmed bid deadline are required.',
          });
          return;
        }
        if (!isValidOptionalEmail(email)) {
          res.status(400).json({ ok: false, error: 'Please provide a valid email address.' });
          return;
        }
        if (!tenderFile) {
          res.status(400).json({ ok: false, error: 'Tender PDF upload is required.' });
          return;
        }
        if (!supplierZipFile) {
          res.status(400).json({ ok: false, error: 'Supplier documents ZIP upload is required.' });
          return;
        }

        const result = await runLiveAnalysisPipeline({
          profile: {
            companyName,
            district,
            sector,
            tenderReference,
            email,
          },
          confirmedDeadline: deadline,
          tenderFile: { buffer: tenderFile.buffer, originalname: tenderFile.originalname },
          supplierZipFile: {
            buffer: supplierZipFile.buffer,
            originalname: supplierZipFile.originalname,
          },
          corrigendumFile: corrigendumFile
            ? {
                buffer: corrigendumFile.buffer,
                originalname: corrigendumFile.originalname,
              }
            : undefined,
          idempotencyKey: idempotencyKey ? `${res.locals.ownerId}:${idempotencyKey}` : undefined,
        });
        liveOwners.set(result.session.sessionId, res.locals.ownerId);
        if (repository) await repository.create(res.locals.ownerId, result.session);

        res.status(201).json({
          ok: true,
          session: result.session,
          progressSteps: result.progressSteps,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Retrieve authoritative session state
  router.get('/sessions/:id', (req, res) => {
    const found = requestSession(req, res);
    if (found.status === 'missing') {
      res.status(404).json({
        ok: false,
        code: 'missing',
        error: 'Session not found. It may have been cleared on server restart.',
      });
      return;
    }
    if (found.status === 'expired') {
      res.status(410).json({
        ok: false,
        code: 'expired',
        error: 'Session has expired. Please re-upload documents or open Sample Mode.',
      });
      return;
    }
    res.json({ ok: true, session: found.session });
  });

  // Delete session
  router.delete('/sessions/:id', async (req, res, next) => {
    if (repository && res.locals.savedSession) {
      try {
        await repository.remove(res.locals.ownerId, req.params.id);
      } catch (error) {
        next(error);
        return;
      }
      deleteSession(req.params.id);
      liveOwners.delete(req.params.id);
      res.json({ ok: true });
      return;
    }
    const deleted = deleteSession(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'Session not found.' });
      return;
    }
    liveOwners.delete(req.params.id);
    res.json({ ok: true });
  });

  // Grounded chat endpoint
  router.post('/sessions/:id/chat', aiRateLimiter, async (req, res, next) => {
    const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const languageRaw = req.body?.language;
    const language: ChatLanguage =
      languageRaw === 'Tam' || languageRaw === 'Hin' ? languageRaw : 'Eng';
    const expectedRevision =
      typeof req.body?.revision === 'number' ? req.body.revision : undefined;

    if (!rawMessage) {
      res.status(400).json({ ok: false, error: 'Message text is required.' });
      return;
    }
    if (rawMessage.length > MAX_CHAT_MESSAGE_CHARS) {
      res.status(400).json({
        ok: false,
        error: `Message exceeds ${MAX_CHAT_MESSAGE_CHARS} character limit.`,
      });
      return;
    }
    const message = rawMessage;

    let chatOutput: Awaited<ReturnType<typeof handleSessionChatTurn>> | undefined;
    const updated = await updateSession(res, req.params.id, expectedRevision, async (draft) => {
      chatOutput = await handleSessionChatTurn({
        session: draft,
        message,
        language,
      });
    }).catch((error: unknown) => { next(error); return null; });
    if (!updated) return;

    if (!updated.ok) {
      const status =
        updated.code === 'missing'
          ? 404
          : updated.code === 'expired'
            ? 410
            : updated.code === 'conflict'
              ? 409
              : 423;
      res.status(status).json({
        ok: false,
        code: updated.code,
        error: updated.message,
        currentRevision: updated.currentRevision,
      });
      return;
    }

    res.json({
      ok: true,
      session: updated.session,
      reply: chatOutput?.reply,
      toolUsed: chatOutput?.toolUsed,
      guardrailBlocked: Boolean(chatOutput?.guardrailBlocked),
      progressSteps: chatOutput?.progressSteps || [],
      citedRequirements: chatOutput?.citedRequirements || [],
      exportReady: Boolean(chatOutput?.exportReady),
    });
  });

  // Explicit human decision / feedback endpoint
  router.post('/sessions/:id/decision', async (req, res, next) => {
    const requirementId =
      typeof req.body?.requirementId === 'string'
        ? sanitizeSingleLineInput(req.body.requirementId, 32)
        : undefined;
    const actionRaw = typeof req.body?.action === 'string' ? req.body.action : 'agree';
    const action =
      actionRaw === 'approve' || actionRaw === 'dispute' ? actionRaw : 'agree';
    const note = sanitizeSingleLineInput(req.body?.note, MAX_NOTE_CHARS);
    const languageRaw = req.body?.language;
    const language: ChatLanguage =
      languageRaw === 'Tam' || languageRaw === 'Hin' ? languageRaw : 'Eng';
    const expectedRevision =
      typeof req.body?.revision === 'number' ? req.body.revision : undefined;

    let toolResult: ReturnType<typeof executeGroundedTool> | undefined;
    const updated = await updateSession(res, req.params.id, expectedRevision, (draft) => {
      if (action === 'approve') {
        toolResult = executeGroundedTool({
          session: draft,
          tool: 'record_decision',
          userMessage: note || `Approve ${requirementId || ''}`,
          language,
          requirementId,
          decision: 'approved_after_review',
          note,
        });
      } else if (action === 'dispute') {
        toolResult = executeGroundedTool({
          session: draft,
          tool: 'record_feedback',
          userMessage: note || `I disagree with finding for ${requirementId || ''}`,
          language,
          requirementId,
          decision: 'disputed',
          note,
        });
      } else {
        toolResult = executeGroundedTool({
          session: draft,
          tool: 'record_feedback',
          userMessage: note || `Agreed with finding for ${requirementId || ''}`,
          language,
          requirementId,
          note,
        });
      }
    }).catch((error: unknown) => { next(error); return null; });
    if (!updated) return;

    if (!updated.ok) {
      const status =
        updated.code === 'missing' ? 404 : updated.code === 'expired' ? 410 : 409;
      res.status(status).json({ ok: false, code: updated.code, error: updated.message });
      return;
    }

    res.status(toolResult?.ok === false ? 422 : 200).json({
      ok: toolResult?.ok ?? true,
      session: updated.session,
      message: toolResult?.reply,
    });
  });

  // Upload corrected PDF & rerun affected checks
  router.post(
    '/sessions/:id/correct',
    aiRateLimiter,
    upload.single('correctedPdf'),
    async (req, res, next) => {
      try {
        const file = req.file;
        if (!file) {
          res.status(400).json({ ok: false, error: 'Please attach a corrected PDF file.' });
          return;
        }
        const targetRequirementId =
          typeof req.body?.targetRequirementId === 'string' && req.body.targetRequirementId.trim()
            ? req.body.targetRequirementId.trim()
            : undefined;
        const expectedRevision = req.body?.revision ? Number(req.body.revision) : undefined;

        let recheckInfo:
          | { affectedRequirements: string[]; progressSteps: string[] }
          | undefined;

        const updated = await updateSession(
          res,
          req.params.id,
          Number.isFinite(expectedRevision) ? expectedRevision : undefined,
          async (draft) => {
            const out = await recheckCorrectedDocumentInSession({
              session: draft,
              correctedFile: { buffer: file.buffer, originalname: file.originalname },
              targetRequirementId,
            });
            recheckInfo = {
              affectedRequirements: out.affectedRequirements,
              progressSteps: out.progressSteps,
            };
          }
        );

        if (!updated.ok) {
          const status =
            updated.code === 'missing' ? 404 : updated.code === 'expired' ? 410 : 409;
          res.status(status).json({ ok: false, code: updated.code, error: updated.message });
          return;
        }

        res.json({
          ok: true,
          session: updated.session,
          affectedRequirements: recheckInfo?.affectedRequirements || [],
          progressSteps: recheckInfo?.progressSteps || [],
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Download or preview escaped HTML Bid Readiness Report
  router.get('/sessions/:id/report', (req, res) => {
    const found = requestSession(req, res);
    if (found.status === 'missing') {
      res.status(404).json({ ok: false, error: 'Session not found.' });
      return;
    }
    if (found.status === 'expired') {
      res.status(410).json({ ok: false, error: 'Session expired.' });
      return;
    }

    const html = renderHtmlReadinessReport(found.session);
    if (req.query.format === 'json') {
      res.json({
        ok: true,
        html,
        revision: found.session.revision,
      });
      return;
    }

    const safeReportId = found.session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';"
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="NammaTender_Report_${safeReportId}.html"`
    );
    res.send(html);
  });

  // Explicit-authorization n8n compliance reminder dispatcher (never overrides findings or submits bids)
  router.post('/sessions/:id/automate', async (req, res, next) => {
    const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
    const secret = process.env.AUTOMATION_SHARED_SECRET?.trim();
    if (process.env.N8N_REMINDERS_VERIFIED !== 'true' || !webhookUrl || !secret || !/^https?:\/\//i.test(webhookUrl)) {
      res.status(503).json({
        ok: false,
        error: 'n8n automation webhook is not configured on the server.',
      });
      return;
    }
    const webhookSafety = isSafeExternalWebhookUrl(webhookUrl);
    if (!webhookSafety.safe) {
      res.status(400).json({
        ok: false,
        error: webhookSafety.reason || 'Webhook URL violates SSRF security policy.',
      });
      return;
    }
    if (req.body?.confirmDispatch !== true) {
      res.status(400).json({
        ok: false,
        error: 'Explicit user authorization (confirmDispatch: true) is required before dispatching external reminders.',
      });
      return;
    }

    const recipientEmailRaw =
      typeof req.body?.recipientEmail === 'string'
        ? sanitizeSingleLineInput(req.body.recipientEmail, 254)
        : undefined;
    if (!isValidOptionalEmail(recipientEmailRaw)) {
      res.status(400).json({ ok: false, error: 'Invalid recipient email address.' });
      return;
    }

    const found = requestSession(req, res);
    if (found.status === 'missing') {
      res.status(404).json({ ok: false, error: 'Session not found.' });
      return;
    }
    if (found.status === 'expired') {
      res.status(410).json({ ok: false, error: 'Session expired.' });
      return;
    }

    const session = found.session;
    try {
      const upstream = await fetch(webhookUrl, {
        ...reminderRequest(session.sessionId, session.revision, secret),
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) {
        res.status(502).json({
          ok: false,
          error: `n8n webhook returned HTTP ${upstream.status}.`,
        });
        return;
      }

      const updated = await updateSession(res, req.params.id, undefined, (draft) => {
        draft.audit_events.push({
          id: generateId('aud'),
          timestamp: new Date().toISOString(),
          actor: 'user',
          action: 'n8n_reminder_dispatched',
          detail: `Dispatched authorized compliance reminder for ${draft.plan.length} rescue item(s) to n8n webhook.`,
        });
      }).catch((err: unknown) => {
        next(err);
        return null;
      });

      if (!updated || !updated.ok) {
        res.json({ ok: true, session, message: 'n8n returned HTTP ' + upstream.status + '. Delivery unconfirmed.' });
        return;
      }

      res.json({
        ok: true,
        session: updated.session,
        message: 'n8n returned HTTP ' + upstream.status + '. Delivery unconfirmed.',
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? `n8n dispatch failed: ${err.message}` : 'n8n dispatch failed.',
      });
    }
  });

  // Error handler for upload, ingestion, and pipeline failures
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({
        ok: false,
        category: 'upload_limit',
        error: `Upload error: ${err.message}`,
      });
      return;
    }
    if (err instanceof IngestionError || err instanceof PipelineError) {
      res.status(err.statusCode).json({
        ok: false,
        category: err instanceof PipelineError ? err.category : 'ingestion_error',
        error: err.message,
      });
      return;
    }
    const clean =
      err instanceof Error ? redactSecrets(err.message) : 'Server error';
    res.status(500).json({ ok: false, error: clean });
  });

  return router;
}

export async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(applySecurityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`Namma Tender server listening on http://0.0.0.0:${PORT}`);
  });
}

// Start only when this module is the entrypoint. Tests import createApiRouter()
// and must never open a second Vite/WebSocket server as an import side effect.
const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntrypoint) {
  startServer().catch((err) => {
    console.error('Failed to start Namma Tender server:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
