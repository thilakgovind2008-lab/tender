import type {
  DeadlineInfo,
  RescueAction,
  TenderRequirement,
  UrgencyLevel,
  ValidationFinding,
} from './types.ts';

function suggestOwnerForRequirement(req: TenderRequirement): string {
  switch (req.requirementType) {
    case 'financial':
    case 'emd':
    case 'registration':
      return 'Accountant / Chartered Accountant';
    case 'certification':
      return 'Quality & Compliance Lead';
    case 'technical':
    case 'experience':
      return 'Production / Technical Manager';
    case 'corrigendum':
      return 'Managing Partner / Bid Coordinator';
    default:
      return 'Bid Coordinator / Authorised Signatory';
  }
}

function leadTimeForRequirement(
  req: TenderRequirement,
  status: ValidationFinding['status'],
  deadline: DeadlineInfo
): { feasibility: RescueAction['feasibility']; leadTimeNote: string } {
  if (status === 'EXPIRED' && req.requirementType === 'certification') {
    return {
      feasibility: 'unknown',
      leadTimeNote:
        'External ISO/certification renewal turnaround is unverified — confirm immediately with your accreditation registrar whether a valid renewed certificate or renewal receipt is acceptable before deadline.',
    };
  }
  if (status === 'MISSING' && req.requirementType === 'emd') {
    return {
      feasibility: deadline.hoursRemaining > 4 ? 'known' : 'unknown',
      leadTimeNote:
        'Internal signed MSME EMD Exemption Declaration (if tender-permitted) or bank/portal EMD remittance can usually be prepared internally, subject to tender portal cut-off.',
    };
  }
  if (status === 'REVIEW_REQUIRED') {
    return {
      feasibility: 'unknown',
      leadTimeNote:
        'Feasibility unknown until a human reviewer verifies the cited page/document or uploads clearer supporting proof.',
    };
  }
  if (status === 'MISMATCH' || status === 'FAIL') {
    return {
      feasibility: 'unknown',
      leadTimeNote:
        'Completion feasibility is unknown — depends on whether qualifying entity documents or compliant test/financial records exist.',
    };
  }
  return {
    feasibility: 'unknown',
    leadTimeNote: 'External processing lead time unverified.',
  };
}

export function buildRescuePlan(params: {
  requirements: TenderRequirement[];
  validation: ValidationFinding[];
  deadline: DeadlineInfo;
}): RescueAction[] {
  const { requirements, validation, deadline } = params;
  const reqMap = new Map(requirements.map((r) => [r.id, r]));

  const unresolved = validation.filter(
    (v) => v.status !== 'PASS' && v.status !== 'NOT_APPLICABLE'
  );

  const severityScore = (status: ValidationFinding['status']): number => {
    switch (status) {
      case 'MISSING':
        return 5;
      case 'EXPIRED':
        return 4;
      case 'FAIL':
        return 4;
      case 'MISMATCH':
        return 3;
      case 'REVIEW_REQUIRED':
        return 2;
      default:
        return 1;
    }
  };

  unresolved.sort((a, b) => severityScore(b.status) - severityScore(a.status));

  return unresolved.map((finding, idx) => {
    const req = reqMap.get(finding.requirementId)!;
    const score = severityScore(finding.status);
    let urgency: UrgencyLevel = 'MEDIUM';
    if (score >= 4 && deadline.hoursRemaining <= 96) {
      urgency = 'CRITICAL';
    } else if (score >= 4) {
      urgency = 'HIGH';
    } else if (score === 3) {
      urgency = 'HIGH';
    }

    let whatToFix = finding.explanation;
    let whatToFixTa = finding.explanationTa;
    if (finding.status === 'EXPIRED') {
      whatToFix = `Replace expired certificate for ${req.id} with an active renewed certificate valid beyond ${deadline.confirmedDate}.`;
      whatToFixTa = `${req.id} விதிக்கு காலாவதியான சான்றிதழுக்குப் பதிலாக ${deadline.confirmedDate} வரை செல்லுபடியாகும் புதுப்பிக்கப்பட்ட சான்றிதழைப் பதிவேற்றவும்.`;
    } else if (finding.status === 'MISSING' && req.requirementType === 'emd') {
      whatToFix = `Provide an explicit signed MSME EMD Exemption Declaration (with supporting applicability proof) or upload EMD payment receipt for ${req.id}.`;
      whatToFixTa = `${req.id} விதிக்கு கையொப்பமிட்ட MSME EMD விலக்கு உறுதிமொழி அல்லது EMD கட்டண ரசீதைப் பதிவேற்றவும்.`;
    } else if (finding.status === 'MISSING') {
      whatToFix = `Obtain and upload valid evidence satisfying ${req.id}: ${req.requiredEvidence}.`;
      whatToFixTa = `${req.id} விதிக்கான சரியான ஆதார ஆவணத்தை (${req.requiredEvidence}) பதிவேற்றவும்.`;
    } else if (finding.status === 'MISMATCH') {
      whatToFix = `Upload evidence issued under the exact bidding entity name for ${req.id}.`;
      whatToFixTa = `${req.id} விதிக்கு ஏலத்தில் பங்கேற்கும் உங்கள் நிறுவனத்தின் பெயரில் உள்ள ஆவணத்தைப் பதிவேற்றவும்.`;
    }

    const { feasibility, leadTimeNote } = leadTimeForRequirement(req, finding.status, deadline);
    const dependencies: string[] = [];
    if (req.amendmentStatus === 'review_required') {
      dependencies.push('Verify corrigendum clause against original NIT');
    }
    if (finding.sentinelFlags.length > 0) {
      dependencies.push('Resolve Sentinel citation/verification flag');
    }
    if (req.requirementType === 'emd' && req.conditionalExemption) {
      dependencies.push('Confirm whether tender allows MSE EMD exemption for this item category');
    }

    return {
      requirementId: req.id,
      priority: idx + 1,
      urgency,
      whatToFix,
      whatToFixTa,
      whyItMatters: `Mandatory tender clause (${req.sourceDocName}, p.${req.sourcePage}): "${req.verbatimQuote.slice(0, 140)}". Unresolved gaps can trigger technical disqualification.`,
      requiredEvidence: req.requiredEvidence,
      suggestedOwner: suggestOwnerForRequirement(req),
      timeRemaining: deadline.timeRemainingText,
      leadTimeNote,
      feasibility,
      dependencies,
    };
  });
}
