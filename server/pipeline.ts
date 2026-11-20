import { scanDocumentForPromptInjections } from './guardrails.ts';
import {
  buildEvidenceSnippets,
  extractPdfPages,
  IngestionError,
  ingestSupplierZip,
} from './ingest.ts';
import {
  extractRequirementsWithGemini,
  getActiveGeminiModel,
  matchEvidenceWithGemini,
  sanitizeLlmError,
} from './llm.ts';
import { buildRescuePlan } from './rescue.ts';
import {
  runSentinelMatchAudit,
  runSentinelRequirementAudit,
} from './sentinel.ts';
import { createSessionRecord, generateId } from './sessionStore.ts';
import type {
  EvidenceMatch,
  IngestedDocument,
  SessionState,
  SupplierProfile,
  TenderRequirement,
} from './types.ts';
import { computeDeadlineInfo, validateRequirements } from './validator.ts';

export class PipelineError extends Error {
  public readonly statusCode: number;
  public readonly category: string;
  constructor(message: string, statusCode = 502, category = 'pipeline_error') {
    super(message);
    this.name = 'PipelineError';
    this.statusCode = statusCode;
    this.category = category;
  }
}

export async function runLiveAnalysisPipeline(params: {
  profile: SupplierProfile;
  confirmedDeadline: string;
  tenderFile: { buffer: Buffer; originalname: string };
  supplierZipFile: { buffer: Buffer; originalname: string };
  corrigendumFile?: { buffer: Buffer; originalname: string };
  idempotencyKey?: string;
}): Promise<{ session: SessionState; progressSteps: string[] }> {
  const progressSteps: string[] = [];

  // 1. Safe ingestion
  progressSteps.push('Reading tender pages');
  const tenderDoc = await extractPdfPages(
    params.tenderFile.buffer,
    params.tenderFile.originalname,
    'tender',
    'TENDER_1'
  );

  let corrigendumDoc: IngestedDocument | undefined;
  if (params.corrigendumFile) {
    corrigendumDoc = await extractPdfPages(
      params.corrigendumFile.buffer,
      params.corrigendumFile.originalname,
      'corrigendum',
      'CORRIG_1'
    );
  }

  progressSteps.push('Checking supplier evidence');
  const { docs: supplierDocs, warnings: zipWarnings } = await ingestSupplierZip(
    params.supplierZipFile.buffer,
    params.supplierZipFile.originalname
  );

  const warnings: string[] = [...zipWarnings];
  if (tenderDoc.scannedPages.length > 0) {
    warnings.push(
      `Tender PDF "${tenderDoc.filename}" page(s) ${tenderDoc.scannedPages.join(', ')} appear scanned or low-text (OCR / human review required).`
    );
  }
  if (corrigendumDoc && corrigendumDoc.scannedPages.length > 0) {
    warnings.push(
      `Corrigendum "${corrigendumDoc.filename}" page(s) ${corrigendumDoc.scannedPages.join(', ')} appear scanned or low-text.`
    );
  }

  // Scan all uploaded PDFs for indirect prompt injection attempts before LLM processing
  const injectionAuditEvents: SessionState['audit_events'] = [];
  for (const doc of [tenderDoc, ...(corrigendumDoc ? [corrigendumDoc] : []), ...supplierDocs]) {
    const docInjections = scanDocumentForPromptInjections(doc);
    for (const inj of docInjections) {
      warnings.push(
        `Sentinel isolated indirect prompt-injection text in "${doc.filename}" (p.${inj.pageNumber}: ${inj.categories.join(', ')}). Treated as untrusted document text only.`
      );
      injectionAuditEvents.push({
        id: generateId('aud'),
        timestamp: new Date().toISOString(),
        actor: 'sentinel',
        action: 'prompt_injection_detected',
        detail: `Detected ${inj.categories.join(', ')} pattern in "${doc.filename}" page ${inj.pageNumber}; isolated from system instructions.`,
      });
    }
  }

  // 2. Structured Requirement Extraction via Gemini
  progressSteps.push('Extracting requirements');
  let rawRequirements: TenderRequirement[] = [];
  let extractLatencyMs = 0;
  try {
    const ext = await extractRequirementsWithGemini(tenderDoc, corrigendumDoc);
    rawRequirements = ext.requirements;
    extractLatencyMs = ext.latencyMs;
    if (ext.incompleteCoverageWarning) {
      warnings.push(`Extraction coverage warning: ${ext.incompleteCoverageWarning}`);
    }
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    const mapped = sanitizeLlmError(err);
    throw new PipelineError(
      `Live requirement extraction failed (${mapped.category}): ${mapped.message}`,
      mapped.httpStatus,
      mapped.category
    );
  }

  if (rawRequirements.length === 0) {
    warnings.push('No mandatory requirements were extracted from readable tender pages — manual review required.');
  }

  // 3. Supplier Evidence Matching via Gemini
  let rawMatches: EvidenceMatch[] = [];
  let matchLatencyMs = 0;
  if (rawRequirements.length > 0) {
    try {
      const matched = await matchEvidenceWithGemini(rawRequirements, supplierDocs);
      rawMatches = matched.matches;
      matchLatencyMs = matched.latencyMs;
    } catch (err) {
      const mapped = sanitizeLlmError(err);
      throw new PipelineError(
        `Live evidence matching failed (${mapped.category}): ${mapped.message}`,
        mapped.httpStatus,
        mapped.category
      );
    }
  }

  // 4. Deterministic Sentinel & Validation
  progressSteps.push('Validating dates and amounts');
  const { auditedRequirements, sentinelWarnings: reqWarnings } = runSentinelRequirementAudit(
    rawRequirements,
    tenderDoc,
    corrigendumDoc
  );
  const { auditedMatches, sentinelWarnings: matchWarnings } = runSentinelMatchAudit(
    rawMatches,
    auditedRequirements,
    supplierDocs
  );
  warnings.push(...reqWarnings, ...matchWarnings);

  const deadline = computeDeadlineInfo(params.confirmedDeadline);
  const validation = validateRequirements({
    requirements: auditedRequirements,
    matches: auditedMatches,
    supplierDocs,
    profile: params.profile,
    deadline,
  });

  // 5. Bid Rescue Engine
  progressSteps.push('Preparing rescue actions');
  const plan = buildRescuePlan({
    requirements: auditedRequirements,
    validation,
    deadline,
  });

  const blockersCount = validation.filter((v) => v.status !== 'PASS' && v.status !== 'NOT_APPLICABLE').length;
  const session = createSessionRecord(
    {
      mode: 'LIVE',
      profile: params.profile,
      deadline,
      documents: {
        tenderDoc,
        corrigendumDoc,
        supplierDocs,
      },
      requirements: auditedRequirements,
      evidence: buildEvidenceSnippets(supplierDocs),
      matches: auditedMatches,
      validation,
      plan,
      decisions: [],
      feedback: [],
      audit_events: [
        {
          id: generateId('aud'),
          timestamp: new Date().toISOString(),
          actor: 'system',
          action: 'live_analysis_completed',
          detail: `Analyzed "${tenderDoc.filename}" (${tenderDoc.pageCount}p) and ${supplierDocs.length} supplier PDF(s) via ${getActiveGeminiModel()}.`,
        },
        ...injectionAuditEvents,
      ],
      warnings: Array.from(new Set(warnings)),
      provider: {
        provider: 'gemini',
        model: getActiveGeminiModel(),
        extractionMode: 'live',
        lastProbeLatencyMs: extractLatencyMs + matchLatencyMs,
      },
      chatHistory: [
        {
          id: generateId('msg'),
          role: 'assistant',
          timestamp: new Date().toISOString(),
          toolUsed: 'list_blockers',
          progressSteps,
          citedRequirements: validation.filter((v) => v.status !== 'PASS').map((v) => v.requirementId),
          text:
            `Live Namma Tender analysis completed for ${params.profile.companyName} (${params.profile.district}). ` +
            `Extracted ${auditedRequirements.length} requirement(s); ${blockersCount} item(s) require attention (${deadline.timeRemainingText}). ` +
            `Ask "What is blocking us?", "What should I fix first?", or upload corrected evidence below.`,
        },
      ],
    },
    { idempotencyKey: params.idempotencyKey }
  );

  return { session, progressSteps };
}

/**
 * Extracts deterministic facts from a newly uploaded corrected PDF page text
 * based on document CONTENT rather than filename.
 */
function deterministicMatchForCorrectedDoc(
  doc: IngestedDocument,
  req: TenderRequirement
): EvidenceMatch {
  const bestPage = doc.pages.find((p) => !p.needsOcr && p.text.trim().length > 0) ?? doc.pages[0];
  const text = bestPage?.text ?? '';

  // Extract entity name if present
  const entityMatch = text.match(
    /(?:Certified Entity|Issued to|Legal Name|Name of Enterprise|Entity|Company)\s*[:\-]\s*([A-Za-z0-9 &.,()]+?)(?=\s+(?:District|Standard|Issue|Valid|GSTIN|Average|Status|Major|UDIN|$))/i
  );
  const companyNameInDoc = entityMatch?.[1]?.trim();

  // Extract expiry / valid until date
  const expiryMatch = text.match(
    /(?:Valid\s*(?:Until|Upto|Till)|Expiry\s*Date|Expires)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/\-]\d{1,2}[/\-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i
  );
  const expiryDateInDoc = expiryMatch?.[1]?.trim();

  // Extract monetary turnover or EMD amount
  const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(Crores?|Cr|Lakhs?|Lacs?|INR|Rs\.?)/i);
  const amountInDoc = amountMatch ? Number(amountMatch[1]) : undefined;
  const unitInDoc = amountMatch ? amountMatch[2] : undefined;

  const isSignedDeclaration =
    /emd\s*exemption\s*declaration|bid\s*security\s*declaration/i.test(text) &&
    /signed|authorised\s*signatory|declar/i.test(text);

  return {
    requirementId: req.id,
    docId: doc.docId,
    docName: doc.filename,
    page: bestPage?.pageNumber ?? 1,
    verbatimQuote: text.slice(0, 240),
    quoteVerifiedOnPage: false,
    extractedFacts: [],
    matchConfidence: 'high',
    companyNameInDoc,
    expiryDateInDoc,
    amountInDoc,
    unitInDoc,
    isSignedDeclaration,
    notes: [`Matched by content classification (${doc.docKind}) rather than filename.`],
  };
}

function docMatchesRequirementByContent(docKind: string, req: TenderRequirement): boolean {
  if (docKind === 'iso_certificate' && req.requirementType === 'certification') return true;
  if (docKind === 'gst_certificate' && req.requirementType === 'registration') return true;
  if (docKind === 'emd_declaration' && req.requirementType === 'emd') return true;
  if (docKind === 'turnover_statement' && req.requirementType === 'financial') return true;
  if (docKind === 'technical_evidence' && (req.requirementType === 'technical' || req.requirementType === 'experience')) {
    return true;
  }
  return false;
}

export async function recheckCorrectedDocumentInSession(params: {
  session: SessionState;
  correctedFile: { buffer: Buffer; originalname: string };
  targetRequirementId?: string;
}): Promise<{
  session: SessionState;
  affectedRequirements: string[];
  progressSteps: string[];
}> {
  const { session, correctedFile, targetRequirementId } = params;
  const progressSteps = ['Reading corrected document pages'];

  const docId = `CORR_${session.documents.supplierDocs.length + 1}`;
  const correctedDoc = await extractPdfPages(
    correctedFile.buffer,
    correctedFile.originalname,
    'correction',
    docId
  );

  if (correctedDoc.scannedPages.length > 0) {
    session.warnings = Array.from(
      new Set([
        ...session.warnings,
        `Corrected PDF "${correctedDoc.filename}" page(s) ${correctedDoc.scannedPages.join(', ')} appear scanned or low-text.`,
      ])
    );
  }

  const correctedInjections = scanDocumentForPromptInjections(correctedDoc);
  for (const inj of correctedInjections) {
    session.warnings = Array.from(
      new Set([
        ...session.warnings,
        `Sentinel isolated indirect prompt-injection text in "${correctedDoc.filename}" (p.${inj.pageNumber}: ${inj.categories.join(', ')}). Treated as untrusted document text only.`,
      ])
    );
    session.audit_events.push({
      id: generateId('aud'),
      timestamp: new Date().toISOString(),
      actor: 'sentinel',
      action: 'prompt_injection_detected',
      detail: `Detected ${inj.categories.join(', ')} pattern in corrected document "${correctedDoc.filename}" page ${inj.pageNumber}; isolated from system instructions.`,
    });
  }

  // Add/append corrected document to authoritative documents & evidence
  session.documents.supplierDocs.push(correctedDoc);
  session.evidence = buildEvidenceSnippets(session.documents.supplierDocs);

  // Determine affected requirements strictly by explicit target OR document CONTENT classification
  const affectedReqs = session.requirements.filter((req) => {
    if (targetRequirementId) {
      return req.id.toLowerCase() === targetRequirementId.toLowerCase();
    }
    return docMatchesRequirementByContent(correctedDoc.docKind, req);
  });

  const targetReqs =
    affectedReqs.length > 0
      ? affectedReqs
      : session.requirements.filter((r) => {
          const cur = session.validation.find((v) => v.requirementId === r.id);
          return cur && cur.status !== 'PASS';
        });

  progressSteps.push('Rechecking corrected evidence');

  let updatedMatches: EvidenceMatch[] = [];
  if (session.mode === 'LIVE' && process.env.GEMINI_API_KEY && targetReqs.length > 0) {
    try {
      const llmMatched = await matchEvidenceWithGemini(targetReqs, [correctedDoc]);
      updatedMatches = llmMatched.matches.filter((m) => m.docId === correctedDoc.docId);
    } catch {
      // Fallback to deterministic content extraction only if live call fails cleanly
      updatedMatches = targetReqs
        .filter((r) => docMatchesRequirementByContent(correctedDoc.docKind, r))
        .map((r) => deterministicMatchForCorrectedDoc(correctedDoc, r));
    }
  } else {
    updatedMatches = targetReqs
      .filter((r) => targetRequirementId || docMatchesRequirementByContent(correctedDoc.docKind, r))
      .map((r) => deterministicMatchForCorrectedDoc(correctedDoc, r));
  }

  // Only update matches for affected requirements — unrelated blockers (e.g. R4 EMD) stay untouched!
  const affectedIds: string[] = [];
  for (const newMatch of updatedMatches) {
    if (!newMatch.docId) continue;
    affectedIds.push(newMatch.requirementId);
    const existingIdx = session.matches.findIndex((m) => m.requirementId === newMatch.requirementId);
    if (existingIdx >= 0) {
      session.matches[existingIdx] = newMatch;
    } else {
      session.matches.push(newMatch);
    }
  }

  progressSteps.push('Validating dates and amounts');
  const { auditedMatches, sentinelWarnings } = runSentinelMatchAudit(
    session.matches,
    session.requirements,
    session.documents.supplierDocs
  );
  session.matches = auditedMatches;

  session.validation = validateRequirements({
    requirements: session.requirements,
    matches: session.matches,
    supplierDocs: session.documents.supplierDocs,
    profile: session.profile,
    deadline: session.deadline,
  });

  progressSteps.push('Preparing rescue actions');
  session.plan = buildRescuePlan({
    requirements: session.requirements,
    validation: session.validation,
    deadline: session.deadline,
  });

  if (sentinelWarnings.length > 0) {
    session.warnings = Array.from(new Set([...session.warnings, ...sentinelWarnings]));
  }

  session.audit_events.push({
    id: generateId('aud'),
    timestamp: new Date().toISOString(),
    actor: 'system',
    action: 'corrected_document_rechecked',
    detail: `Ingested "${correctedDoc.filename}" (classified as ${correctedDoc.docKind} by content). Affected requirements: ${
      affectedIds.length ? affectedIds.join(', ') : 'none matched'
    }.`,
    requirementId: affectedIds[0],
  });

  return {
    session,
    affectedRequirements: affectedIds,
    progressSteps,
  };
}
