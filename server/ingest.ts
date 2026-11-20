import crypto from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { EvidenceSnippet, IngestedDocument, PageContent } from './types.ts';

if (!(globalThis as Record<string, unknown>).pdfjsWorker) {
  (globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
}

export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_ZIP_ENTRIES = 40;
export const MAX_ZIP_EXPANDED_BYTES = 80 * 1024 * 1024; // 80 MB
export const MAX_COMPRESSION_RATIO = 50;
const MIN_READABLE_PAGE_CHARS = 35;

export class IngestionError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'IngestionError';
    this.statusCode = statusCode;
  }
}

export function inferDocumentKind(fullText: string, filename = ''): string {
  const lower = `${fullText}\n${filename}`.toLowerCase();
  if (/iso\s*9001|quality\s*management\s*system|qms\s*certificate|tuv|bsi|nabcb/i.test(lower)) {
    return 'iso_certificate';
  }
  if (/gstin|goods\s*and\s*services\s*tax|form\s*gst\s*reg|cgst|sgst/i.test(lower)) {
    return 'gst_certificate';
  }
  if (/udyam\s*registration|udyam-[a-z]{2}-\d{2}|ministry\s*of\s*micro,\s*small/i.test(lower)) {
    return 'udyam_certificate';
  }
  if (/earnest\s*money\s*deposit|emd\s*exemption|bid\s*security\s*declaration|msme\s*exemption/i.test(lower)) {
    return 'emd_declaration';
  }
  if (/annual\s*turnover|chartered\s*accountant|udin|audited\s*balance|profit\s*and\s*loss/i.test(lower)) {
    return 'turnover_statement';
  }
  if (/test\s*report|technical\s*compliance|crca|calibration|work\s*order|completion\s*certificate|specification/i.test(lower)) {
    return 'technical_evidence';
  }
  if (/corrigendum|addendum|amendment\s*no/i.test(lower)) {
    return 'corrigendum';
  }
  return 'general_document';
}

export function assertSafeArchivePath(entryName: string): void {
  if (!entryName || entryName.includes('\0')) {
    throw new IngestionError('Rejected archive entry with empty or null-byte path.');
  }
  const normalized = entryName.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((seg) => seg === '..')
  ) {
    throw new IngestionError(`Rejected unsafe archive path: "${entryName}".`);
  }
}

export async function extractPdfPages(
  buffer: Buffer,
  filename: string,
  role: IngestedDocument['role'],
  docId: string
): Promise<IngestedDocument> {
  if (buffer.length === 0) {
    throw new IngestionError(`Uploaded PDF "${filename}" is empty.`);
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new IngestionError(`PDF "${filename}" exceeds the 25 MB size limit.`);
  }
  const header = buffer.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new IngestionError(`File "${filename}" does not have a valid %PDF header.`);
  }

  let doc;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    doc = await loadingTask.promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypted')) {
      throw new IngestionError(`Encrypted or password-protected PDF "${filename}" is not supported.`);
    }
    throw new IngestionError(`Failed to parse PDF "${filename}": ${msg}`);
  }

  const pages: PageContent[] = [];
  const scannedPages: number[] = [];

  try {
    const pageCount = doc.numPages;
    if (pageCount === 0) {
      throw new IngestionError(`PDF "${filename}" contains zero pages.`);
    }

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const rawStrings = content.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean);
      const text = rawStrings.join(' ').replace(/\s+/g, ' ').trim();
      const charCount = text.length;
      const needsOcr = charCount < MIN_READABLE_PAGE_CHARS;
      if (needsOcr) {
        scannedPages.push(pageNum);
      }
      pages.push({
        pageNumber: pageNum,
        text,
        charCount,
        needsOcr,
      });
    }
  } finally {
    const disposable = doc as unknown as {
      destroy?: () => Promise<void> | void;
      cleanup?: () => Promise<void> | void;
    };
    if (typeof disposable.destroy === 'function') {
      await disposable.destroy();
    } else if (typeof disposable.cleanup === 'function') {
      await disposable.cleanup();
    }
  }

  const combinedText = pages.map((p) => p.text).join('\n');
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

  return {
    docId,
    filename: path.basename(filename),
    role,
    pageCount: pages.length,
    pages,
    scannedPages,
    contentHash,
    docKind: inferDocumentKind(combinedText, filename),
    sizeBytes: buffer.length,
  };
}

export async function ingestSupplierZip(
  zipBuffer: Buffer,
  zipFilename: string
): Promise<{ docs: IngestedDocument[]; warnings: string[] }> {
  if (zipBuffer.length === 0) {
    throw new IngestionError(`Uploaded ZIP "${zipFilename}" is empty.`);
  }
  if (zipBuffer.length > MAX_ZIP_BYTES) {
    throw new IngestionError(`ZIP archive "${zipFilename}" exceeds the 50 MB size limit.`);
  }
  if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
    throw new IngestionError(`File "${zipFilename}" is not a valid ZIP archive.`);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (err) {
    throw new IngestionError(
      `Corrupted or unreadable ZIP archive "${zipFilename}": ${err instanceof Error ? err.message : 'Invalid ZIP'}`
    );
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new IngestionError(
      `ZIP archive exceeds maximum allowed entry count (${entries.length} > ${MAX_ZIP_ENTRIES}).`
    );
  }

  const docs: IngestedDocument[] = [];
  const warnings: string[] = [];
  let totalExpandedBytes = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    assertSafeArchivePath(entry.entryName);

    // Skip directory entries and macOS resource fork metadata
    const normalized = entry.entryName.replace(/\\/g, '/');
    if (entry.isDirectory || normalized.startsWith('__MACOSX/') || path.basename(normalized) === '.DS_Store') {
      continue;
    }

    // Reject encrypted ZIP entries (general purpose bit flag 0)
    if ((entry.header.flags & 0x01) !== 0) {
      throw new IngestionError(`Encrypted ZIP entry "${entry.entryName}" is not supported.`);
    }

    // Check uncompressed size & zip-bomb ratio BEFORE inflating
    const declaredSize = entry.header.size;
    const compressedSize = Math.max(1, entry.header.compressedSize);
    if (declaredSize > MAX_PDF_BYTES) {
      throw new IngestionError(`Archive entry "${entry.entryName}" exceeds 25 MB limit.`);
    }
    if (declaredSize > 1024 && declaredSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new IngestionError(
        `Rejected archive entry "${entry.entryName}" due to unsafe compression ratio.`
      );
    }

    totalExpandedBytes += declaredSize;
    if (totalExpandedBytes > MAX_ZIP_EXPANDED_BYTES) {
      throw new IngestionError(
        `Expanded archive size exceeds ${Math.round(MAX_ZIP_EXPANDED_BYTES / (1024 * 1024))} MB limit.`
      );
    }

    const ext = path.extname(normalized).toLowerCase();
    if (ext !== '.pdf') {
      throw new IngestionError(
        `Unsupported file "${entry.entryName}" inside supplier ZIP. Only PDF documents are supported.`
      );
    }

    const entryData = entry.getData();
    if (entryData.length > MAX_PDF_BYTES) {
      throw new IngestionError(`Decompressed entry "${entry.entryName}" exceeds 25 MB limit.`);
    }

    const docId = `SUP_${docs.length + 1}`;
    const ingested = await extractPdfPages(entryData, path.basename(normalized), 'supplier', docId);
    if (ingested.scannedPages.length > 0) {
      warnings.push(
        `${ingested.filename}: Page(s) ${ingested.scannedPages.join(', ')} contain little or no selectable text (OCR / manual review needed).`
      );
    }
    docs.push(ingested);
  }

  if (docs.length === 0) {
    throw new IngestionError('Supplier ZIP archive did not contain any PDF documents.');
  }

  return { docs, warnings };
}

export function buildEvidenceSnippets(docs: IngestedDocument[]): EvidenceSnippet[] {
  const snippets: EvidenceSnippet[] = [];
  for (const doc of docs) {
    for (const page of doc.pages) {
      snippets.push({
        docId: doc.docId,
        docName: doc.filename,
        docKind: doc.docKind,
        page: page.pageNumber,
        excerpt: page.needsOcr
          ? `[SCANNED / LOW-TEXT PAGE: ${page.charCount} chars extracted — requires OCR or manual review]`
          : page.text.slice(0, 1400),
      });
    }
  }
  return snippets;
}
