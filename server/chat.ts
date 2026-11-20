import { evaluateChatGuardrail, MAX_CHAT_MESSAGE_CHARS, normalizeUntrustedUnicode } from './guardrails.ts';
import { selectChatToolWithGemini } from './llm.ts';
import { generateId } from './sessionStore.ts';
import { executeGroundedTool } from './tools.ts';
import type { ChatLanguage, SessionState } from './types.ts';

function deterministicToolFallback(message: string): {
  tool: string;
  decision?: 'approved_after_review' | 'acknowledged_blocker' | 'disputed';
} {
  const lower = message.toLowerCase();
  if (/\b(report|export|download|summary\s+html)\b/.test(lower)) {
    return { tool: 'export_report' };
  }
  if (/\b(disagree|dispute|wrong|incorrect|not\s+right|mistake)\b/.test(lower)) {
    return { tool: 'record_feedback', decision: 'disputed' };
  }
  if (/\b(recheck|re-run|rerun|verify\s+again)\b/.test(lower)) {
    return { tool: 'rerun_requirement' };
  }
  if (/\b(approve|acknowledge|accept\s+finding)\b/.test(lower)) {
    return { tool: 'record_decision', decision: 'approved_after_review' };
  }
  if (/\b(fix\s+first|rescue|priority|action\s+plan|what\s+next|next\s+step)\b/.test(lower)) {
    return { tool: 'get_rescue_plan' };
  }
  if (/\b(explain|clause|why|detail|r\d+)\b/.test(lower) && !/\b(blocking|can\s+we|missing|expired)\b/.test(lower)) {
    return { tool: 'explain_requirement' };
  }
  return { tool: 'list_blockers' };
}

export async function handleSessionChatTurn(params: {
  session: SessionState;
  message: string;
  language: ChatLanguage;
}): Promise<{
  reply: string;
  toolUsed: string;
  progressSteps: string[];
  citedRequirements: string[];
  exportReady?: boolean;
  guardrailBlocked?: boolean;
}> {
  const { session, message, language } = params;
  const trimmed = normalizeUntrustedUnicode(message).trim().slice(0, MAX_CHAT_MESSAGE_CHARS + 50);
  const userTurnId = generateId('msg');
  const nowIso = new Date().toISOString();

  session.chatHistory.push({
    id: userTurnId,
    role: 'user',
    text: trimmed.slice(0, 500),
    timestamp: nowIso,
  });

  // Pre-LLM Guardrail: block prompt injection, system prompt extraction, jailbreaks, script payloads
  const guardrail = evaluateChatGuardrail(trimmed, session, language);
  if (guardrail.blocked) {
    const refusalReply =
      guardrail.reply ||
      'Refused by Sentinel Guardrail: prompt injection or bypass instructions cannot run.';
    session.chatHistory.push({
      id: generateId('msg'),
      role: 'assistant',
      text: refusalReply,
      timestamp: new Date().toISOString(),
      toolUsed: 'sentinel_prompt_guard',
      progressSteps: ['Sentinel Prompt Guard checked input integrity'],
      citedRequirements: guardrail.citedRequirements,
    });
    return {
      reply: refusalReply,
      toolUsed: 'sentinel_prompt_guard',
      progressSteps: ['Sentinel Prompt Guard checked input integrity'],
      citedRequirements: guardrail.citedRequirements,
      guardrailBlocked: true,
    };
  }

  // Always check deterministic fallback + allow Gemini tool selection when available
  const fallback = deterministicToolFallback(trimmed);
  let selectedTool = fallback.tool;
  let selectedReqId: string | undefined;
  let selectedDecision = fallback.decision;
  let selectedNote: string | undefined;

  if (session.provider.extractionMode === 'live' && process.env.GEMINI_API_KEY) {
    try {
      const llmPick = await selectChatToolWithGemini(trimmed, session, language);
      selectedTool = llmPick.tool;
      selectedReqId = llmPick.requirementId;
      selectedDecision = llmPick.decision ?? selectedDecision;
      selectedNote = llmPick.note;
    } catch {
      // Safe deterministic routing fallback if Gemini times out or is unavailable during chat
    }
  }

  const result = executeGroundedTool({
    session,
    tool: selectedTool,
    userMessage: trimmed,
    language,
    requirementId: selectedReqId,
    decision: selectedDecision,
    note: selectedNote,
  });

  session.chatHistory.push({
    id: generateId('msg'),
    role: 'assistant',
    text: result.reply,
    timestamp: new Date().toISOString(),
    toolUsed: result.tool,
    progressSteps: result.progressSteps,
    citedRequirements: result.citedRequirements,
  });

  return {
    reply: result.reply,
    toolUsed: result.tool,
    progressSteps: result.progressSteps,
    citedRequirements: result.citedRequirements,
    exportReady: result.exportReady,
  };
}
