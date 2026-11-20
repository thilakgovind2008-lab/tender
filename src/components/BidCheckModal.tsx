import React, { useEffect, useState } from 'react';
import {
  X,
  FileUp,
  AlertCircle,
  Loader2,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import type { LanguageCode } from '../App';
import {
  analyzeLiveBidApi,
  createSampleSessionApi,
  type SessionState,
} from '../api/client';

interface BidCheckModalProps {
  open: boolean;
  initialMode?: 'Upload' | 'Chat' | 'Report';
  language?: LanguageCode;
  onClose: () => void;
  onSessionCreated: (session: SessionState) => void;
}

import { isSupabaseConfigured, supabase } from '../lib/supabase';

const TN_DISTRICTS = [
  'Chennai',
  'Coimbatore',
  'Madurai',
  'Tiruchirappalli',
  'Salem',
  'Tiruppur',
  'Krishnagiri',
  'Erode',
  'Tirunelveli',
  'Vellore',
  'Thoothukudi',
  'Thanjavur',
  'Kancheepuram',
  'Chengalpattu',
  'Ariyalur',
  'Cuddalore',
  'Dharmapuri',
  'Dindigul',
  'Kallakurichi',
  'Kanniyakumari',
  'Karur',
  'Mayiladuthurai',
  'Nagapattinam',
  'Namakkal',
  'Nilgiris',
  'Perambalur',
  'Pudukkottai',
  'Ramanathapuram',
  'Ranipet',
  'Sivaganga',
  'Tenkasi',
  'Theni',
  'Tirupathur',
  'Tiruvallur',
  'Tiruvannamalai',
  'Tiruvarur',
  'Viluppuram',
  'Virudhunagar',
];

const SECTORS = [
  'Manufacturing & Engineering',
  'Civil & Infrastructure Works',
  'Electrical, Solar & MEP',
  'Medical & Laboratory Equipment',
  'Goods & Institutional Supplies',
  'IT & Technical Services',
];

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const COPY: Record<
  LanguageCode,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    liveTab: string;
    sampleTab: string;
    companyLabel: string;
    companyPlaceholder: string;
    districtLabel: string;
    sectorLabel: string;
    deadlineLabel: string;
    tenderRefLabel: string;
    tenderRefPlaceholder: string;
    tenderPdfLabel: string;
    supplierZipLabel: string;
    corrigendumLabel: string;
    formatHint: string;
    submitBtn: string;
    runningBtn: string;
    sampleBtn: string;
    sampleLoadingBtn: string;
    sampleBadge: string;
    sampleDesc: string;
    closeAria: string;
  }
> = {
  Eng: {
    eyebrow: 'Namma Tender · Bid Rescue Intake',
    title: 'Check Your Bid Readiness',
    subtitle:
      'Upload your Tender PDF and Supplier ZIP for live Gemini requirement extraction and Sentinel verification, or explore Sample Mode.',
    liveTab: 'Live Tender Upload',
    sampleTab: 'Sample Mode (Demo)',
    companyLabel: 'Company Name',
    companyPlaceholder: 'Sri Murugan Precision Works Pvt Ltd',
    districtLabel: 'District (Tamil Nadu)',
    sectorLabel: 'Sector',
    deadlineLabel: 'Confirmed Bid Deadline',
    tenderRefLabel: 'Tender Reference (optional)',
    tenderRefPlaceholder: 'GCC/SWD/2026-0418',
    tenderPdfLabel: 'Tender PDF',
    supplierZipLabel: 'Supplier Documents ZIP',
    corrigendumLabel: 'Corrigendum PDF (optional)',
    formatHint: 'Supported: PDF up to 25 MB, ZIP archive up to 50 MB (PDFs inside ZIP only).',
    submitBtn: 'Analyze Tender & Start Bid Rescue',
    runningBtn: 'Reading tender pages & checking evidence...',
    sampleBtn: 'Open Sample Mode Workspace',
    sampleLoadingBtn: 'Preparing fictional Sample Mode...',
    sampleBadge: 'SAMPLE MODE · FICTIONAL DATA',
    sampleDesc:
      'Loads fictional Tamil Nadu MSME "Kaveri Precision Fabricators Pvt Ltd" against TNSIDC/2026/MECH-019 with pre-built PASS, EXPIRED ISO, MISSING EMD Declaration, and partial Technical cases.',
    closeAria: 'Close bid check dialog',
  },
  Tam: {
    eyebrow: 'Namma Tender · ஏலத் தயாரிப்புப் படிவம்',
    title: 'உங்கள் ஏலத் தயார்நிலையை சரிபார்க்கவும்',
    subtitle:
      'நேரடி Gemini பகுப்பாய்வுக்கு டெண்டர் PDF மற்றும் சப்ளையர் ZIP-ஐப் பதிவேற்றவும், அல்லது மாதிரிப் பயன்முறையை (Sample Mode) முயற்சிக்கவும்.',
    liveTab: 'நேரடி பதிவேற்றம்',
    sampleTab: 'மாதிரிப் பயன்முறை (Demo)',
    companyLabel: 'நிறுவனத்தின் பெயர்',
    companyPlaceholder: 'ஸ்ரீ முருகன் பிரசிஷன் ஒர்க்ஸ்',
    districtLabel: 'மாவட்டம் (தமிழ்நாடு)',
    sectorLabel: 'துறை',
    deadlineLabel: 'உறுதிசெய்யப்பட்ட இறுதித் தேதி',
    tenderRefLabel: 'டெண்டர் எண் (விருப்பம்)',
    tenderRefPlaceholder: 'GCC/SWD/2026-0418',
    tenderPdfLabel: 'டெண்டர் PDF',
    supplierZipLabel: 'சப்ளையர் ஆவணங்கள் ZIP',
    corrigendumLabel: 'திருத்தக் குறிப்பு PDF (விருப்பம்)',
    formatHint: 'ஆதரவு: 25 MB வரை PDF, 50 MB வரை ZIP கோப்பு.',
    submitBtn: 'டெண்டரைப் பகுப்பாய்வு செய்',
    runningBtn: 'டெண்டர் பக்கங்கள் படிக்கப்படுகின்றன...',
    sampleBtn: 'மாதிரிப் பயன்முறையைத் திற',
    sampleLoadingBtn: 'மாதிரி அமர்வு உருவாக்கப்படுகிறது...',
    sampleBadge: 'மாதிரிப் பயன்முறை · கற்பனைத் தரவு',
    sampleDesc:
      'காவேரி பிரசிஷன் ஃபேப்ரிகேட்டர்ஸ் (கோயம்புத்தூர்) நிறுவனத்தின் மாதிரி டெண்டர் மற்றும் காலாவதியான ISO / விடுபட்ட EMD சோதனைகளைப் பார்க்கலாம்.',
    closeAria: 'ஏலச் சரிபார்ப்பு சாளரத்தை மூடு',
  },
  Hin: {
    eyebrow: 'Namma Tender · बिड जांच इनटेक',
    title: 'अपनी बिड तैयारी जांचें',
    subtitle:
      'लाइव विश्लेषण के लिए टेंडर PDF और सप्लायर ZIP अपलोड करें, या Sample Mode आज़माएँ।',
    liveTab: 'लाइव अपलोड',
    sampleTab: 'Sample Mode (Demo)',
    companyLabel: 'कंपनी का नाम',
    companyPlaceholder: 'श्री मुरुगन प्रिसिजन वर्क्स',
    districtLabel: 'जिला (तमिलनाडु)',
    sectorLabel: 'क्षेत्र',
    deadlineLabel: 'पुष्ट अंतिम तिथि',
    tenderRefLabel: 'टेंडर संदर्भ (वैकल्पिक)',
    tenderRefPlaceholder: 'GCC/SWD/2026-0418',
    tenderPdfLabel: 'टेंडर PDF',
    supplierZipLabel: 'सप्लायर दस्तावेज़ ZIP',
    corrigendumLabel: 'शुद्धिपत्र PDF (वैकल्पिक)',
    formatHint: 'समर्थित: PDF 25 MB तक, ZIP 50 MB तक।',
    submitBtn: 'टेंडर विश्लेषण शुरू करें',
    runningBtn: 'दस्तावेज़ और शर्तें जाँची जा रही हैं...',
    sampleBtn: 'Sample Mode खोलें',
    sampleLoadingBtn: 'Sample Mode लोड हो रहा है...',
    sampleBadge: 'SAMPLE MODE · काल्पनिक डेटा',
    sampleDesc:
      'यह काल्पनिक तमिलनाडु MSME उदाहरण के साथ Bid Rescue Engine की जाँच दिखाता है।',
    closeAria: 'बिड जांच संवाद बंद करें',
  },
};

export function BidCheckModal({
  open,
  initialMode = 'Upload',
  language = 'Eng',
  onClose,
  onSessionCreated,
}: BidCheckModalProps) {
  const [intakeMode, setIntakeMode] = useState<'LIVE' | 'SAMPLE'>('LIVE');
  const [companyName, setCompanyName] = useState('');
  const [district, setDistrict] = useState('Chennai');
  const [sector, setSector] = useState(SECTORS[0]);
  const [deadline, setDeadline] = useState('');
  const [tenderRef, setTenderRef] = useState('');
  const [tenderPdf, setTenderPdf] = useState<File | null>(null);
  const [supplierZip, setSupplierZip] = useState<File | null>(null);
  const [corrigendumPdf, setCorrigendumPdf] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const c = COPY[language];

  useEffect(() => {
    if (!open || !isSupabaseConfigured() || !supabase) {
      setNeedsSignIn(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setNeedsSignIn(!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, sess) => {
      setNeedsSignIn(!sess);
    });
    return () => sub.subscription.unsubscribe();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        setError('');
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const validateFile = (file: File | undefined, kind: 'pdf' | 'zip'): File | null => {
    if (!file) return null;
    const lower = file.name.toLowerCase();
    if (kind === 'pdf') {
      if (!lower.endsWith('.pdf')) {
        setError(`Unsupported file "${file.name}". Please select a .pdf document.`);
        return null;
      }
      if (file.size > MAX_PDF_BYTES) {
        setError(`"${file.name}" exceeds the 25 MB PDF limit.`);
        return null;
      }
    } else {
      if (!lower.endsWith('.zip')) {
        setError(`Unsupported archive "${file.name}". Please select a .zip package.`);
        return null;
      }
      if (file.size > MAX_ZIP_BYTES) {
        setError(`"${file.name}" exceeds the 50 MB ZIP limit.`);
        return null;
      }
    }
    setError('');
    return file;
  };

  const handleLiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setError('Please enter your company name.');
      return;
    }
    if (!deadline) {
      setError('Please enter the confirmed bid submission deadline.');
      return;
    }
    if (!tenderPdf) {
      setError('Please attach the Tender PDF to analyze.');
      return;
    }
    if (!supplierZip) {
      setError('Please attach your Supplier Documents ZIP package.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const res = await analyzeLiveBidApi({
        companyName: companyName.trim(),
        district,
        sector,
        deadline,
        tenderReference: tenderRef.trim() || undefined,
        tenderPdf,
        supplierZip,
        corrigendumPdf,
        idempotencyKey,
      });
      onSessionCreated(res.session);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Live tender analysis failed. Please check your files and retry.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStartSample = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await createSampleSessionApi();
      onSessionCreated(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Sample Mode session.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError('');
    onClose();
  };

  return (
    <div
      className="tk-workspace fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto overflow-x-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bid-modal-title"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-xl my-auto rounded-2xl bg-[#111019] border border-white/12 p-4 sm:p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          disabled={loading}
          aria-label={c.closeAria}
          className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="text-[12px] font-medium text-zinc-400">
          {c.eyebrow} · {initialMode}
        </p>
        <h2 id="bid-modal-title" className="mt-2 text-xl sm:text-2xl font-bold tracking-tight pr-12 text-white">
          {c.title}
        </h2>
        <p className="mt-2 text-[15px] leading-[1.5] text-zinc-300">{c.subtitle}</p>

        {/* Live vs Sample Switcher */}
        <div className="mt-6 grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/5 border border-white/10">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setIntakeMode('LIVE');
              setError('');
            }}
            className={`min-h-[44px] px-3 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              intakeMode === 'LIVE'
                ? 'bg-[#E0A458] text-[#1A1206] font-semibold'
                : 'text-zinc-300 hover:bg-white/8'
            }`}
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>{c.liveTab}</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setIntakeMode('SAMPLE');
              setError('');
            }}
            className={`min-h-[44px] px-3 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              intakeMode === 'SAMPLE'
                ? 'bg-[#E0A458] text-[#1A1206] font-semibold'
                : 'text-zinc-300 hover:bg-white/8'
            }`}
          >
            <FlaskConical className="h-4 w-4 shrink-0" />
            <span>{c.sampleTab}</span>
          </button>
        </div>

        {intakeMode === 'SAMPLE' ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-4 sm:p-6 space-y-2">
              <span className="inline-block px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/35 text-[12px] font-medium text-amber-200">
                Sample data
              </span>
              <p className="text-[15px] leading-[1.5] text-zinc-200">{c.sampleDesc}</p>
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-xl bg-red-950/60 border border-red-400/35 p-4 text-[14px] text-red-200"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-300 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={handleStartSample}
              className="w-full min-h-[44px] rounded-full bg-[#E0A458] hover:bg-[#EBB46B] disabled:opacity-65 text-[#1A1206] text-[15px] font-semibold transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{loading ? c.sampleLoadingBtn : c.sampleBtn}</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleLiveSubmit} className="mt-6 space-y-4" noValidate>
            {needsSignIn && (
              <div className="rounded-xl bg-amber-950/40 border border-amber-400/35 p-4 text-[13px] text-amber-100">
                Sign in from the top-right <strong>Sign in</strong> button to run Live Tender Upload, or switch to{' '}
                <strong>Sample Mode (Demo)</strong>.
              </div>
            )}
            <div>
              <label htmlFor="tk-company" className="block text-[13px] font-medium text-zinc-300 mb-2">
                {c.companyLabel}
              </label>
              <input
                id="tk-company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={c.companyPlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-white/8 border border-white/15 px-4 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E0A458]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="tk-district" className="block text-[13px] font-medium text-zinc-300 mb-2">
                  {c.districtLabel}
                </label>
                <select
                  id="tk-district"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-[#18151f] border border-white/15 px-3 text-[15px] text-white focus:outline-none focus:border-[#E0A458]"
                >
                  {TN_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tk-sector" className="block text-[13px] font-medium text-zinc-300 mb-2">
                  {c.sectorLabel}
                </label>
                <select
                  id="tk-sector"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-[#18151f] border border-white/15 px-3 text-[15px] text-white focus:outline-none focus:border-[#E0A458]"
                >
                  {SECTORS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="tk-deadline" className="block text-[13px] font-medium text-zinc-300 mb-2">
                  {c.deadlineLabel}
                </label>
                <input
                  id="tk-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-white/8 border border-white/15 px-3 text-[15px] text-white focus:outline-none focus:border-[#E0A458] [color-scheme:dark]"
                />
              </div>

              <div>
                <label htmlFor="tk-ref" className="block text-[13px] font-medium text-zinc-300 mb-2">
                  {c.tenderRefLabel}
                </label>
                <input
                  id="tk-ref"
                  type="text"
                  value={tenderRef}
                  onChange={(e) => setTenderRef(e.target.value)}
                  placeholder={c.tenderRefPlaceholder}
                  className="w-full min-h-[44px] rounded-xl bg-white/8 border border-white/15 px-4 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E0A458]"
                />
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label
                  htmlFor="tk-tender-pdf"
                  className="flex items-center justify-between w-full min-h-[44px] rounded-xl bg-white/6 border border-dashed border-white/22 px-4 text-[13px] font-medium text-zinc-200 hover:border-[#E0A458]/70 transition-colors cursor-pointer"
                >
                  <span className="truncate pr-2">
                    {tenderPdf ? `${c.tenderPdfLabel}: ${tenderPdf.name}` : `${c.tenderPdfLabel} (.pdf)`}
                  </span>
                  <FileUp className="h-4 w-4 shrink-0 text-[#E0A458]" />
                </label>
                <input
                  id="tk-tender-pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const f = validateFile(e.target.files?.[0], 'pdf');
                    if (f) setTenderPdf(f);
                  }}
                  className="sr-only"
                />
              </div>

              <div>
                <label
                  htmlFor="tk-supplier-zip"
                  className="flex items-center justify-between w-full min-h-[44px] rounded-xl bg-white/6 border border-dashed border-white/22 px-4 text-[13px] font-medium text-zinc-200 hover:border-[#E0A458]/70 transition-colors cursor-pointer"
                >
                  <span className="truncate pr-2">
                    {supplierZip
                      ? `${c.supplierZipLabel}: ${supplierZip.name}`
                      : `${c.supplierZipLabel} (.zip)`}
                  </span>
                  <FileUp className="h-4 w-4 shrink-0 text-[#E0A458]" />
                </label>
                <input
                  id="tk-supplier-zip"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const f = validateFile(e.target.files?.[0], 'zip');
                    if (f) setSupplierZip(f);
                  }}
                  className="sr-only"
                />
              </div>

              <div>
                <label
                  htmlFor="tk-corrigendum-pdf"
                  className="flex items-center justify-between w-full min-h-[44px] rounded-xl bg-white/4 border border-dashed border-white/16 px-4 text-[13px] font-medium text-zinc-300 hover:border-[#E0A458]/60 transition-colors cursor-pointer"
                >
                  <span className="truncate pr-2">
                    {corrigendumPdf
                      ? `${c.corrigendumLabel}: ${corrigendumPdf.name}`
                      : `${c.corrigendumLabel} (.pdf)`}
                  </span>
                  <FileUp className="h-4 w-4 shrink-0 text-[#E0A458]" />
                </label>
                <input
                  id="tk-corrigendum-pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const f = validateFile(e.target.files?.[0], 'pdf');
                    if (f) setCorrigendumPdf(f);
                  }}
                  className="sr-only"
                />
              </div>

              <p className="text-[12px] text-zinc-400">{c.formatHint}</p>
            </div>

            {error && (
              <div
                className="flex items-start gap-2 rounded-xl bg-red-950/60 border border-red-400/35 p-4 text-[14px] text-red-200"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-red-300 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] rounded-full bg-[#E0A458] hover:bg-[#EBB46B] disabled:opacity-65 text-[#1A1206] text-[15px] font-semibold transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{loading ? c.runningBtn : c.submitBtn}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
