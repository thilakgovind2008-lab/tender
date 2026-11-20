import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileCheck2,
  FileUp,
  FileText,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MinusCircle,
  Plus,
  Send,
  Volume2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { LanguageCode } from '../App';
import { MonochromeSealStamp } from './BrandMarks';
import {
  ApiError,
  type IntegrationBoundaries,
  type SessionState,
  type ValidationStatus,
  dispatchAutomationApi,
  fetchReportPreviewApi,
  downloadReport,
  recordDecisionApi,
  sendChatMessageApi,
  speakVoiceApi,
  transcribeVoiceApi,
  uploadCorrectedPdfApi,
} from '../api/client';

export type WorkspaceTab = 'Chat' | 'Findings' | 'Rescue' | 'Report';

interface BidWorkspacePanelProps {
  open: boolean;
  session: SessionState | null;
  initialTab?: WorkspaceTab;
  language: LanguageCode;
  integrations?: IntegrationBoundaries;
  onClose: () => void;
  onSessionUpdate: (next: SessionState) => void;
  onStartNewAnalysis: () => void;
  onClearSession: () => void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as Record<string, unknown>;
  const ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  return typeof ctor === 'function' ? (ctor as new () => SpeechRecognitionInstance) : null;
}

type DisplayCategory = 'PASS' | 'BLOCKER' | 'REVIEW' | 'NA';

function getDisplayCategory(status: ValidationStatus): DisplayCategory {
  if (status === 'PASS') return 'PASS';
  if (status === 'REVIEW_REQUIRED') return 'REVIEW';
  if (status === 'NOT_APPLICABLE') return 'NA';
  return 'BLOCKER';
}

const CHIP_META: Record<
  DisplayCategory,
  {
    label: string;
    classes: string;
    Icon: typeof CheckCircle2;
  }
> = {
  PASS: {
    label: 'PASS',
    classes: 'bg-emerald-950/60 text-emerald-200 border-emerald-500/40',
    Icon: CheckCircle2,
  },
  BLOCKER: {
    label: 'BLOCKER',
    classes: 'bg-red-950/60 text-red-200 border-red-500/45',
    Icon: XCircle,
  },
  REVIEW: {
    label: 'REVIEW',
    classes: 'bg-amber-950/60 text-amber-200 border-amber-500/45',
    Icon: AlertCircle,
  },
  NA: {
    label: 'N/A',
    classes: 'bg-zinc-900 text-zinc-300 border-zinc-600/40',
    Icon: MinusCircle,
  },
};

const QUICK_PROMPTS: Record<LanguageCode, string[]> = {
  Eng: ['Can we still bid?', 'What should I fix first?', 'Explain R2', 'Generate my report'],
  Tam: [
    'நாம் இன்னும் ஏலம் போடலாமா?',
    'முதலில் எதை சரிசெய்ய வேண்டும்?',
    'R2 விளக்கு',
    'அறிக்கை உருவாக்கு',
  ],
  Hin: ['Can we still bid?', 'What should I fix first?', 'Explain R2', 'Generate my report'],
};

function shortRequirementLabel(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = clean.split(/[.!?](?:\s|$)/)[0] || clean;
  if (sentence.length <= 76) return sentence;
  return `${sentence.slice(0, 73).trim()}…`;
}

function firstSentence(text: string | undefined): string {
  if (!text) return 'Needs verification against tender terms.';
  const clean = text.replace(/\s+/g, ' ').trim();
  const first = clean.split(/[.!?](?:\s|$)/)[0] || clean;
  if (first.length <= 125) return `${first}.`.replace(/\.\.$/, '.');
  return `${first.slice(0, 122).trim()}…`;
}

export function BidWorkspacePanel({
  open,
  session,
  initialTab = 'Findings',
  language,
  integrations,
  onClose,
  onSessionUpdate,
  onStartNewAnalysis,
  onClearSession,
}: BidWorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [expandedReqIds, setExpandedReqIds] = useState<Record<string, boolean>>({});
  const [messageInput, setMessageInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const [uploadingCorrection, setUploadingCorrection] = useState(false);
  const [correctionStatus, setCorrectionStatus] = useState('');
  const [correctionTargetReq, setCorrectionTargetReq] = useState('');
  const [decisionNoteByReq, setDecisionNoteByReq] = useState<Record<string, string>>({});
  const [decisionBusyReq, setDecisionBusyReq] = useState<string | null>(null);
  const [decisionFeedbackMsg, setDecisionFeedbackMsg] = useState('');
  const [reportHtml, setReportHtml] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [speakingTurnId, setSpeakingTurnId] = useState<string | null>(null);
  const [n8nEmail, setN8nEmail] = useState('');
  const [n8nAuthorized, setN8nAuthorized] = useState(false);
  const [dispatchingN8n, setDispatchingN8n] = useState(false);
  const [n8nStatusMsg, setN8nStatusMsg] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const correctionFileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (activeTab === 'Chat' && open) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session?.chatHistory.length, activeTab, open]);

  useEffect(() => {
    if (!open || activeTab !== 'Report' || !session) return;
    let cancelled = false;
    setReportLoading(true);
    fetchReportPreviewApi(session.sessionId)
      .then((res) => {
        if (!cancelled) setReportHtml(res.html);
      })
      .catch(() => {
        if (!cancelled) setReportHtml('');
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, session?.sessionId, session?.revision]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!open || !session) return null;

  const hardBlockersCount = session.validation.filter(
    (v) => v.status !== 'PASS' && v.status !== 'NOT_APPLICABLE' && v.status !== 'REVIEW_REQUIRED'
  ).length;
  const reviewCount = session.validation.filter((v) => v.status === 'REVIEW_REQUIRED').length;
  const totalUnresolved = hardBlockersCount + reviewCount;

  const statusParts: string[] = [];
  if (hardBlockersCount > 0) {
    statusParts.push(`${hardBlockersCount} ${hardBlockersCount === 1 ? 'blocker' : 'blockers'}`);
  }
  if (reviewCount > 0) {
    statusParts.push(`${reviewCount} needs review`);
  }
  const overallStatusText = statusParts.length > 0 ? statusParts.join(', ') : 'Ready to review';

  const daysLeftDisplay = session.deadline.timeRemainingText.replace(/\s*remaining$/i, ' left');

  const nonSampleWarnings = session.warnings.filter(
    (w) => !w.toUpperCase().startsWith('SAMPLE MODE ACTIVE')
  );

  const toggleExpandReq = (reqId: string) => {
    setExpandedReqIds((prev) => ({ ...prev, [reqId]: !prev[reqId] }));
  };

  const handleSendChat = async (textToSend?: string) => {
    const clean = (textToSend ?? messageInput).trim();
    if (!clean || sendingChat) return;
    setChatError('');
    setSendingChat(true);
    if (!textToSend) setMessageInput('');

    try {
      const res = await sendChatMessageApi({
        sessionId: session.sessionId,
        message: clean,
        language,
        revision: session.revision,
      });
      onSessionUpdate(res.session);
      if (res.exportReady) {
        setActiveTab('Report');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setChatError('Session changed. Please send again.');
      } else {
        setChatError(err instanceof Error ? err.message : 'Could not send message.');
      }
      if (!textToSend) setMessageInput(clean);
    } finally {
      setSendingChat(false);
    }
  };

  const handleCorrectedUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setCorrectionStatus('Only .pdf files can be checked.');
      return;
    }
    setUploadingCorrection(true);
    setCorrectionStatus('');
    try {
      const res = await uploadCorrectedPdfApi({
        sessionId: session.sessionId,
        correctedPdf: file,
        targetRequirementId: correctionTargetReq || undefined,
        revision: session.revision,
      });
      onSessionUpdate(res.session);
      setCorrectionStatus(
        res.affectedRequirements.length > 0
          ? `Updated from "${file.name}".`
          : `Checked "${file.name}". Select a requirement if needed.`
      );
      if (correctionFileRef.current) correctionFileRef.current.value = '';
    } catch (err) {
      setCorrectionStatus(err instanceof Error ? err.message : 'PDF upload failed.');
    } finally {
      setUploadingCorrection(false);
    }
  };

  const handleDecision = async (
    requirementId: string,
    action: 'agree' | 'dispute' | 'approve'
  ) => {
    setDecisionBusyReq(requirementId);
    setDecisionFeedbackMsg('');
    try {
      const note = (decisionNoteByReq[requirementId] || '').trim();
      const res = await recordDecisionApi({
        sessionId: session.sessionId,
        requirementId,
        action,
        note: note || `${action} recorded`,
        language,
        revision: session.revision,
      });
      onSessionUpdate(res.session);
      setDecisionFeedbackMsg(
        res.message || `Saved ${action} note. Status stays unchanged until evidence changes.`
      );
      setDecisionNoteByReq((prev) => ({ ...prev, [requirementId]: '' }));
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : '';
      if (action === 'approve' && (/cannot approve/i.test(rawMsg) || (err instanceof ApiError && err.status === 422))) {
        setDecisionFeedbackMsg("Can't approve. No supporting evidence for this item.");
      } else {
        setDecisionFeedbackMsg(rawMsg || 'Could not record decision.');
      }
    } finally {
      setDecisionBusyReq(null);
    }
  };

  const toggleVoiceInput = async () => {
    if (listening) {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
        setVoiceNote('Transcribing voice…');
      }
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (integrations?.sarvamVoice.connected && navigator.mediaDevices && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined,
        });
        voiceChunksRef.current = [];
        mediaStreamRef.current = stream;
        recorder.ondataavailable = (event) => {
          if (event.data.size) voiceChunksRef.current.push(event.data);
        };
        recorder.onstop = async () => {
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          try {
            const transcript = await transcribeVoiceApi(
              new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
            );
            setMessageInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
            setVoiceNote('Transcript ready.');
          } catch (err) {
            setVoiceNote(err instanceof Error ? err.message : 'Voice transcription failed.');
          }
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setListening(true);
        setVoiceNote('Listening… tap again to stop.');
        return;
      } catch {
        setVoiceNote('Microphone blocked. Type your question below.');
        return;
      }
    }
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) {
      setVoiceNote('Voice dictation is unavailable here. Type your question below.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = language === 'Tam' ? 'ta-IN' : language === 'Hin' ? 'hi-IN' : 'en-IN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript?.trim() || '';
        if (transcript) {
          setMessageInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
          setVoiceNote('Transcript added.');
        }
      };
      rec.onerror = () => {
        setListening(false);
        setVoiceNote('Microphone unavailable. Type your question below.');
      };
      rec.onend = () => {
        setListening(false);
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
      setVoiceNote('Listening…');
    } catch {
      setListening(false);
      setVoiceNote('Could not start voice input.');
    }
  };

  const handleSpeakTurn = async (turnId: string, text: string) => {
    if (speakingTurnId === turnId) {
      audioRef.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setSpeakingTurnId(null);
      return;
    }

    const clipped = text.trim().slice(0, 2400);
    if (!clipped) return;
    setSpeakingTurnId(turnId);

    if (integrations?.sarvamVoice.connected) {
      try {
        const res = await speakVoiceApi(clipped, language === 'Tam' ? 'ta-IN' : 'en-IN');
        const audio = new Audio(`data:${res.mime_type};base64,${res.audio_base64}`);
        audioRef.current = audio;
        audio.onended = () => setSpeakingTurnId(null);
        audio.onerror = () => setSpeakingTurnId(null);
        await audio.play();
        return;
      } catch (err) {
        setVoiceNote(err instanceof Error ? err.message : 'Voice playback unavailable.');
        setSpeakingTurnId(null);
        return;
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clipped);
      utter.lang = language === 'Tam' ? 'ta-IN' : language === 'Hin' ? 'hi-IN' : 'en-IN';
      utter.onend = () => setSpeakingTurnId(null);
      utter.onerror = () => setSpeakingTurnId(null);
      window.speechSynthesis.speak(utter);
      return;
    }

    setSpeakingTurnId(null);
    setVoiceNote('Voice playback not supported.');
  };

  const handleDispatchN8n = async () => {
    if (!n8nAuthorized || dispatchingN8n) return;
    setDispatchingN8n(true);
    setN8nStatusMsg('');
    try {
      const res = await dispatchAutomationApi({
        sessionId: session.sessionId,
        confirmDispatch: true,
        recipientEmail: n8nEmail.trim() || undefined,
      });
      onSessionUpdate(res.session);
      setN8nStatusMsg(res.message);
      setN8nAuthorized(false);
    } catch (err) {
      setN8nStatusMsg(err instanceof Error ? err.message : 'Could not send reminder.');
    } finally {
      setDispatchingN8n(false);
    }
  };

  const handleDownloadReport = () => {
    setReportError('');
    void downloadReport(session.sessionId).catch((error: Error) => setReportError(error.message));
  };

  const triggerCorrectedUploadPicker = () => {
    correctionFileRef.current?.click();
  };

  const firstRescueItem = session.plan[0];

  return (
    <div
      className="tk-workspace fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6 bg-black/80 backdrop-blur-md overflow-x-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Namma Tender Workspace"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-[960px] mx-auto h-[100svh] sm:h-[90svh] sm:max-h-[860px] sm:rounded-2xl bg-[#111019] border-0 sm:border sm:border-white/12 text-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden shared file input for Rescue & Chat PDF correction recheck */}
        <input
          ref={correctionFileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="sr-only"
          disabled={uploadingCorrection}
          onChange={(e) => handleCorrectedUpload(e.target.files?.[0])}
        />

        {/* Workspace Header: Company Name, Deadline + Days Left, One Overall Status */}
        <header className="px-4 py-4 sm:px-6 sm:py-6 border-b border-white/10 bg-[#151320]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                  {session.profile.companyName}
                </h2>
                {session.mode === 'SAMPLE' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/35 text-[12px] font-medium text-amber-200 whitespace-nowrap">
                    Sample data
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium">
                <span className="inline-flex items-center gap-1.5 text-zinc-300">
                  <Clock className="h-4 w-4 text-[#E0A458] shrink-0" />
                  <span>
                    Deadline {session.deadline.confirmedDate} · {daysLeftDisplay}
                  </span>
                </span>

                <span
                  className={`font-semibold ${
                    totalUnresolved > 0 ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  {overallStatusText}
                </span>

                {(session.profile.tenderReference || session.sessionId) && (
                  <span className="text-[12px] font-normal text-zinc-400 font-mono">
                    {session.profile.tenderReference || session.sessionId}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onStartNewAnalysis}
                className="min-h-[44px] px-4 rounded-full border border-white/20 text-[13px] font-medium text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="h-4 w-4 text-[#E0A458]" />
                <span className="hidden sm:inline">New check</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close workspace"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Primary Navigation Tabs: 2x2 grid on narrow mobile, single row on >=640px, never truncated */}
          <nav
            className="mt-4 grid grid-cols-2 sm:inline-flex gap-2 w-full sm:w-auto"
            role="tablist"
            aria-label="Workspace views"
          >
            {(
              [
                { id: 'Findings', label: 'Findings', Icon: FileCheck2 },
                { id: 'Rescue', label: 'Rescue', Icon: Wrench },
                { id: 'Chat', label: 'Chat', Icon: MessageSquare },
                { id: 'Report', label: 'Report', Icon: FileText },
              ] as const
            ).map(({ id, label, Icon }) => {
              const isSelected = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(id)}
                  className={`min-h-[44px] px-4 rounded-xl text-[13px] font-medium transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap border ${
                    isSelected
                      ? 'bg-white/14 border-white/25 text-white font-semibold'
                      : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 text-[#E0A458] shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </header>

        {/* Main Scrollable Content Area (centered max-w-960px, strict 8/16/24 rhythm) */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          {/* FINDINGS VIEW */}
          {activeTab === 'Findings' && (
            <div className="space-y-4">
              {decisionFeedbackMsg && (
                <div
                  role="status"
                  className="rounded-xl bg-amber-950/50 border border-amber-400/40 p-4 text-[15px] text-amber-100"
                >
                  {decisionFeedbackMsg}
                </div>
              )}

              {/* Desktop / Tablet Top Action Header (only one primary button in view) */}
              <div className="hidden sm:flex items-center justify-between gap-4 pb-2">
                <p className="text-[13px] font-medium text-zinc-400">
                  Select any item to view document proof or record a review note.
                </p>
                {totalUnresolved > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab('Rescue')}
                    className="min-h-[44px] px-6 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] text-[#1A1206] text-[15px] font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    Open Rescue Plan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTab('Report')}
                    className="min-h-[44px] px-6 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] text-[#1A1206] text-[15px] font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    View Report
                  </button>
                )}
              </div>

              {session.requirements.map((req) => {
                const finding = session.validation.find((v) => v.requirementId === req.id);
                const match = session.matches.find((m) => m.requirementId === req.id);
                const rawStatus = finding?.status ?? 'REVIEW_REQUIRED';
                const cat = getDisplayCategory(rawStatus);
                const chip = CHIP_META[cat];
                const ChipIcon = chip.Icon;
                const isExpanded = Boolean(expandedReqIds[req.id]);
                const busy = decisionBusyReq === req.id;
                const rescueForReq = session.plan.find((p) => p.requirementId === req.id);
                const reasonLine =
                  language === 'Tam' && finding?.explanationTa
                    ? firstSentence(finding.explanationTa)
                    : firstSentence(finding?.explanation);

                return (
                  <article
                    key={req.id}
                    className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden"
                  >
                    {/* Accordion Summary Row */}
                    <button
                      type="button"
                      onClick={() => toggleExpandReq(req.id)}
                      aria-expanded={isExpanded}
                      className="w-full min-h-[44px] p-4 sm:p-6 text-left flex items-start justify-between gap-4 hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium whitespace-nowrap ${chip.classes}`}
                          >
                            <ChipIcon className="h-3.5 w-3.5 shrink-0" />
                            <span>{chip.label}</span>
                          </span>
                          <span className="text-[12px] text-zinc-400">
                            p.{req.sourcePage} · {req.id}
                          </span>
                        </div>

                        <h3 className="text-[15px] font-medium text-white leading-[1.5]">
                          {shortRequirementLabel(req.officialWording)}
                        </h3>

                        <p className="text-[15px] text-zinc-300 leading-[1.5]">{reasonLine}</p>
                      </div>

                      <ChevronDown
                        className={`h-5 w-5 text-zinc-400 shrink-0 mt-1 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {/* Expanded Details: Supplier Evidence & Recommended Action */}
                    {isExpanded && (
                      <div className="px-4 pb-4 sm:px-6 sm:pb-6 pt-4 border-t border-white/10 space-y-4 bg-black/20">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="rounded-xl bg-white/[0.03] border border-white/8 p-4 space-y-2">
                            <p className="text-[13px] font-medium text-zinc-400">
                              Supplier evidence
                            </p>
                            {match && match.docId ? (
                              <p className="text-[15px] text-zinc-200 leading-[1.5]">
                                <span className="font-medium text-white">
                                  {match.docName} (p.{match.page})
                                </span>{' '}
                                — “{match.verbatimQuote}”
                              </p>
                            ) : (
                              <p className="text-[15px] text-zinc-400 leading-[1.5]">
                                No matching supplier document found.
                              </p>
                            )}
                          </div>

                          <div className="rounded-xl bg-white/[0.03] border border-white/8 p-4 space-y-2">
                            <p className="text-[13px] font-medium text-zinc-400">
                              Recommended action
                            </p>
                            <p className="text-[15px] text-zinc-200 leading-[1.5]">
                              {rescueForReq
                                ? language === 'Tam'
                                  ? rescueForReq.whatToFixTa
                                  : rescueForReq.whatToFix
                                : cat === 'PASS'
                                  ? 'No action needed. Verified against tender requirement.'
                                  : `Upload valid proof for: ${req.requiredEvidence}.`}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-xl bg-white/[0.02] border border-white/8 p-4 space-y-1">
                          <p className="text-[13px] font-medium text-zinc-400">
                            Tender source ({req.sourceDocName}, p.{req.sourcePage})
                          </p>
                          <p className="text-[14px] text-zinc-300 leading-[1.5]">
                            “{req.verbatimQuote}”
                          </p>
                        </div>

                        {/* Secondary Outlined Review Controls (never primary filled here) */}
                        <div className="pt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={decisionNoteByReq[req.id] || ''}
                            onChange={(e) =>
                              setDecisionNoteByReq((prev) => ({
                                ...prev,
                                [req.id]: e.target.value,
                              }))
                            }
                            placeholder="Add review note..."
                            className="flex-1 min-w-[200px] min-h-[44px] rounded-xl bg-white/[0.06] border border-white/14 px-4 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E0A458]"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDecision(req.id, 'agree')}
                            className="min-h-[44px] px-4 rounded-full border border-white/20 text-[13px] font-medium text-zinc-200 hover:bg-white/10 cursor-pointer disabled:opacity-50"
                          >
                            Agree
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDecision(req.id, 'dispute')}
                            className="min-h-[44px] px-4 rounded-full border border-white/20 text-[13px] font-medium text-zinc-200 hover:bg-white/10 cursor-pointer disabled:opacity-50"
                          >
                            Dispute
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDecision(req.id, 'approve')}
                            className="min-h-[44px] px-4 rounded-full border border-white/20 text-[13px] font-medium text-zinc-200 hover:bg-white/10 cursor-pointer disabled:opacity-50"
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* RESCUE VIEW */}
          {activeTab === 'Rescue' && (
            <div className="space-y-4">
              {/* Upload Corrected PDF Bar (Single Primary CTA on Rescue view) */}
              <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-[16px] font-bold text-white">Fix blockers before deadline</h3>
                    <p className="text-[13px] text-zinc-400">
                      Upload a corrected PDF to recheck and update affected findings.
                    </p>
                  </div>

                  <div className="hidden sm:flex items-center gap-3">
                    {session.mode === 'SAMPLE' && (
                      <a
                        href="/api/sample/corrected-iso.pdf"
                        download="Sample_Renewed_ISO_9001.pdf"
                        className="min-h-[44px] px-3 inline-flex items-center text-[13px] font-medium text-[#E0A458] underline hover:text-[#EBB46B]"
                      >
                        Sample ISO PDF
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={uploadingCorrection}
                      onClick={triggerCorrectedUploadPicker}
                      className="min-h-[44px] px-6 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] disabled:opacity-60 text-[#1A1206] text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer"
                    >
                      {uploadingCorrection ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileUp className="h-4 w-4" />
                      )}
                      <span>{uploadingCorrection ? 'Rechecking...' : 'Upload corrected PDF'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="tk-rescue-target" className="text-[13px] font-medium text-zinc-400">
                    Target item:
                  </label>
                  <select
                    id="tk-rescue-target"
                    value={correctionTargetReq}
                    onChange={(e) => setCorrectionTargetReq(e.target.value)}
                    className="min-h-[44px] rounded-xl bg-[#18151f] border border-white/15 px-3 text-[13px] text-white focus:outline-none focus:border-[#E0A458]"
                  >
                    <option value="">Auto-detect by PDF content</option>
                    {session.requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.requirementType}
                      </option>
                    ))}
                  </select>

                  {session.mode === 'SAMPLE' && (
                    <a
                      href="/api/sample/corrected-iso.pdf"
                      download="Sample_Renewed_ISO_9001.pdf"
                      className="sm:hidden min-h-[44px] inline-flex items-center text-[13px] font-medium text-[#E0A458] underline"
                    >
                      Download sample renewed ISO PDF
                    </a>
                  )}
                </div>

                {correctionStatus && (
                  <p role="status" className="text-[14px] text-emerald-300">
                    {correctionStatus}
                  </p>
                )}
              </div>

              {session.plan.length === 0 ? (
                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 text-[15px] text-emerald-200">
                  All blockers are cleared. Review your report before portal submission.
                </div>
              ) : (
                session.plan.map((item) => {
                  const fixText = language === 'Tam' ? item.whatToFixTa : item.whatToFix;
                  const timeLeftClean = item.timeRemaining.replace(/\s*remaining$/i, ' left');
                  const leadTimeLabel =
                    item.feasibility === 'unknown' ? 'Time unknown' : 'Can prepare now';

                  return (
                    <article
                      key={item.requirementId}
                      className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[13px] font-bold text-white">
                            {item.priority}
                          </span>
                          <span className="text-[12px] font-mono text-zinc-400">
                            {item.requirementId}
                          </span>
                        </div>
                        <span className="text-[13px] font-medium text-zinc-300">
                          {timeLeftClean} · {leadTimeLabel}
                        </span>
                      </div>

                      <h3 className="text-[15px] font-medium text-white leading-[1.5]">
                        {fixText}
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[13px]">
                        <p className="text-zinc-400">
                          <span className="font-medium text-zinc-300">Owner:</span>{' '}
                          {item.suggestedOwner}
                        </p>
                        <p className="text-zinc-400">
                          <span className="font-medium text-zinc-300">Evidence needed:</span>{' '}
                          {item.requiredEvidence}
                        </p>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {/* CHAT VIEW */}
          {activeTab === 'Chat' && (
            <div className="flex flex-col h-full min-h-[420px] space-y-4">
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {session.chatHistory.map((turn) => (
                  <div
                    key={turn.id}
                    className={`rounded-2xl p-4 sm:p-6 text-[15px] leading-[1.5] border ${
                      turn.role === 'user'
                        ? 'ml-auto max-w-[85%] bg-[#E0A458]/14 border-[#E0A458]/35 text-white'
                        : 'mr-auto max-w-[92%] bg-white/[0.04] border-white/10 text-zinc-100'
                    }`}
                  >
                    <div className="whitespace-pre-line">{turn.text}</div>

                    {turn.role === 'assistant' && (
                      <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {turn.citedRequirements &&
                            turn.citedRequirements.map((reqId) => (
                              <button
                                key={reqId}
                                type="button"
                                onClick={() => setActiveTab('Findings')}
                                className="min-h-[36px] px-3 rounded-full border border-white/15 text-[12px] font-mono text-zinc-300 hover:bg-white/10 cursor-pointer"
                              >
                                {reqId}
                              </button>
                            ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleSpeakTurn(turn.id, turn.text)}
                          aria-label={speakingTurnId === turn.id ? 'Stop voice' : 'Listen to reply'}
                          className="min-h-[44px] px-3 rounded-full border border-white/15 inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-200 hover:bg-white/10 cursor-pointer"
                        >
                          <Volume2 className="h-4 w-4 text-[#E0A458]" />
                          <span>
                            {speakingTurnId === turn.id
                              ? 'Stop'
                              : language === 'Tam'
                                ? 'கேள்'
                                : 'Listen'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Quick Prompts */}
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS[language].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sendingChat}
                    onClick={() => handleSendChat(prompt)}
                    className="min-h-[44px] px-4 rounded-full border border-white/15 bg-white/[0.03] text-[13px] font-medium text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {chatError && (
                <p className="text-[14px] text-red-300" role="alert">
                  {chatError}
                </p>
              )}
              {voiceNote && <p className="text-[13px] text-zinc-400">{voiceNote}</p>}

              {/* Composer (Single Primary Button: Send) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                className="flex items-center gap-2 pt-1"
              >
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  title="Voice question"
                  aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                  className={`h-11 w-11 shrink-0 rounded-full border inline-flex items-center justify-center transition-colors cursor-pointer ${
                    listening
                      ? 'bg-red-600/80 border-red-300 text-white'
                      : 'bg-white/[0.04] border-white/15 text-zinc-200 hover:bg-white/10'
                  }`}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={
                    language === 'Tam'
                      ? 'தமிழ் அல்லது ஆங்கிலத்தில் கேளுங்கள்...'
                      : 'Ask a question about your bid...'
                  }
                  className="flex-1 min-w-0 min-h-[44px] rounded-full bg-white/[0.06] border border-white/15 px-4 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E0A458]"
                />
                <button
                  type="submit"
                  disabled={sendingChat || !messageInput.trim()}
                  className="min-h-[44px] px-5 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] disabled:opacity-50 text-[#1A1206] text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer shrink-0"
                >
                  {sendingChat ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span>Send</span>
                </button>
              </form>
            </div>
          )}

          {/* REPORT VIEW */}
          {activeTab === 'Report' && (
            <div className="space-y-4">
              {/* Shortened Report Card: Title, One Line, One Primary Button, One Secondary Button */}
              <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-[16px] font-bold text-white">Bid Readiness Report</h3>
                  <p className="text-[15px] text-zinc-300">
                    Includes all requirements, sources, and unresolved items.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <MonochromeSealStamp className="hidden sm:block h-11 w-11 shrink-0 rounded-full" />
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    className="min-h-[44px] px-6 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] text-[#1A1206] text-[15px] font-semibold inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download report</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClearSession}
                    className="min-h-[44px] px-5 rounded-full border border-white/20 text-[13px] font-medium text-zinc-200 hover:bg-white/10 cursor-pointer"
                  >
                    Clear session
                  </button>
                </div>
              </div>

              {reportError && (
                <div
                  className="rounded-xl bg-red-950/50 border border-red-400/35 p-4 text-[14px] text-red-200"
                  role="alert"
                >
                  {reportError}
                </div>
              )}

              {/* Shortened Voice Status Card: One line only */}
              {integrations && (
                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6">
                  <p className="text-[15px] font-medium text-white">
                    {integrations.sarvamVoice.connected
                      ? 'Voice: connected'
                      : 'Voice: not set up'}
                  </p>
                </div>
              )}

              {/* Optional n8n Reminder Card when connected */}
              {integrations?.n8nAutomation.connected && (
                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 space-y-4">
                  <p className="text-[15px] font-medium text-white">Compliance reminder</p>
                  <input
                    type="email"
                    value={n8nEmail}
                    onChange={(e) => setN8nEmail(e.target.value)}
                    placeholder="Recipient email (optional)"
                    className="w-full min-h-[44px] rounded-xl bg-white/[0.06] border border-white/15 px-4 text-[15px] text-white placeholder:text-zinc-500"
                  />
                  <label className="flex items-center gap-3 text-[13px] text-zinc-300 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={n8nAuthorized}
                      onChange={(e) => setN8nAuthorized(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span>Send this reminder summary via n8n.</span>
                  </label>
                  <button
                    type="button"
                    disabled={!n8nAuthorized || dispatchingN8n}
                    onClick={handleDispatchN8n}
                    className="min-h-[44px] px-5 rounded-full border border-white/25 text-[13px] font-medium text-white hover:bg-white/10 disabled:opacity-50 cursor-pointer"
                  >
                    {dispatchingN8n ? 'Sending...' : 'Send reminder'}
                  </button>
                  {n8nStatusMsg && <p className="text-[13px] text-amber-200">{n8nStatusMsg}</p>}
                </div>
              )}

              {/* Warnings (excluding duplicate sample note) & Audit */}
              {nonSampleWarnings.length > 0 && (
                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 space-y-2">
                  <h4 className="text-[13px] font-medium text-zinc-400">Coverage notes</h4>
                  <ul className="list-disc pl-5 space-y-1 text-[14px] text-zinc-300">
                    {nonSampleWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sandboxed HTML Report Preview */}
              <div className="rounded-2xl border border-white/12 overflow-hidden bg-white">
                {reportLoading ? (
                  <div className="p-6 text-[14px] text-slate-700 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading report preview...</span>
                  </div>
                ) : reportHtml ? (
                  <iframe
                    title="Namma Tender Bid Readiness Report Preview"
                    srcDoc={reportHtml}
                    sandbox=""
                    className="w-full h-[360px] border-0"
                  />
                ) : null}
              </div>

              {/* Disclaimer ONCE at bottom of Report View */}
              <p className="pt-2 text-[13px] text-zinc-400 leading-[1.5]">
                Checks supplied documents for gaps and expiry risks only. Does not guarantee bid
                acceptance or legal eligibility. Unverified lead times appear as Time unknown.
              </p>
            </div>
          )}
        </div>

        {/* Sticky Mobile Bottom Action Bar (Main next action only) */}
        {activeTab !== 'Chat' && (
          <div className="sm:hidden sticky bottom-0 px-4 py-3 border-t border-white/10 bg-[#151320]">
            {activeTab === 'Findings' && (
              <button
                type="button"
                onClick={() => setActiveTab(totalUnresolved > 0 ? 'Rescue' : 'Report')}
                className="w-full min-h-[44px] rounded-full bg-[#E0A458] text-[#1A1206] text-[15px] font-semibold cursor-pointer"
              >
                {firstRescueItem
                  ? `Fix ${firstRescueItem.requirementId} in Rescue`
                  : totalUnresolved > 0
                    ? 'Open Rescue Plan'
                    : 'View Report'}
              </button>
            )}

            {activeTab === 'Rescue' && (
              <button
                type="button"
                disabled={uploadingCorrection}
                onClick={triggerCorrectedUploadPicker}
                className="w-full min-h-[44px] rounded-full bg-[#E0A458] disabled:opacity-60 text-[#1A1206] text-[15px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {uploadingCorrection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                <span>{uploadingCorrection ? 'Rechecking...' : 'Upload corrected PDF'}</span>
              </button>
            )}

            {activeTab === 'Report' && (
              <button
                type="button"
                onClick={handleDownloadReport}
                className="w-full min-h-[44px] rounded-full bg-[#E0A458] text-[#1A1206] text-[15px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>Download report</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
