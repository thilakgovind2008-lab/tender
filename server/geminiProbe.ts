import { GoogleGenAI, Type } from '@google/genai';
import { getActiveGeminiModel, sanitizeLlmError } from './llm.ts';
import { auditModelOutputText } from './guardrails.ts';
const PROBE_TIMEOUT_MS = 20_000;
interface ProbePayload {
  status: 'PASS' | 'FAIL' | 'REVIEW_REQUIRED';
  summary: string;
  verifiedCitation: boolean;
}

function validateProbePayload(obj: unknown): obj is ProbePayload {
  if (!obj || typeof obj !== 'object') return false;
  if (!('status' in obj && 'summary' in obj && 'verifiedCitation' in obj)) return false;
  const validStatus =
    obj.status === 'PASS' || obj.status === 'FAIL' || obj.status === 'REVIEW_REQUIRED';
  return (
    validStatus &&
    typeof obj.summary === 'string' &&
    obj.summary.trim().length > 0 &&
    typeof obj.verifiedCitation === 'boolean'
  );
}

export async function runGeminiStructuredProbe(modelName = getActiveGeminiModel()) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false as const,
      category: 'missing_key' as const,
      httpStatus: 503,
      model: modelName,
      latencyMs: 0,
      message: 'GEMINI_API_KEY is not configured in the server environment.',
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: modelName,
        contents:
          'Synthetic probe (no private documents): Requirement R0 states "Supplier must hold an active GST registration." ' +
          'Evidence E0 states "GSTIN registration status: Active." Classify status as PASS, FAIL, or REVIEW_REQUIRED with a 1-sentence summary.',
        config: {
          systemInstruction:
            'You are a strict tender-compliance JSON classifier. Return only valid JSON matching the requested schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING },
              summary: { type: Type.STRING },
              verifiedCitation: { type: Type.BOOLEAN },
            },
            required: ['status', 'summary', 'verifiedCitation'],
          },
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Probe timeout exceeded')),
          PROBE_TIMEOUT_MS
        );
      }),
    ]);

    const latencyMs = Date.now() - startedAt;
    const rawText = (response.text ?? '').trim();
    const parsed: unknown = JSON.parse(rawText);
    if (!validateProbePayload(parsed)) {
      return {
        ok: false as const,
        category: 'invalid_json_schema' as const,
        httpStatus: 502,
        model: modelName,
        latencyMs,
        message: 'Gemini JSON output failed strict schema validation.',
      };
    }

    return {
      ok: true as const,
      model: modelName,
      latencyMs,
      data: {
        ...parsed,
        summary: auditModelOutputText(parsed.summary).cleanText,
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const mapped = sanitizeLlmError(err);
    return {
      ok: false as const,
      category: mapped.category,
      httpStatus: mapped.httpStatus,
      model: modelName,
      latencyMs,
      message: mapped.message,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
