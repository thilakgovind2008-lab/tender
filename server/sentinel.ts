import type {
  EvidenceMatch,
  IngestedDocument,
  TenderRequirement,
} from './types.ts';

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifies that a cited verbatim quote genuinely exists on the specified page of the document.
 * Prevents hallucinated/invented model citations from passing validation.
 */
export function verifyQuoteOnPage(
  quote: string,
  doc: IngestedDocument | undefined,
  pageNumber: number | null
): boolean {
  if (!doc || !pageNumber || !quote) return false;
  const page = doc.pages.find((p) => p.pageNumber === pageNumber);
  if (!page || page.needsOcr || !page.text) return false;

  const normPage = normalizeText(page.text);
  const normQuote = normalizeText(quote);
  if (normQuote.length < 6) return false;

  if (normPage.includes(normQuote)) return true;

  // Fallback: check if all meaningful words (>=4 chars) appear in sequence within a window
  const words = normQuote.split(' ').filter((w) => w.length >= 4);
  if (words.length >= 3) {
    let cursor = 0;
    let matched = 0;
    for (const w of words) {
      const idx = normPage.indexOf(w, cursor);
      if (idx !== -1) {
        matched++;
        cursor = idx + w.length;
      }
    }
    return matched >= Math.ceil(words.length * 0.85);
  }

  return false;
}

/**
 * Rejects numeric substring collisions such as extracting 150 from "1500" or "2150.5".
 */
export function hasExactNumericMatch(text: string, targetNumber: number): boolean {
  if (!Number.isFinite(targetNumber)) return false;
  const raw = String(targetNumber);
  const escaped = raw.replace('.', '\\.');
  const trailing = raw.includes('.') ? '0*' : '(?:\\.0+)?';
  const re = new RegExp(`(?<![0-9.])${escaped}${trailing}(?![0-9.])`, 'g');
  return re.test(text.replace(/,/g, ''));
}

export interface ParsedDateResult {
  valid: boolean;
  ambiguous: boolean;
  isoDate?: string;
  timestampMs?: number;
  reason?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parseFlexibleDate(raw: string | undefined): ParsedDateResult {
  if (!raw || !raw.trim()) {
    return { valid: false, ambiguous: false, reason: 'No date provided.' };
  }
  const s = raw.trim();

  // ISO YYYY-MM-DD (unambiguous)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]) - 1;
    const d = Number(isoMatch[3]);
    const dt = new Date(Date.UTC(y, m, d, 23, 59, 59));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d) {
      return { valid: true, ambiguous: false, isoDate: s, timestampMs: dt.getTime() };
    }
    return { valid: false, ambiguous: false, reason: `Invalid calendar date "${s}".` };
  }

  // Named month: "31 Mar 2025" or "March 31, 2025"
  const dmyNamed = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]+)[\s,\-]+(\d{4})$/);
  if (dmyNamed) {
    const d = Number(dmyNamed[1]);
    const m = MONTHS[dmyNamed[2].toLowerCase()];
    const y = Number(dmyNamed[3]);
    if (m !== undefined) {
      const dt = new Date(Date.UTC(y, m, d, 23, 59, 59));
      if (dt.getUTCDate() === d) {
        const isoDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return { valid: true, ambiguous: false, isoDate, timestampMs: dt.getTime() };
      }
    }
  }

  // Slash/dash numeric DD/MM/YYYY vs MM/DD/YYYY
  const numeric = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = Number(numeric[3]);
    if (a <= 12 && b <= 12 && a !== b) {
      // Ambiguous DD/MM vs MM/DD — Sentinel must require human review!
      return {
        valid: false,
        ambiguous: true,
        reason: `Date "${s}" is ambiguous between DD/MM/YYYY and MM/DD/YYYY.`,
      };
    }
    // Unambiguous Indian DD/MM/YYYY when first part > 12
    const d = a > 12 ? a : b;
    const m = (a > 12 ? b : a) - 1;
    const dt = new Date(Date.UTC(y, m, d, 23, 59, 59));
    if (dt.getUTCMonth() === m && dt.getUTCDate() === d) {
      const isoDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { valid: true, ambiguous: false, isoDate, timestampMs: dt.getTime() };
    }
  }

  return { valid: false, ambiguous: true, reason: `Unrecognized or ambiguous date format "${s}".` };
}

export function normalizeAmountWithUnit(
  value: number | undefined,
  unit: string | undefined
): { normalizedValue: number | null; canonicalDimension: 'currency_inr' | 'mm' | 'percent' | 'count' | 'unknown' } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { normalizedValue: null, canonicalDimension: 'unknown' };
  }
  const u = (unit || '').toLowerCase().trim();
  if (!u) return { normalizedValue: null, canonicalDimension: 'unknown' };

  if (u.includes('crore') || u === 'cr') {
    return { normalizedValue: value * 10_000_000, canonicalDimension: 'currency_inr' };
  }
  if (u.includes('lakh') || u === 'lac' || u === 'lacs') {
    return { normalizedValue: value * 100_000, canonicalDimension: 'currency_inr' };
  }
  if (u.includes('inr') || u.includes('rs') || u.includes('₹') || u.includes('rupee')) {
    return { normalizedValue: value, canonicalDimension: 'currency_inr' };
  }
  if (u === 'mm' || u.includes('millimeter') || u.includes('millimetre')) {
    return { normalizedValue: value, canonicalDimension: 'mm' };
  }
  if (u === '%' || u.includes('percent')) {
    return { normalizedValue: value, canonicalDimension: 'percent' };
  }
  if (u.includes('year') || u.includes('yr')) {
    return { normalizedValue: value, canonicalDimension: 'count' };
  }
  return { normalizedValue: null, canonicalDimension: 'unknown' };
}

export function compareCompanyIdentity(
  profileCompany: string,
  docCompany: string | undefined
): 'exact' | 'uncertain' | 'mismatch' | 'absent' {
  if (!docCompany || !docCompany.trim()) return 'absent';

  const cleanTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (t) =>
          t.length > 1 &&
          !['pvt', 'ltd', 'private', 'limited', 'ms', 'co', 'company', 'india', 'enterprises', 'industries'].includes(t)
      );

  const a = cleanTokens(profileCompany);
  const b = cleanTokens(docCompany);
  if (a.length === 0 || b.length === 0) return 'uncertain';

  const setB = new Set(b);
  const overlap = a.filter((t) => setB.has(t)).length;
  const ratio = overlap / Math.max(a.length, b.length);

  if (ratio >= 0.75) return 'exact';
  if (ratio >= 0.35) return 'uncertain';
  return 'mismatch';
}

/**
 * Verifies requirements against source pages and guards against unsupported amendments.
 */
export function runSentinelRequirementAudit(
  requirements: TenderRequirement[],
  tenderDoc: IngestedDocument,
  corrigendumDoc?: IngestedDocument
): { auditedRequirements: TenderRequirement[]; sentinelWarnings: string[] } {
  const sentinelWarnings: string[] = [];
  const auditedRequirements: TenderRequirement[] = [];

  for (const req of requirements) {
    const doc =
      req.sourceDocId === corrigendumDoc?.docId
        ? corrigendumDoc
        : tenderDoc;

    const citationVerified = verifyQuoteOnPage(req.verbatimQuote, doc, req.sourcePage);
    const notes: string[] = [...(req.sentinelNotes || [])];

    if (!citationVerified) {
      notes.push(
        `Sentinel: Cited quote for ${req.id} could not be verified verbatim on ${doc.filename} page ${req.sourcePage}.`
      );
      sentinelWarnings.push(
        `Citation verification failed for ${req.id} (${doc.filename}, p.${req.sourcePage}) — human review required.`
      );
    }

    // Check amendment relationship before allowing amendment override
    let amendmentStatus = req.amendmentStatus || 'original';
    if (amendmentStatus === 'amended' && (!corrigendumDoc || !citationVerified)) {
      amendmentStatus = 'review_required';
      notes.push('Sentinel: Corrigendum amendment lacks verified source link — original obligation preserved for review.');
      sentinelWarnings.push(`Unverified amendment for ${req.id}; original requirement retained.`);
    }

    // Check numeric substring protection on threshold if present
    if (typeof req.thresholdNumber === 'number' && citationVerified) {
      const pageObj = doc.pages.find((p) => p.pageNumber === req.sourcePage);
      if (pageObj && !hasExactNumericMatch(pageObj.text, req.thresholdNumber)) {
        notes.push(
          `Sentinel: Threshold ${req.thresholdNumber} did not match an exact numeric token on page ${req.sourcePage}.`
        );
        sentinelWarnings.push(`Numeric boundary mismatch on ${req.id} threshold (${req.thresholdNumber}).`);
      }
    }

    auditedRequirements.push({
      ...req,
      citationVerified,
      amendmentStatus,
      sentinelNotes: notes,
    });
  }

  return { auditedRequirements, sentinelWarnings };
}

/**
 * Verifies supplier evidence matches against actual supplier page text.
 * Discards fabricated quotes and flags numeric substring traps.
 */
export function runSentinelMatchAudit(
  matches: EvidenceMatch[],
  requirements: TenderRequirement[],
  supplierDocs: IngestedDocument[]
): { auditedMatches: EvidenceMatch[]; sentinelWarnings: string[] } {
  const docMap = new Map(supplierDocs.map((d) => [d.docId, d]));
  const reqMap = new Map(requirements.map((r) => [r.id, r]));
  const sentinelWarnings: string[] = [];

  const auditedMatches = matches.map((m) => {
    const doc = m.docId ? docMap.get(m.docId) : undefined;
    const req = reqMap.get(m.requirementId);
    const notes = [...(m.notes || [])];

    const quoteVerifiedOnPage = verifyQuoteOnPage(m.verbatimQuote, doc, m.page);
    if (m.docId && !quoteVerifiedOnPage) {
      notes.push(
        `Sentinel discarded unverified citation on ${m.docName ?? m.docId} page ${m.page ?? '?'}.`
      );
      sentinelWarnings.push(
        `Evidence quote for ${m.requirementId} was not found verbatim on cited page — discarded.`
      );
    }

    // Verify extracted numeric facts against exact token boundaries
    const pageText =
      doc && m.page ? doc.pages.find((p) => p.pageNumber === m.page)?.text ?? '' : '';

    const auditedFacts = (m.extractedFacts || []).map((fact) => {
      const sqOk = verifyQuoteOnPage(fact.supportingQuote, doc, m.page);
      let numOk = true;
      if (typeof fact.numericValue === 'number' && pageText) {
        numOk = hasExactNumericMatch(pageText, fact.numericValue);
        if (!numOk) {
          notes.push(
            `Sentinel rejected numeric substring match (${fact.numericValue}) not standing as an exact number on page ${m.page}.`
          );
          sentinelWarnings.push(
            `Numeric substring trap blocked on ${m.requirementId} (${fact.numericValue}).`
          );
        }
      }
      return {
        ...fact,
        quoteVerifiedOnPage: sqOk && numOk,
      };
    });

    let safeAmount = m.amountInDoc;
    if (typeof safeAmount === 'number' && pageText && !hasExactNumericMatch(pageText, safeAmount)) {
      notes.push(`Sentinel rejected amount ${safeAmount} due to partial numeric substring match.`);
      safeAmount = undefined;
    }

    if (req && !req.citationVerified) {
      notes.push('Tender requirement citation itself requires human verification.');
    }

    return {
      ...m,
      verbatimQuote: quoteVerifiedOnPage ? m.verbatimQuote : '',
      quoteVerifiedOnPage,
      extractedFacts: auditedFacts,
      amountInDoc: safeAmount,
      matchConfidence: quoteVerifiedOnPage ? m.matchConfidence : ('none' as const),
      notes,
    };
  });

  return { auditedMatches, sentinelWarnings };
}

export function isNegatedApprovalCommand(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(do\s+not|don't|dont|never|cannot|can't|must\s+not|not\s+to)\s+(approve|pass|accept|mark\s+as\s+pass)/i.test(
    lower
  );
}

export function isForcedPassRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\b(mark|set|force|make|change|override|approve|treat|pretend|declare)\b.{0,45}\b(as\s+)?(pass|passed|valid|compliant|eligible)\b/i.test(
      lower
    ) ||
    /\bpass\s+(emd|r\d+)\b/i.test(lower) ||
    /\b(skip|bypass)\s+(?:the\s+)?(?:emd|iso|expiry|validation)\s+(?:check|rule)\b/i.test(lower)
  );
}
