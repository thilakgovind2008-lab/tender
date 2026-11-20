import type { NextFunction, Request, Response } from 'express';
import { isNegatedApprovalCommand } from './sentinel.ts';
import type { ChatLanguage, IngestedDocument, SessionState } from './types.ts';

export const MAX_CHAT_MESSAGE_CHARS = 2000;
export const MAX_NOTE_CHARS = 1000;
export const MAX_COMPANY_NAME_CHARS = 180;
export const MAX_REF_CHARS = 120;

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_\-]{12,}/g,
  /\bsk-[A-Za-z0-9_\-]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._\-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g,
  /\b(?:gemini_api_key|supabase_service_role_key|sarvam_api_key|automation_shared_secret)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{8,}['"]?/gi,
];

export function redactSecrets(input: unknown): string {
  let text = String(input ?? '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

/**
 * Strips zero-width / directional override characters commonly used to hide
 * indirect prompt injections inside PDF text or user fields.
 */
export function normalizeUntrustedUnicode(input: string): string {
  return String(input ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
}

export function stripUnsafeMarkup(input: string): string {
  return normalizeUntrustedUnicode(input)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/?(?:script|iframe|object|embed|svg|style)\b[^>]*>/gi, ' ')
    .replace(/\bjavascript\s*:/gi, 'blocked:')
    .replace(/\bon(?:error|load|click|mouseover|focus)\s*=/gi, 'data-blocked-attr=')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeSingleLineInput(input: unknown, maxLength: number): string {
  const clean = stripUnsafeMarkup(String(input ?? ''))
    .replace(/[<>]/g, '')
    .trim();
  return clean.slice(0, maxLength);
}

export function isValidSessionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{3,80}$/.test(id);
}

export function isValidOptionalEmail(email: string | undefined): boolean {
  if (!email) return true;
  if (email.length > 254) return false;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email);
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'metadata.google.internal',
  'metadata.goog',
  '0.0.0.0',
  '::1',
]);

export function isSafeExternalWebhookUrl(urlStr: string): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: 'Invalid webhook URL format.' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { safe: false, reason: 'Webhook URL must use HTTPS or HTTP.' };
  }
  if (process.env.VERCEL && protocol !== 'https:') {
    return { safe: false, reason: 'Production webhook URLs must use HTTPS.' };
  }
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'Webhook URL must not embed credentials.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_METADATA_HOSTS.has(host) || host.startsWith('169.254.')) {
    return { safe: false, reason: 'Webhook target host is blocked by SSRF policy.' };
  }

  return { safe: true };
}

interface InjectionRule {
  category:
    | 'instruction_override'
    | 'role_spoofing'
    | 'sentinel_bypass'
    | 'secret_exfiltration'
    | 'xss_or_code_injection';
  pattern: RegExp;
}

const INJECTION_RULES: InjectionRule[] = [
  {
    category: 'instruction_override',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:previous|prior|above|system|your|existing)\s+(?:instructions|prompts|rules|directives|constraints)\b/i,
  },
  {
    category: 'instruction_override',
    pattern: /\b(?:system\s+override|new\s+system\s+instructions?|reset\s+your\s+instructions)\b/i,
  },
  {
    category: 'role_spoofing',
    pattern:
      /(?:<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\/?(?:system|assistant|developer|untrusted_data)[^>]*>|\[(?:SYSTEM|ADMIN|DEVELOPER)\])/i,
  },
  {
    category: 'role_spoofing',
    pattern: /\b(?:you\s+are\s+now\s+(?:in\s+)?(?:developer|unrestricted|dan|god|admin)\s+mode|jailbreak\s+mode)\b/i,
  },
  {
    category: 'sentinel_bypass',
    pattern:
      /\b(?:bypass\s+sentinel|disable\s+(?:sentinel|guardrails?|validation)|skip\s+(?:validation|verification|expiry\s+check)|fake\s+compliance)\b/i,
  },
  {
    category: 'sentinel_bypass',
    pattern:
      /\b(?:mark|set|force|make|change|override|treat)\s+(?:all|every|expired|missing|failed)\b.{0,45}\b(?:as\s+)?(?:pass|passed|valid|compliant|eligible|approved)\b/i,
  },
  {
    category: 'secret_exfiltration',
    pattern:
      /\b(?:reveal|show|print|dump|output|leak|exfiltrate|repeat|display)\b.{0,40}\b(?:system\s+prompt|hidden\s+prompt|developer\s+prompt|api[_\s]?key|gemini_api_key|service_role|process\.env|environment\s+variables?|env\s+vars?|sarvam_api_key|automation_shared_secret)\b/i,
  },
  {
    category: 'xss_or_code_injection',
    pattern: /(?:<\s*script\b|javascript\s*:|on(?:error|load)\s*=|;\s*drop\s+table\b|\b__proto__\b|constructor\.prototype)/i,
  },
];

export interface PromptInjectionInspection {
  detected: boolean;
  categories: string[];
  snippets: string[];
}

export function inspectPromptInjection(rawText: string): PromptInjectionInspection {
  const normalized = normalizeUntrustedUnicode(rawText);
  const categories = new Set<string>();
  const snippets: string[] = [];

  for (const rule of INJECTION_RULES) {
    const match = normalized.match(rule.pattern);
    if (match) {
      categories.add(rule.category);
      snippets.push(match[0].slice(0, 120));
    }
  }

  return {
    detected: categories.size > 0,
    categories: Array.from(categories),
    snippets,
  };
}

export interface DocumentInjectionFinding {
  pageNumber: number;
  categories: string[];
  snippet: string;
}

export function scanDocumentForPromptInjections(doc: IngestedDocument): DocumentInjectionFinding[] {
  const findings: DocumentInjectionFinding[] = [];
  for (const page of doc.pages) {
    if (!page.text) continue;
    const inspection = inspectPromptInjection(page.text);
    if (inspection.detected) {
      findings.push({
        pageNumber: page.pageNumber,
        categories: inspection.categories,
        snippet: inspection.snippets[0] || '',
      });
    }
  }
  return findings;
}

/**
 * Neutralizes role/delimiter breakout markers and wraps untrusted document or user text
 * inside strict boundary delimiters before inclusion in Gemini prompts.
 */
export function isolateUntrustedData(label: string, rawText: string, maxChars = 3500): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const cleaned = normalizeUntrustedUnicode(rawText)
    .replace(/<<<\s*(?:END_)?UNTRUSTED_DATA_[^>]*>>>/gi, '[DELIMITER_REMOVED]')
    .replace(/<\|(?:im_start|im_end|system|user|assistant)\|>/gi, '[TOKEN_REMOVED]')
    .replace(/<\/?(?:system|assistant|developer)[^>]*>/gi, '[TAG_REMOVED]')
    .slice(0, maxChars);

  return `<<<UNTRUSTED_DATA_${safeLabel}>>>\n${cleaned}\n<<<END_UNTRUSTED_DATA_${safeLabel}>>>`;
}

export function auditModelOutputText(rawText: string): {
  cleanText: string;
  leakedSecret: boolean;
  unsafeMarkup: boolean;
} {
  const redacted = redactSecrets(rawText);
  const leakedSecret = redacted !== rawText;
  const withoutScripts = stripUnsafeMarkup(redacted);
  const unsafeMarkup = /<\s*script\b|javascript\s*:|on(?:error|load)\s*=/i.test(rawText);
  return {
    cleanText: withoutScripts,
    leakedSecret,
    unsafeMarkup,
  };
}

export function evaluateChatGuardrail(
  userMessage: string,
  session: SessionState,
  language: ChatLanguage
): {
  blocked: boolean;
  categories: string[];
  reply?: string;
  citedRequirements: string[];
} {
  const isTa = language === 'Tam';
  const normalized = normalizeUntrustedUnicode(userMessage).trim();

  if (normalized.length > MAX_CHAT_MESSAGE_CHARS) {
    return {
      blocked: true,
      categories: ['oversized_input'],
      citedRequirements: [],
      reply: isTa
        ? `செய்தி மிக நீளமாக உள்ளது (${MAX_CHAT_MESSAGE_CHARS} எழுத்துகளுக்குள் சுருக்கவும்).`
        : `Message exceeds the ${MAX_CHAT_MESSAGE_CHARS}-character safety limit. Please ask a shorter question.`,
    };
  }

  // Always let explicit negated approvals ("Do not approve R2") pass through to the safe refusal handler
  if (isNegatedApprovalCommand(normalized)) {
    return { blocked: false, categories: [], citedRequirements: [] };
  }

  const inspection = inspectPromptInjection(normalized);
  if (!inspection.detected) {
    return { blocked: false, categories: [], citedRequirements: [] };
  }

  const ts = new Date().toISOString();
  session.audit_events.push({
    id: `aud_guard_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    timestamp: ts,
    actor: 'sentinel',
    action: 'prompt_injection_blocked',
    detail: `Blocked unsafe prompt input (${inspection.categories.join(', ')}). Sentinel rules and validation status kept intact.`,
  });

  return {
    blocked: true,
    categories: inspection.categories,
    citedRequirements: [],
    reply: isTa
      ? 'பாதுகாப்புக் கட்டுப்பாடு: கணினி விதிகளை மாற்றும், ரகசியத் தகவல்களைக் கேட்கும், அல்லது Sentinel சரிபார்ப்பைத் தவிர்க்கும் கோரிக்கைகள் ஏற்கப்படாது. உங்கள் டெண்டர் விதிகள் குறித்துக் கேட்கலாம்.'
      : 'Refused by Sentinel Guardrail: prompt-override, secret-disclosure, script-injection, and validation-bypass commands cannot run. Ask about your tender requirements, blockers, rescue priorities, or upload a corrected PDF.',
  };
}

export function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const recent = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (recent.length >= options.maxRequests) {
      const oldest = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        ok: false,
        category: 'rate_limited',
        error: `Too many requests. Please wait ${retryAfterSec}s before retrying.`,
      });
      return;
    }

    recent.push(now);
    hits.set(ip, recent);

    // Periodic bounded cleanup so long-lived processes don't accumulate stale IPs
    if (hits.size > 2000) {
      for (const [k, timestamps] of hits) {
        if (!timestamps.some((t) => t > cutoff)) {
          hits.delete(k);
        }
      }
    }

    next();
  };
}
