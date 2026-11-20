import {
  compareCompanyIdentity,
  normalizeAmountWithUnit,
  parseFlexibleDate,
} from './sentinel.ts';
import type {
  DeadlineInfo,
  EvidenceMatch,
  IngestedDocument,
  SupplierProfile,
  TenderRequirement,
  ValidationFinding,
  ValidationStatus,
} from './types.ts';

export function computeDeadlineInfo(confirmedDate: string, now = new Date()): DeadlineInfo {
  const parsed = parseFlexibleDate(confirmedDate);
  const isoDate = parsed.isoDate || confirmedDate;
  const targetMs = parsed.timestampMs ?? Date.parse(`${confirmedDate}T17:00:00+05:30`);
  const diffMs = (Number.isFinite(targetMs) ? targetMs : now.getTime()) - now.getTime();
  const hoursRemaining = Math.round(diffMs / (1000 * 60 * 60));

  let timeRemainingText: string;
  if (!Number.isFinite(hoursRemaining)) {
    timeRemainingText = 'Deadline unparsed — confirm exact submission time';
  } else if (hoursRemaining < 0) {
    timeRemainingText = `Deadline passed (${Math.abs(hoursRemaining)}h ago)`;
  } else if (hoursRemaining < 48) {
    timeRemainingText = `${hoursRemaining} hours remaining`;
  } else {
    const days = Math.floor(hoursRemaining / 24);
    const remHours = hoursRemaining % 24;
    timeRemainingText = `${days} day${days === 1 ? '' : 's'} ${remHours}h remaining`;
  }

  return {
    confirmedDate,
    isoDeadline: Number.isFinite(targetMs) ? new Date(targetMs).toISOString() : confirmedDate,
    timeRemainingText,
    hoursRemaining: Number.isFinite(hoursRemaining) ? hoursRemaining : 0,
  };
}

/**
 * Runs deterministic compliance validation over Sentinel-audited requirements & matches.
 * File presence alone never passes; dates, amounts, company identity, and EMD rules
 * are enforced strictly in TypeScript code.
 */
export function validateRequirements(params: {
  requirements: TenderRequirement[];
  matches: EvidenceMatch[];
  supplierDocs: IngestedDocument[];
  profile: SupplierProfile;
  deadline: DeadlineInfo;
  now?: Date;
}): ValidationFinding[] {
  const { requirements, matches, supplierDocs, profile, deadline } = params;
  const now = params.now ?? new Date();
  const matchMap = new Map(matches.map((m) => [m.requirementId, m]));
  const docMap = new Map(supplierDocs.map((d) => [d.docId, d]));
  const timestamp = now.toISOString();

  return requirements.map((req) => {
    const match = matchMap.get(req.id);
    const doc = match?.docId ? docMap.get(match.docId) : undefined;
    const checksRun: string[] = ['citation_check', 'evidence_presence'];
    const sentinelFlags: string[] = [...(req.sentinelNotes || [])];

    // 1. Check if tender requirement itself lacks verified citation or has unverified amendment
    if (!req.citationVerified || req.amendmentStatus === 'review_required') {
      sentinelFlags.push('Tender clause citation or amendment relationship requires human verification.');
    }

    // 2. Check if supplier document is absent or quote failed Sentinel verification
    if (!match || !match.docId || !doc) {
      return {
        requirementId: req.id,
        status: 'MISSING',
        explanation: `No supporting supplier document was matched for ${req.id} (${req.requiredEvidence}).`,
        explanationTa: `${req.id} (${req.requiredEvidence}) விதிக்கு ஆதார ஆவணம் எதுவும் கிடைக்கவில்லை.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    if (!match.quoteVerifiedOnPage) {
      sentinelFlags.push('Matched quotation was not verified verbatim on the cited page.');
      return {
        requirementId: req.id,
        status: 'REVIEW_REQUIRED',
        explanation: `${doc.filename} was referenced, but an exact supporting quote could not be verified on page ${match.page ?? '?'}. Human review is required.`,
        explanationTa: `${doc.filename} ஆவணத்தில் பக்கம் ${match.page ?? '?'} இல் துல்லியமான ஆதார வாசகம் உறுதிப்படுத்தப்படவில்லை. மனித ஆய்வு தேவை.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    // 3. Check if cited page was flagged as scanned/low-text
    const citedPageObj = match.page ? doc.pages.find((p) => p.pageNumber === match.page) : undefined;
    if (citedPageObj?.needsOcr) {
      sentinelFlags.push(`Cited page ${match.page} in ${doc.filename} has low selectable text (needs OCR).`);
      return {
        requirementId: req.id,
        status: 'REVIEW_REQUIRED',
        explanation: `Page ${match.page} of ${doc.filename} appears scanned or low-text. Manual visual verification or OCR is required.`,
        explanationTa: `${doc.filename} பக்கம் ${match.page} ஸ்கேன் செய்யப்பட்ட படமாக இருக்கலாம்; நேரடி சரிபார்ப்பு தேவை.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    // 4. Company identity verification (wrong company evidence cannot pass)
    checksRun.push('company_identity_check');
    const idCheck = compareCompanyIdentity(profile.companyName, match.companyNameInDoc);
    if (idCheck === 'mismatch') {
      sentinelFlags.push(
        `Entity mismatch: evidence lists "${match.companyNameInDoc}" instead of "${profile.companyName}".`
      );
      return {
        requirementId: req.id,
        status: 'MISMATCH',
        explanation: `Entity mismatch in ${doc.filename} (p.${match.page}): certificate is issued to "${match.companyNameInDoc}", which does not match "${profile.companyName}".`,
        explanationTa: `${doc.filename} (பக்கம் ${match.page}) சான்றிதழில் உள்ள நிறுவனம் "${match.companyNameInDoc}" உங்கள் நிறுவனப் பெயருடன் ("${profile.companyName}") பொருந்தவில்லை.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }
    if (idCheck === 'uncertain') {
      sentinelFlags.push(
        `Uncertain company-name match: "${match.companyNameInDoc}" vs "${profile.companyName}".`
      );
      return {
        requirementId: req.id,
        status: 'REVIEW_REQUIRED',
        explanation: `Company name in ${doc.filename} ("${match.companyNameInDoc}") only partially matches "${profile.companyName}". Confirm legal entity alignment.`,
        explanationTa: `${doc.filename} ஆவணத்தில் உள்ள நிறுவனப் பெயர் ("${match.companyNameInDoc}") பகுதியாக மட்டுமே பொருந்துகிறது. உறுதிப்படுத்தவும்.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    // 5. EMD / Conditional Exemption Guardrail (Udyam alone NEVER passes EMD!)
    if (req.requirementType === 'emd' || req.conditionalExemption) {
      checksRun.push('emd_exemption_condition_check');
      const isUdyamOnly = doc.docKind === 'udyam_certificate' && !match.isSignedDeclaration;
      if (isUdyamOnly) {
        sentinelFlags.push(
          'Sentinel rule: Udyam registration alone does not establish EMD exemption without an explicit signed exemption declaration or tender-accepted proof.'
        );
        return {
          requirementId: req.id,
          status: 'MISSING',
          explanation: `The cited evidence in ${doc.filename} (p.${match.page}) does not establish EMD exemption. Submit the signed MSME EMD Exemption Declaration or EMD payment proof.`,
          explanationTa: `${doc.filename} (பக்கம் ${match.page}) ஆவணத்தில் உள்ள சான்று EMD விலக்கை உறுதிப்படுத்தவில்லை. கையொப்பமிட்ட EMD விலக்கு உறுதிமொழி அல்லது EMD கட்டண ரசீது தேவை.`,
          checksRun,
          sentinelFlags,
          lastCheckedAt: timestamp,
        };
      }
      if (req.conditionalExemption && !match.isSignedDeclaration && doc.docKind !== 'emd_declaration') {
        return {
          requirementId: req.id,
          status: 'REVIEW_REQUIRED',
          explanation: `${req.id} includes a conditional exemption. Confirm all eligibility conditions in ${doc.filename} (p.${match.page}) before relying on exemption.`,
          explanationTa: `${req.id} நிபந்தனைக்குட்பட்ட விலக்கு விதி; அனைத்து நிபந்தனைகளும் பூர்த்தியாகியுள்ளனவா என்பதைச் சரிபார்க்கவும்.`,
          checksRun,
          sentinelFlags,
          lastCheckedAt: timestamp,
        };
      }
    }

    // 6. Expiry / Validity date check in code
    if (match.expiryDateInDoc || req.validityDate || req.requirementType === 'certification') {
      checksRun.push('expiry_date_check');
      if (match.expiryDateInDoc) {
        const exp = parseFlexibleDate(match.expiryDateInDoc);
        if (exp.ambiguous || !exp.valid || !exp.timestampMs) {
          sentinelFlags.push(exp.reason || `Ambiguous expiry date "${match.expiryDateInDoc}".`);
          return {
            requirementId: req.id,
            status: 'REVIEW_REQUIRED',
            explanation: `Expiry date "${match.expiryDateInDoc}" in ${doc.filename} (p.${match.page}) is ambiguous or unreadable. Verify exact validity date.`,
            explanationTa: `${doc.filename} (பக்கம் ${match.page}) காலாவதி தேதி "${match.expiryDateInDoc}" தெளிவாக இல்லை; நேரடியாகச் சரிபார்க்கவும்.`,
            checksRun,
            sentinelFlags,
            lastCheckedAt: timestamp,
          };
        }
        const deadlineMs = Date.parse(deadline.isoDeadline);
        const referenceMs = Number.isFinite(deadlineMs) ? Math.max(now.getTime(), deadlineMs) : now.getTime();
        if (exp.timestampMs < now.getTime()) {
          return {
            requirementId: req.id,
            status: 'EXPIRED',
            explanation: `${doc.filename} (p.${match.page}) expired on ${exp.isoDate}. An active renewed certificate is required before bid submission.`,
            explanationTa: `${doc.filename} (பக்கம் ${match.page}) ${exp.isoDate} அன்று காலாவதியாகிவிட்டது. புதுப்பிக்கப்பட்ட செல்லுபடியாகும் சான்றிதழ் தேவை.`,
            checksRun,
            sentinelFlags,
            lastCheckedAt: timestamp,
          };
        }
        if (exp.timestampMs < referenceMs) {
          return {
            requirementId: req.id,
            status: 'EXPIRED',
            explanation: `${doc.filename} (p.${match.page}) expires on ${exp.isoDate}, prior to the confirmed bid deadline (${deadline.confirmedDate}).`,
            explanationTa: `${doc.filename} (பக்கம் ${match.page}) இறுதித் தேதிக்கு (${deadline.confirmedDate}) முன்பே ${exp.isoDate} அன்று காலாவதியாகிறது.`,
            checksRun,
            sentinelFlags,
            lastCheckedAt: timestamp,
          };
        }
      } else if (req.requirementType === 'certification') {
        sentinelFlags.push('Certificate validity/expiry date not clearly extracted.');
        return {
          requirementId: req.id,
          status: 'REVIEW_REQUIRED',
          explanation: `${doc.filename} (p.${match.page}) matched, but no explicit validity/expiry date was verified. Confirm certificate is currently active.`,
          explanationTa: `${doc.filename} (பக்கம் ${match.page}) இணைக்கப்பட்டது; ஆனால் காலாவதி தேதி தெளிவாகப் பெறப்படவில்லை. செயலில் உள்ளதா எனச் சரிபார்க்கவும்.`,
          checksRun,
          sentinelFlags,
          lastCheckedAt: timestamp,
        };
      }
    }

    // 7. Numeric threshold & unit check in code
    if (typeof req.thresholdNumber === 'number') {
      checksRun.push('threshold_amount_unit_check');
      const reqNorm = normalizeAmountWithUnit(req.thresholdNumber, req.thresholdUnit);
      const docNorm = normalizeAmountWithUnit(match.amountInDoc, match.unitInDoc);

      if (
        reqNorm.normalizedValue === null ||
        docNorm.normalizedValue === null ||
        reqNorm.canonicalDimension !== docNorm.canonicalDimension
      ) {
        sentinelFlags.push(
          `Ambiguous or mismatched unit/value: required ${req.thresholdNumber} ${req.thresholdUnit ?? ''}, found ${match.amountInDoc ?? 'N/A'} ${match.unitInDoc ?? ''}.`
        );
        return {
          requirementId: req.id,
          status: 'REVIEW_REQUIRED',
          explanation: `Numeric threshold check (${req.thresholdNumber} ${req.thresholdUnit ?? ''}) vs ${doc.filename} (${match.amountInDoc ?? 'unparsed'} ${match.unitInDoc ?? ''}) has missing or ambiguous units. Verify manually.`,
          explanationTa: `தேவையான அளவு (${req.thresholdNumber} ${req.thresholdUnit ?? ''}) மற்றும் ஆவண மதிப்பு (${match.amountInDoc ?? '-'} ${match.unitInDoc ?? ''}) அலகுகளில் தெளிவின்மை உள்ளது; சரிபார்க்கவும்.`,
          checksRun,
          sentinelFlags,
          lastCheckedAt: timestamp,
        };
      }

      if (docNorm.normalizedValue < reqNorm.normalizedValue) {
        return {
          requirementId: req.id,
          status: 'FAIL',
          explanation: `${doc.filename} (p.${match.page}) shows ${match.amountInDoc} ${match.unitInDoc}, which is below the required ${req.thresholdNumber} ${req.thresholdUnit}.`,
          explanationTa: `${doc.filename} (பக்கம் ${match.page}) காட்டும் மதிப்பு (${match.amountInDoc} ${match.unitInDoc}) தேவையான ${req.thresholdNumber} ${req.thresholdUnit} விடக் குறைவாக உள்ளது.`,
          checksRun,
          sentinelFlags,
          lastCheckedAt: timestamp,
        };
      }
    }

    // 8. Technical / uncertain match completeness check
    if (match.matchConfidence === 'uncertain') {
      return {
        requirementId: req.id,
        status: 'REVIEW_REQUIRED',
        explanation: `${doc.filename} (p.${match.page}) partially addresses ${req.id}, but full technical/supporting compliance is not conclusively established.`,
        explanationTa: `${doc.filename} (பக்கம் ${match.page}) ${req.id} விதியை பகுதியாக மட்டுமே பூர்த்தி செய்கிறது; முழு ஆதாரத்தைச் சரிபார்க்கவும்.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    if (!req.citationVerified || req.amendmentStatus === 'review_required') {
      return {
        requirementId: req.id,
        status: 'REVIEW_REQUIRED',
        explanation: `Supplier evidence in ${doc.filename} (p.${match.page}) looks consistent, but the underlying tender requirement citation needs human verification.`,
        explanationTa: `உங்கள் ஆவணம் (${doc.filename}, பக்கம் ${match.page}) பொருத்தமாக இருந்தாலும் டெண்டர் விதி மேற்கோளை நேரடியாகச் சரிபார்க்க வேண்டும்.`,
        checksRun,
        sentinelFlags,
        lastCheckedAt: timestamp,
      };
    }

    const status: ValidationStatus = 'PASS';
    return {
      requirementId: req.id,
      status,
      explanation: `Verified against ${doc.filename} (p.${match.page}): "${match.verbatimQuote.slice(0, 140)}".`,
      explanationTa: `${doc.filename} (பக்கம் ${match.page}) மூலம் உறுதிப்படுத்தப்பட்டது.`,
      checksRun,
      sentinelFlags,
      lastCheckedAt: timestamp,
    };
  });
}
