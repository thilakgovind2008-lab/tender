export type SessionMode = 'LIVE' | 'SAMPLE';

export type ValidationStatus =
  | 'PASS'
  | 'FAIL'
  | 'MISSING'
  | 'EXPIRED'
  | 'MISMATCH'
  | 'REVIEW_REQUIRED'
  | 'NOT_APPLICABLE';

export type UrgencyLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ChatLanguage = 'Eng' | 'Tam' | 'Hin';

export interface SupplierProfile {
  companyName: string;
  district: string;
  sector: string;
  tenderReference?: string;
  email?: string;
}

export interface DeadlineInfo {
  confirmedDate: string;
  isoDeadline: string;
  timeRemainingText: string;
  hoursRemaining: number;
}

export interface PageContent {
  pageNumber: number;
  text: string;
  charCount: number;
  needsOcr: boolean;
}

export interface IngestedDocument {
  docId: string;
  filename: string;
  role: 'tender' | 'corrigendum' | 'supplier' | 'correction';
  pageCount: number;
  pages: PageContent[];
  scannedPages: number[];
  contentHash: string;
  docKind: string;
  sizeBytes: number;
}

export interface TenderRequirement {
  id: string;
  officialWording: string;
  sourceDocId: string;
  sourceDocName: string;
  sourcePage: number;
  verbatimQuote: string;
  requirementType:
    | 'registration'
    | 'certification'
    | 'financial'
    | 'emd'
    | 'technical'
    | 'experience'
    | 'corrigendum'
    | 'other';
  requiredEvidence: string;
  thresholdNumber?: number;
  thresholdUnit?: string;
  validityDate?: string;
  conditionalExemption?: boolean;
  amendmentStatus: 'original' | 'amended' | 'review_required';
  citationVerified: boolean;
  sentinelNotes: string[];
}

export interface EvidenceSnippet {
  docId: string;
  docName: string;
  docKind: string;
  page: number;
  excerpt: string;
}

export interface ExtractedFact {
  label: string;
  value: string;
  supportingQuote: string;
  quoteVerifiedOnPage: boolean;
  numericValue?: number;
  unit?: string;
  dateValue?: string;
}

export interface EvidenceMatch {
  requirementId: string;
  docId: string | null;
  docName: string | null;
  page: number | null;
  verbatimQuote: string;
  quoteVerifiedOnPage: boolean;
  extractedFacts: ExtractedFact[];
  matchConfidence: 'high' | 'uncertain' | 'none';
  companyNameInDoc?: string;
  expiryDateInDoc?: string;
  issueDateInDoc?: string;
  amountInDoc?: number;
  unitInDoc?: string;
  isSignedDeclaration?: boolean;
  notes: string[];
}

export interface ValidationFinding {
  requirementId: string;
  status: ValidationStatus;
  explanation: string;
  explanationTa: string;
  checksRun: string[];
  sentinelFlags: string[];
  lastCheckedAt: string;
}

export interface RescueAction {
  requirementId: string;
  priority: number;
  urgency: UrgencyLevel;
  whatToFix: string;
  whatToFixTa: string;
  whyItMatters: string;
  requiredEvidence: string;
  suggestedOwner: string;
  timeRemaining: string;
  leadTimeNote: string;
  feasibility: 'known' | 'unknown' | 'unlikely';
  dependencies: string[];
}

export interface HumanDecision {
  id: string;
  requirementId: string;
  decision: 'approved_after_review' | 'acknowledged_blocker' | 'disputed' | 'refused_override';
  actorNote: string;
  timestamp: string;
  blockedReason?: string;
}

export interface FeedbackEntry {
  id: string;
  requirementId?: string;
  kind: 'agree' | 'dispute' | 'correction_note';
  note: string;
  timestamp: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: 'system' | 'sentinel' | 'user' | 'tool';
  action: string;
  detail: string;
  requirementId?: string;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  toolUsed?: string;
  progressSteps?: string[];
  citedRequirements?: string[];
}

export interface SessionState {
  sessionId: string;
  mode: SessionMode;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  profile: SupplierProfile;
  deadline: DeadlineInfo;
  documents: {
    tenderDoc: IngestedDocument;
    corrigendumDoc?: IngestedDocument;
    supplierDocs: IngestedDocument[];
  };
  requirements: TenderRequirement[];
  evidence: EvidenceSnippet[];
  matches: EvidenceMatch[];
  validation: ValidationFinding[];
  plan: RescueAction[];
  decisions: HumanDecision[];
  feedback: FeedbackEntry[];
  audit_events: AuditEvent[];
  warnings: string[];
  provider: {
    provider: 'gemini';
    model: string;
    extractionMode: 'live' | 'sample' | 'degraded';
    lastProbeLatencyMs?: number;
  };
  revision: number;
  chatHistory: ChatTurn[];
}

export interface IntegrationBoundaries {
  sarvamVoice: {
    connected: boolean;
    purpose: string;
    note: string;
  };
  n8nAutomation: {
    connected: boolean;
    requiresExplicitAuthorization: boolean;
    purpose: string;
    note: string;
  };
}
