import { buildEvidenceSnippets } from './ingest.ts';
import { buildRescuePlan } from './rescue.ts';
import { runSentinelMatchAudit, runSentinelRequirementAudit } from './sentinel.ts';
import { createSessionRecord, generateId } from './sessionStore.ts';
import type {
  EvidenceMatch,
  IngestedDocument,
  SessionState,
  TenderRequirement,
} from './types.ts';
import { computeDeadlineInfo, validateRequirements } from './validator.ts';

/**
 * Generates a minimal valid single-page PDF Buffer containing readable text.
 * Used for testing real binary PDF parsing and providing a downloadable sample
 * corrected ISO certificate without external binary fixtures.
 */
export function buildSimplePdfBuffer(lines: string[]): Buffer {
  const safeLines = lines.map((l) =>
    l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );
  const textOps = safeLines
    .map((line, i) => `BT /F1 11 Tf 48 ${740 - i * 18} Td (${line}) Tj ET`)
    .join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
  );
  objects.push(
    `4 0 obj\n<< /Length ${Buffer.byteLength(textOps, 'utf8')} >>\nstream\n${textOps}\nendstream\nendobj\n`
  );
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

export function getSampleCorrectedIsoPdfBuffer(): Buffer {
  return buildSimplePdfBuffer([
    'SAMPLE FICTIONAL CERTIFICATE - RENEWED ISO 9001:2015',
    'Certificate No: TUV-TN-2026-88412',
    'Certified Entity: Kaveri Precision Fabricators Pvt Ltd',
    'District: Coimbatore, Tamil Nadu',
    'Standard: ISO 9001:2015 Quality Management System',
    'Issue Date: 2026-04-05',
    'Valid Until: 2029-04-04',
    'Status: Active and Renewed for Precision Sheet Metal Fabrication',
  ]);
}

export function createSampleSession(): SessionState {
  const futureDeadlineDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const tenderDoc: IngestedDocument = {
    docId: 'TENDER_SAMPLE',
    filename: 'SAMPLE_TNSIDC_Workshop_Tender.pdf',
    role: 'tender',
    pageCount: 3,
    scannedPages: [],
    contentHash: 'sample_tender_v1',
    docKind: 'general_document',
    sizeBytes: 42100,
    pages: [
      {
        pageNumber: 1,
        charCount: 310,
        needsOcr: false,
        text:
          'FICTIONAL SAMPLE TENDER TNSIDC/2026/MECH-019 — Supply of Industrial Steel Workbenches. ' +
          'Clause R1: Bidder must possess an active GST Registration Certificate in Tamil Nadu. ' +
          'Clause R2: Bidder must hold a valid ISO 9001:2015 Quality Management System certificate active on bid submission date.',
      },
      {
        pageNumber: 2,
        charCount: 340,
        needsOcr: false,
        text:
          'Clause R3: Minimum Average Annual Turnover of Rs. 1.50 Crore during the preceding three financial years certified by a Chartered Accountant with UDIN. ' +
          'Clause R4: Earnest Money Deposit (EMD) of Rs. 75,000 or a signed MSME EMD Exemption Declaration supported by valid MSE eligibility proof.',
      },
      {
        pageNumber: 3,
        charCount: 220,
        needsOcr: false,
        text:
          'Clause R5: Technical Specification — 1.6 mm CRCA sheet worktop with certified static load test report of minimum 500 kg.',
      },
    ],
  };

  const supplierDocs: IngestedDocument[] = [
    {
      docId: 'SUP_1',
      filename: 'Sample_GST_Certificate.pdf',
      role: 'supplier',
      pageCount: 1,
      scannedPages: [],
      contentHash: 'sample_gst_1',
      docKind: 'gst_certificate',
      sizeBytes: 12400,
      pages: [
        {
          pageNumber: 1,
          charCount: 185,
          needsOcr: false,
          text:
            'FORM GST REG-06. Legal Name: Kaveri Precision Fabricators Pvt Ltd. GSTIN: 33AABCK4421M1Z5. State: Tamil Nadu. Registration Status: Active.',
        },
      ],
    },
    {
      docId: 'SUP_2',
      filename: 'Sample_Udyam_Certificate.pdf',
      role: 'supplier',
      pageCount: 1,
      scannedPages: [],
      contentHash: 'sample_udyam_2',
      docKind: 'udyam_certificate',
      sizeBytes: 11200,
      pages: [
        {
          pageNumber: 1,
          charCount: 165,
          needsOcr: false,
          text:
            'UDYAM REGISTRATION CERTIFICATE UDYAM-TN-03-0041928. Name of Enterprise: Kaveri Precision Fabricators Pvt Ltd. Major Activity: Manufacturing.',
        },
      ],
    },
    {
      docId: 'SUP_3',
      filename: 'Sample_ISO_9001_Certificate.pdf',
      role: 'supplier',
      pageCount: 1,
      scannedPages: [],
      contentHash: 'sample_iso_3',
      docKind: 'iso_certificate',
      sizeBytes: 14100,
      pages: [
        {
          pageNumber: 1,
          charCount: 180,
          needsOcr: false,
          text:
            'ISO 9001:2015 Quality Management System Certificate. Issued to: Kaveri Precision Fabricators Pvt Ltd. Issue Date: 2022-04-01. Valid Until: 2025-03-31.',
        },
      ],
    },
    {
      docId: 'SUP_4',
      filename: 'Sample_CA_Turnover_Statement.pdf',
      role: 'supplier',
      pageCount: 1,
      scannedPages: [],
      contentHash: 'sample_turnover_4',
      docKind: 'turnover_statement',
      sizeBytes: 13800,
      pages: [
        {
          pageNumber: 1,
          charCount: 195,
          needsOcr: false,
          text:
            'Chartered Accountant Turnover Certificate (UDIN 26214099AAAA1234). Entity: Kaveri Precision Fabricators Pvt Ltd. Average Annual Turnover: 1.85 Crore INR.',
        },
      ],
    },
    {
      docId: 'SUP_5',
      filename: 'Sample_Technical_Sheet_Partial.pdf',
      role: 'supplier',
      pageCount: 1,
      scannedPages: [],
      contentHash: 'sample_tech_5',
      docKind: 'technical_evidence',
      sizeBytes: 9800,
      pages: [
        {
          pageNumber: 1,
          charCount: 140,
          needsOcr: false,
          text:
            'Product Brochure: Kaveri Precision Fabricators Pvt Ltd Workbench Series. Material: 1.6 mm CRCA sheet. Load test report pending lab issue.',
        },
      ],
    },
  ];

  const rawRequirements: TenderRequirement[] = [
    {
      id: 'R1',
      officialWording: 'Active GST Registration Certificate in Tamil Nadu.',
      sourceDocId: 'TENDER_SAMPLE',
      sourceDocName: tenderDoc.filename,
      sourcePage: 1,
      verbatimQuote: 'Bidder must possess an active GST Registration Certificate in Tamil Nadu.',
      requirementType: 'registration',
      requiredEvidence: 'Active GST REG-06 Certificate',
      amendmentStatus: 'original',
      citationVerified: false,
      sentinelNotes: [],
    },
    {
      id: 'R2',
      officialWording: 'Valid ISO 9001:2015 Quality Management System certificate active on submission date.',
      sourceDocId: 'TENDER_SAMPLE',
      sourceDocName: tenderDoc.filename,
      sourcePage: 1,
      verbatimQuote: 'Bidder must hold a valid ISO 9001:2015 Quality Management System certificate active on bid submission date.',
      requirementType: 'certification',
      requiredEvidence: 'Active ISO 9001:2015 Certificate',
      amendmentStatus: 'original',
      citationVerified: false,
      sentinelNotes: [],
    },
    {
      id: 'R3',
      officialWording: 'Minimum Average Annual Turnover of Rs. 1.50 Crore certified by CA with UDIN.',
      sourceDocId: 'TENDER_SAMPLE',
      sourceDocName: tenderDoc.filename,
      sourcePage: 2,
      verbatimQuote: 'Minimum Average Annual Turnover of Rs. 1.50 Crore during the preceding three financial years',
      requirementType: 'financial',
      requiredEvidence: 'CA Turnover Certificate with UDIN',
      thresholdNumber: 1.5,
      thresholdUnit: 'Crore',
      amendmentStatus: 'original',
      citationVerified: false,
      sentinelNotes: [],
    },
    {
      id: 'R4',
      officialWording: 'EMD of Rs. 75,000 or signed MSME EMD Exemption Declaration with MSE proof.',
      sourceDocId: 'TENDER_SAMPLE',
      sourceDocName: tenderDoc.filename,
      sourcePage: 2,
      verbatimQuote: 'Earnest Money Deposit (EMD) of Rs. 75,000 or a signed MSME EMD Exemption Declaration supported by valid MSE eligibility proof.',
      requirementType: 'emd',
      requiredEvidence: 'Signed MSME EMD Exemption Declaration or EMD Receipt',
      thresholdNumber: 75000,
      thresholdUnit: 'INR',
      conditionalExemption: true,
      amendmentStatus: 'original',
      citationVerified: false,
      sentinelNotes: [],
    },
    {
      id: 'R5',
      officialWording: '1.6 mm CRCA sheet worktop with certified static load test report (500 kg).',
      sourceDocId: 'TENDER_SAMPLE',
      sourceDocName: tenderDoc.filename,
      sourcePage: 3,
      verbatimQuote: '1.6 mm CRCA sheet worktop with certified static load test report of minimum 500 kg.',
      requirementType: 'technical',
      requiredEvidence: '1.6 mm CRCA Spec & Certified 500 kg Static Load Test Report',
      amendmentStatus: 'original',
      citationVerified: false,
      sentinelNotes: [],
    },
  ];

  const rawMatches: EvidenceMatch[] = [
    {
      requirementId: 'R1',
      docId: 'SUP_1',
      docName: 'Sample_GST_Certificate.pdf',
      page: 1,
      verbatimQuote: 'Legal Name: Kaveri Precision Fabricators Pvt Ltd. GSTIN: 33AABCK4421M1Z5. State: Tamil Nadu. Registration Status: Active.',
      quoteVerifiedOnPage: false,
      extractedFacts: [],
      matchConfidence: 'high',
      companyNameInDoc: 'Kaveri Precision Fabricators Pvt Ltd',
      notes: [],
    },
    {
      requirementId: 'R2',
      docId: 'SUP_3',
      docName: 'Sample_ISO_9001_Certificate.pdf',
      page: 1,
      verbatimQuote: 'ISO 9001:2015 Quality Management System Certificate. Issued to: Kaveri Precision Fabricators Pvt Ltd. Issue Date: 2022-04-01. Valid Until: 2025-03-31.',
      quoteVerifiedOnPage: false,
      extractedFacts: [],
      matchConfidence: 'high',
      companyNameInDoc: 'Kaveri Precision Fabricators Pvt Ltd',
      expiryDateInDoc: '2025-03-31',
      notes: [],
    },
    {
      requirementId: 'R3',
      docId: 'SUP_4',
      docName: 'Sample_CA_Turnover_Statement.pdf',
      page: 1,
      verbatimQuote: 'Entity: Kaveri Precision Fabricators Pvt Ltd. Average Annual Turnover: 1.85 Crore INR.',
      quoteVerifiedOnPage: false,
      extractedFacts: [],
      matchConfidence: 'high',
      companyNameInDoc: 'Kaveri Precision Fabricators Pvt Ltd',
      amountInDoc: 1.85,
      unitInDoc: 'Crore',
      notes: [],
    },
    {
      requirementId: 'R4',
      docId: 'SUP_2',
      docName: 'Sample_Udyam_Certificate.pdf',
      page: 1,
      verbatimQuote: 'UDYAM REGISTRATION CERTIFICATE UDYAM-TN-03-0041928. Name of Enterprise: Kaveri Precision Fabricators Pvt Ltd.',
      quoteVerifiedOnPage: false,
      extractedFacts: [],
      matchConfidence: 'uncertain',
      companyNameInDoc: 'Kaveri Precision Fabricators Pvt Ltd',
      isSignedDeclaration: false,
      notes: [],
    },
    {
      requirementId: 'R5',
      docId: 'SUP_5',
      docName: 'Sample_Technical_Sheet_Partial.pdf',
      page: 1,
      verbatimQuote: 'Material: 1.6 mm CRCA sheet. Load test report pending lab issue.',
      quoteVerifiedOnPage: false,
      extractedFacts: [],
      matchConfidence: 'uncertain',
      companyNameInDoc: 'Kaveri Precision Fabricators Pvt Ltd',
      notes: [],
    },
  ];

  const profile = {
    companyName: 'Kaveri Precision Fabricators Pvt Ltd',
    district: 'Coimbatore',
    sector: 'Manufacturing & Engineering',
    tenderReference: 'SAMPLE · TNSIDC/2026/MECH-019',
  };
  const deadline = computeDeadlineInfo(futureDeadlineDate);

  const { auditedRequirements, sentinelWarnings } = runSentinelRequirementAudit(
    rawRequirements,
    tenderDoc
  );
  const { auditedMatches, sentinelWarnings: matchWarnings } = runSentinelMatchAudit(
    rawMatches,
    auditedRequirements,
    supplierDocs
  );
  const validation = validateRequirements({
    requirements: auditedRequirements,
    matches: auditedMatches,
    supplierDocs,
    profile,
    deadline,
  });
  const plan = buildRescuePlan({
    requirements: auditedRequirements,
    validation,
    deadline,
  });

  return createSessionRecord({
    mode: 'SAMPLE',
    profile,
    deadline,
    documents: {
      tenderDoc,
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
        action: 'sample_session_created',
        detail:
          'Loaded clearly labeled SAMPLE MODE fictional tender (TNSIDC/2026/MECH-019) and supplier packet.',
      },
    ],
    warnings: [
      'SAMPLE MODE ACTIVE: Fictional demonstration tender and supplier documents (not a real IIT Madras or government tender).',
      ...sentinelWarnings,
      ...matchWarnings,
    ],
    provider: {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      extractionMode: 'sample',
    },
    chatHistory: [
      {
        id: generateId('msg'),
        role: 'assistant',
        timestamp: new Date().toISOString(),
        toolUsed: 'list_blockers',
        progressSteps: [
          'Reading tender pages',
          'Extracting requirements',
          'Checking supplier evidence',
          'Validating dates and amounts',
          'Preparing rescue actions',
        ],
        citedRequirements: ['R2', 'R4', 'R5'],
        text:
          'Sample Mode loaded for Kaveri Precision Fabricators Pvt Ltd (Coimbatore). ' +
          'R1 (GST) and R3 (Turnover ₹1.85 Cr) PASS, while R2 (ISO 9001 expired 2025-03-31), R4 (EMD exemption declaration missing — Udyam alone is insufficient), and R5 (Load test report pending) block submission. ' +
          'Ask "What should I fix first?", upload the sample corrected ISO PDF, or test Sentinel by asking to "Mark EMD as passed".',
      },
    ],
  });
}
