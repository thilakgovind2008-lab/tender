import { buildRescuePlan } from './rescue.ts';
import {
  isForcedPassRequest,
  isNegatedApprovalCommand,
  runSentinelMatchAudit,
  runSentinelRequirementAudit,
} from './sentinel.ts';
import { generateId } from './sessionStore.ts';
import type {
  ChatLanguage,
  SessionState,
  ValidationFinding,
} from './types.ts';
import { validateRequirements } from './validator.ts';

export interface ToolExecutionResult {
  tool: string;
  ok: boolean;
  reply: string;
  citedRequirements: string[];
  progressSteps: string[];
  exportReady?: boolean;
}

function findTargetRequirementId(session: SessionState, candidateId?: string, message = ''): string | undefined {
  if (candidateId) {
    const exact = session.requirements.find(
      (r) => r.id.toLowerCase() === candidateId.trim().toLowerCase()
    );
    if (exact) return exact.id;
  }
  const idMatch = message.match(/\b(R\d+)\b/i);
  if (idMatch) {
    const found = session.requirements.find(
      (r) => r.id.toLowerCase() === idMatch[1].toLowerCase()
    );
    if (found) return found.id;
  }
  const lower = message.toLowerCase();
  if (lower.includes('emd') || lower.includes('earnest') || lower.includes('udyam')) {
    return session.requirements.find((r) => r.requirementType === 'emd')?.id;
  }
  if (lower.includes('iso') || lower.includes('expired') || lower.includes('certificate')) {
    const expiredFinding = session.validation.find((v) => v.status === 'EXPIRED');
    if (expiredFinding) return expiredFinding.requirementId;
    return session.requirements.find((r) => r.requirementType === 'certification')?.id;
  }
  if (lower.includes('turnover') || lower.includes('financial')) {
    return session.requirements.find((r) => r.requirementType === 'financial')?.id;
  }
  if (lower.includes('gst')) {
    return session.requirements.find((r) => r.requirementType === 'registration')?.id;
  }
  if (lower.includes('technical') || lower.includes('test') || lower.includes('spec')) {
    return session.requirements.find((r) => r.requirementType === 'technical')?.id;
  }
  return undefined;
}

export function executeGroundedTool(params: {
  session: SessionState;
  tool: string;
  userMessage: string;
  language: ChatLanguage;
  requirementId?: string;
  decision?: 'approved_after_review' | 'acknowledged_blocker' | 'disputed';
  note?: string;
}): ToolExecutionResult {
  const { session, tool, userMessage, language } = params;
  const nowIso = new Date().toISOString();
  const isTa = language === 'Tam';
  const targetId = findTargetRequirementId(session, params.requirementId, userMessage);

  // Guardrail 1: Claiming in chat that a document was uploaded is NOT an upload
  if (
    /\b(we\s+uploaded|i\s+uploaded|already\s+uploaded|attached\s+in\s+chat)\b/i.test(userMessage) &&
    !/\brecheck\b/i.test(userMessage)
  ) {
    session.audit_events.push({
      id: generateId('aud'),
      timestamp: nowIso,
      actor: 'sentinel',
      action: 'chat_upload_claim_rejected',
      detail: 'User stated in chat that a certificate was uploaded; reminded user to use file upload.',
    });
    return {
      tool: 'sentinel_upload_guard',
      ok: false,
      progressSteps: ['Validating request against uploaded session documents'],
      citedRequirements: [],
      reply: isTa
        ? 'உரையாடலில் ஆவணம் பதிவேற்றப்பட்டதாகக் கூறுவது கோப்புப் பதிவேற்றமாகாது. கீழே உள்ள "திருத்திய ஆவணத்தைப் பதிவேற்று" பொத்தான் மூலம் PDF கோப்பைப் பதிவேற்றவும்.'
        : 'Saying a certificate was uploaded in chat does not ingest a document. Please upload the actual PDF using the "Upload Corrected PDF" control so Sentinel can read and verify its pages.',
    };
  }

  // Guardrail 2: Refuse winning probability / eligibility promises
  if (/\b(will\s+we\s+win|chances\s+of\s+winning|win\s+probability|guaranteed\s+to\s+win)\b/i.test(userMessage)) {
    return {
      tool: 'sentinel_forecast_guard',
      ok: true,
      progressSteps: ['Checking current compliance blockers'],
      citedRequirements: session.validation.filter((v) => v.status !== 'PASS').map((v) => v.requirementId),
      reply: isTa
        ? 'Namma Tender வெற்றி வாய்ப்பு அல்லது சட்டப்பூர்வ தகுதியை உறுதியளிக்காது. உங்கள் ஆவணத் தயார்நிலை, விடுபட்ட சான்றுகள் மற்றும் சரிசெய்ய வேண்டிய குறைகளை மட்டுமே ஆதாரங்களுடன் காட்டுகிறது.'
        : 'Namma Tender does not predict winning probability or promise bid acceptance. It checks document readiness against extracted tender requirements so you can fix blockers before submission.',
    };
  }

  // Guardrail 3: Negated approval command MUST NEVER record approval
  if (isNegatedApprovalCommand(userMessage)) {
    session.audit_events.push({
      id: generateId('aud'),
      timestamp: nowIso,
      actor: 'sentinel',
      action: 'negated_approval_respected',
      detail: `Negated approval instruction respected; no approval recorded (${targetId || 'unspecified'}).`,
      requirementId: targetId,
    });
    return {
      tool: 'record_decision',
      ok: true,
      progressSteps: ['Evaluating human authorization intent'],
      citedRequirements: targetId ? [targetId] : [],
      reply: isTa
        ? `உங்கள் அறிவுறுத்தலின்படி ${targetId || 'அந்த விதிக்கு'} எந்த ஒப்புதலும் பதிவு செய்யப்படவில்லை.`
        : `Understood — no approval was recorded${targetId ? ` for ${targetId}` : ''}. The current validation state remains unchanged.`,
    };
  }

  // Guardrail 4: Forced PASS request on unsupported/missing/failed/expired evidence MUST fail
  if (isForcedPassRequest(userMessage)) {
    const finding = targetId
      ? session.validation.find((v) => v.requirementId === targetId)
      : session.validation.find((v) => v.status !== 'PASS');
    const fid = finding?.requirementId || targetId || 'unspecified';

    if (!finding || finding.status !== 'PASS') {
      const reason = `Cannot mark ${fid} as PASS while current evidence status is ${finding?.status || 'UNVERIFIED'}.`;
      session.decisions.push({
        id: generateId('dec'),
        requirementId: fid,
        decision: 'refused_override',
        actorNote: userMessage,
        timestamp: nowIso,
        blockedReason: reason,
      });
      session.audit_events.push({
        id: generateId('aud'),
        timestamp: nowIso,
        actor: 'sentinel',
        action: 'refused_forced_pass',
        detail: reason,
        requirementId: fid,
      });
      return {
        tool: 'record_decision',
        ok: false,
        progressSteps: ['Checking evidence & Sentinel policy before recording decision'],
        citedRequirements: finding ? [finding.requirementId] : [],
        reply: isTa
          ? `நிராகரிக்கப்பட்டது: ${fid} விதிக்கான தற்போதைய நிலை ${finding?.status || 'MISSING'} ஆகும். ஆதார ஆவணம் பதிவேற்றி சரிபார்க்காமல் PASS என மாற்ற முடியாது.`
          : `Refused: ${fid} is currently ${finding?.status || 'UNVERIFIED'}. Human approval or chat commands cannot override missing, expired, mismatched, or failed evidence into PASS. Upload valid supporting evidence first.`,
      };
    }
  }

  switch (tool) {
    case 'list_blockers': {
      const blockers = session.validation.filter((v) => v.status !== 'PASS' && v.status !== 'NOT_APPLICABLE');
      const passed = session.validation.filter((v) => v.status === 'PASS');
      const cited = blockers.map((b) => b.requirementId);
      const steps = ['Checking supplier evidence', 'Validating dates and amounts', 'Listing unresolved blockers'];

      if (blockers.length === 0) {
        return {
          tool,
          ok: true,
          progressSteps: steps,
          citedRequirements: passed.map((p) => p.requirementId),
          reply: isTa
            ? `தற்போது தடுக்கும் குறைகள் எதுவும் இல்லை (${passed.length}/${session.requirements.length} விதிகள் PASS).`
            : `No active compliance blockers remain (${passed.length}/${session.requirements.length} requirements verified PASS). Note: always perform a final manual review before portal upload.`,
        };
      }

      const lines = blockers.map((b) => {
        const req = session.requirements.find((r) => r.id === b.requirementId);
        const desc = isTa ? b.explanationTa : b.explanation;
        return `- ${b.requirementId} [${b.status}] (${req?.sourceDocName || 'Tender'}, p.${req?.sourcePage || '?'}): ${desc}`;
      });

      const header = isTa
        ? `${blockers.length} விதிகள் உங்கள் ஏலத்தைத் தடுக்கின்றன (${session.deadline.timeRemainingText}):`
        : `You cannot safely submit as-is — ${blockers.length} requirement(s) remain unresolved (${session.deadline.timeRemainingText}):`;

      return {
        tool,
        ok: true,
        progressSteps: steps,
        citedRequirements: cited,
        reply: `${header}\n${lines.join('\n')}`,
      };
    }

    case 'get_rescue_plan': {
      const steps = ['Checking supplier evidence', 'Preparing rescue actions'];
      if (session.plan.length === 0) {
        return {
          tool,
          ok: true,
          progressSteps: steps,
          citedRequirements: [],
          reply: isTa
            ? 'தற்போது சரிசெய்ய வேண்டிய தடுப்புகள் எதுவும் இல்லை.'
            : 'There are currently no unresolved items in the Bid Rescue queue.',
        };
      }

      const lines = session.plan.map((item) => {
        const fixText = isTa ? item.whatToFixTa : item.whatToFix;
        return `${item.priority}. [${item.urgency}] ${item.requirementId} — ${fixText} (Owner: ${item.suggestedOwner} · Feasibility: ${item.feasibility})`;
      });

      return {
        tool,
        ok: true,
        progressSteps: steps,
        citedRequirements: session.plan.map((p) => p.requirementId),
        reply: isTa
          ? `முதலில் சரிசெய்ய வேண்டியவை (${session.deadline.timeRemainingText}):\n${lines.join('\n')}`
          : `Bid Rescue priority order (${session.deadline.timeRemainingText}):\n${lines.join('\n')}`,
      };
    }

    case 'explain_requirement': {
      const id = targetId || session.requirements[0]?.id;
      const req = session.requirements.find((r) => r.id === id);
      const finding = session.validation.find((v) => v.requirementId === id);
      const match = session.matches.find((m) => m.requirementId === id);

      if (!req || !finding) {
        return {
          tool,
          ok: false,
          progressSteps: ['Reading tender pages'],
          citedRequirements: [],
          reply: 'Could not find that requirement ID in the current session.',
        };
      }

      const evidenceText = match?.docId
        ? `${match.docName} (p.${match.page}): "${match.verbatimQuote}"`
        : 'No matching supplier evidence verified.';

      return {
        tool,
        ok: true,
        progressSteps: ['Reading tender pages', 'Checking supplier evidence'],
        citedRequirements: [req.id],
        reply: isTa
          ? `${req.id} [${finding.status}] (${req.sourceDocName}, பக்கம் ${req.sourcePage}):\nஅதிகாரப்பூர்வ விதி: "${req.officialWording}"\nவிளக்கம்: ${finding.explanationTa}\nஆதாரம்: ${evidenceText}`
          : `${req.id} [${finding.status}] — ${req.sourceDocName}, p.${req.sourcePage}\nOfficial clause: "${req.officialWording}"\nFinding: ${finding.explanation}\nEvidence: ${evidenceText}`,
      };
    }

    case 'rerun_requirement': {
      const steps = ['Validating dates and amounts', 'Rechecking evidence against tender rules'];
      const { auditedRequirements, sentinelWarnings } = runSentinelRequirementAudit(
        session.requirements,
        session.documents.tenderDoc,
        session.documents.corrigendumDoc
      );
      const { auditedMatches, sentinelWarnings: matchWarnings } = runSentinelMatchAudit(
        session.matches,
        auditedRequirements,
        session.documents.supplierDocs
      );
      session.requirements = auditedRequirements;
      session.matches = auditedMatches;
      session.validation = validateRequirements({
        requirements: session.requirements,
        matches: session.matches,
        supplierDocs: session.documents.supplierDocs,
        profile: session.profile,
        deadline: session.deadline,
      });
      session.plan = buildRescuePlan({
        requirements: session.requirements,
        validation: session.validation,
        deadline: session.deadline,
      });
      if (sentinelWarnings.length || matchWarnings.length) {
        session.warnings = Array.from(new Set([...session.warnings, ...sentinelWarnings, ...matchWarnings]));
      }
      session.audit_events.push({
        id: generateId('aud'),
        timestamp: nowIso,
        actor: 'tool',
        action: 'rerun_requirement',
        detail: `Rechecked ${targetId || 'all requirements'} deterministically.`,
        requirementId: targetId,
      });

      const targetFinding: ValidationFinding | undefined = targetId
        ? session.validation.find((v) => v.requirementId === targetId)
        : undefined;

      return {
        tool,
        ok: true,
        progressSteps: steps,
        citedRequirements: targetFinding ? [targetFinding.requirementId] : session.requirements.map((r) => r.id),
        reply: targetFinding
          ? `Rechecked ${targetFinding.requirementId}: status remains ${targetFinding.status}. ${targetFinding.explanation}`
          : `Rechecked all ${session.requirements.length} requirements. ${session.plan.length} unresolved blocker(s) remain.`,
      };
    }

    case 'record_decision': {
      const id = targetId || session.requirements[0]?.id;
      const finding = session.validation.find((v) => v.requirementId === id);
      if (!id || !finding) {
        return {
          tool,
          ok: false,
          progressSteps: ['Checking session state'],
          citedRequirements: [],
          reply: 'Please specify a valid requirement ID (such as R2 or R4) to record a decision.',
        };
      }

      const desiredDecision = params.decision || 'acknowledged_blocker';
      if (desiredDecision === 'approved_after_review' && finding.status !== 'PASS' && finding.status !== 'REVIEW_REQUIRED') {
        const reason = `Sentinel blocked approval: ${id} status is ${finding.status}.`;
        session.decisions.push({
          id: generateId('dec'),
          requirementId: id,
          decision: 'refused_override',
          actorNote: params.note || userMessage,
          timestamp: nowIso,
          blockedReason: reason,
        });
        session.audit_events.push({
          id: generateId('aud'),
          timestamp: nowIso,
          actor: 'sentinel',
          action: 'blocked_unsupported_approval',
          detail: reason,
          requirementId: id,
        });
        return {
          tool,
          ok: false,
          progressSteps: ['Validating Sentinel rules'],
          citedRequirements: [id],
          reply: `Cannot approve ${id}: its validation status is ${finding.status}. Upload valid evidence first.`,
        };
      }

      session.decisions.push({
        id: generateId('dec'),
        requirementId: id,
        decision: desiredDecision,
        actorNote: params.note || userMessage,
        timestamp: nowIso,
      });
      session.audit_events.push({
        id: generateId('aud'),
        timestamp: nowIso,
        actor: 'user',
        action: `decision_${desiredDecision}`,
        detail: `Recorded ${desiredDecision} on ${id}: ${params.note || userMessage}`,
        requirementId: id,
      });

      return {
        tool,
        ok: true,
        progressSteps: ['Recording human decision in audit trail'],
        citedRequirements: [id],
        reply: `Recorded "${desiredDecision}" on ${id} (underlying validation status remains ${finding.status}).`,
      };
    }

    case 'record_feedback': {
      const id = targetId;
      const isDispute =
        params.decision === 'disputed' ||
        /\b(disagree|wrong|incorrect|dispute|false|error|mistake)\b/i.test(userMessage);
      const kind = isDispute ? 'dispute' : 'correction_note';

      session.feedback.push({
        id: generateId('fb'),
        requirementId: id,
        kind,
        note: params.note || userMessage,
        timestamp: nowIso,
      });
      if (id && isDispute) {
        session.decisions.push({
          id: generateId('dec'),
          requirementId: id,
          decision: 'disputed',
          actorNote: params.note || userMessage,
          timestamp: nowIso,
        });
      }
      session.audit_events.push({
        id: generateId('aud'),
        timestamp: nowIso,
        actor: 'user',
        action: isDispute ? 'dispute_recorded' : 'feedback_recorded',
        detail: `Recorded ${kind}${id ? ` for ${id}` : ''}: "${userMessage}". Validation status unchanged.`,
        requirementId: id,
      });

      return {
        tool,
        ok: true,
        progressSteps: ['Recording dispute / feedback separately from validation status'],
        citedRequirements: id ? [id] : [],
        reply: isTa
          ? `உங்கள் கருத்து/மறுப்பு (${id || 'பொது'}) பதிவு செய்யப்பட்டது. அடிப்படை சரிபார்ப்பு நிலை ஆதாரம் புதுப்பிக்கப்படும் வரை மாறாது. ஆதார PDF இருந்தால் பதிவேற்றவும்.`
          : `Recorded your ${kind}${id ? ` on ${id}` : ''} in the audit log. Underlying validation results remain unchanged until supporting evidence is uploaded or verified on review.`,
      };
    }

    case 'export_report': {
      session.audit_events.push({
        id: generateId('aud'),
        timestamp: nowIso,
        actor: 'tool',
        action: 'report_requested',
        detail: 'Prepared HTML Bid Readiness Report for download.',
      });
      return {
        tool,
        ok: true,
        progressSteps: ['Compiling findings, Sentinel flags, disputes, and audit trail'],
        citedRequirements: session.requirements.map((r) => r.id),
        exportReady: true,
        reply: isTa
          ? 'உங்கள் Bid Readiness HTML அறிக்கை தயாராக உள்ளது. கீழே உள்ள "அறிக்கை பதிவிறக்கு" பொத்தானை அழுத்தவும்.'
          : 'Your HTML Bid Readiness Report is ready with all source citations, unresolved blockers, Sentinel flags, disputes, and audit events. Click "Download Report" below.',
      };
    }

    default:
      return executeGroundedTool({
        ...params,
        tool: 'list_blockers',
      });
  }
}
