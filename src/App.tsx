import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconWorld } from '@tabler/icons-react';
import { X } from 'lucide-react';
import { BidCheckModal } from './components/BidCheckModal';
import { AuthButton } from './components/AuthButton';
import { BidWorkspacePanel, type WorkspaceTab } from './components/BidWorkspacePanel';
import {
  FullBrandLockupMark,
  PrimaryEmblemMark,
  TamilNaduLightningCloud,
} from './components/BrandMarks';
import {
  authenticatedFetch,
  checkServerHealth,
  fetchSessionApi,
  type IntegrationBoundaries,
  type SessionState,
} from './api/client';
import { createRiponForegroundMask } from './utils/maskRiponSky';
import riponPanoramaSrc from './assets/images/ripon_panorama_1795062769019.jpg';

const SESSION_STORAGE_KEY = 'tk_active_session_id';

const TOTAL_DURATION_MS = 7400;
const RAIN_LOOP_LIMIT_S = 3.6;
const RAIN_SWAP_TIME_S = RAIN_LOOP_LIMIT_S - 0.75; // 2.85s

const RIPON_IMAGE_SRC = riponPanoramaSrc;

const TILT_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063355_a600befc-45d6-4a32-9db6-9d6565a89609.mp4';
const RAIN_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063703_04e54df7-2236-4dff-b95b-a9a34c1f78ec.mp4';

const RAW_ASSETS = {
  doors:
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063048_97fd9a70-adbe-46bd-bfce-ec1004f6c7d8.png',
  aerial:
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063055_ee1debcd-d200-484f-b94f-fad6dcffd4eb.png',
  back:
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063251_24fbd7cc-00df-49ec-8fbf-d8a0349b1e98.png',
  front:
    'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261117_063151_7804d758-a2eb-4499-9b56-8f493edbb206.png',
};

function buildImageUrl(rawUrl: string, width: number) {
  return `https://images.higgs.ai/?default=1&output=webp&url=${encodeURIComponent(rawUrl)}&w=${width}&q=85`;
}

const NAV_ITEMS = ['How it works', 'Upload', 'Chat', 'Report'] as const;
type NavItem = (typeof NAV_ITEMS)[number];

const LANGUAGES = ['Eng', 'Tam', 'Hin'] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

const UI_TRANSLATIONS: Record<
  LanguageCode,
  {
    navLabels: Record<NavItem, string>;
    ctaButton: string;
    closeOverviewAria: string;
    panels: Record<
      Exclude<NavItem, 'How it works'>,
      { eyebrow: string; title: string; body: string; cta: string; mode: 'Upload' | 'Chat' | 'Report' }
    >;
  }
> = {
  Eng: {
    navLabels: {
      'How it works': 'How it works',
      Upload: 'Upload',
      Chat: 'Chat',
      Report: 'Report',
    },
    ctaButton: 'Check my bid',
    closeOverviewAria: 'Close section overview',
    panels: {
      Upload: {
        eyebrow: 'NIT & Bid Ingestion',
        title: 'Upload Tender Documents',
        body: 'Attach your Tender PDF, supplier document ZIP, and any corrigendum to check eligibility thresholds, deadlines, and missing evidence.',
        cta: 'Open Bid Intake',
        mode: 'Upload',
      },
      Chat: {
        eyebrow: 'Clause Intelligence',
        title: 'Interrogate Every Clause',
        body: 'Ask what is blocking your bid, which certificate expired, or review exact page citations in English or Tamil.',
        cta: 'Open Tender Q&A',
        mode: 'Chat',
      },
      Report: {
        eyebrow: 'Risk & Compliance Dossier',
        title: 'Disqualification Shield',
        body: 'Review unresolved gaps, rescue priorities, human decisions, and Sentinel verification findings before submission.',
        cta: 'Preview Intake & Status',
        mode: 'Report',
      },
    },
  },
  Tam: {
    navLabels: {
      'How it works': 'செயல்முறை',
      Upload: 'பதிவேற்று',
      Chat: 'உரையாடல்',
      Report: 'அறிக்கை',
    },
    ctaButton: 'ஏலத்தை சரிபார்',
    closeOverviewAria: 'பிரிவு சுருக்கத்தை மூடு',
    panels: {
      Upload: {
        eyebrow: 'ஒப்பந்த ஆவணப் பதிவேற்றம்',
        title: 'ஒப்பந்த ஆவணங்களைப் பதிவேற்றவும்',
        body: 'தகுதி விதிகள், காலக்கெடு மற்றும் விடுபட்ட சான்றுகளைச் சரிபார்க்க டெண்டர் PDF மற்றும் உங்கள் ஆவண ZIP கோப்பைச் சேர்க்கவும்.',
        cta: 'ஆவணப் படிவத்தைத் திற',
        mode: 'Upload',
      },
      Chat: {
        eyebrow: 'விதி விளக்கம்',
        title: 'ஒவ்வொரு விதியையும் கேளுங்கள்',
        body: 'ஏலத்தைத் தடுக்கும் குறைகள், காலாவதியான சான்றிதழ்கள் மற்றும் பக்க ஆதாரங்களை தமிழ் அல்லது ஆங்கிலத்தில் கேட்கலாம்.',
        cta: 'வினா-விடை திற',
        mode: 'Chat',
      },
      Report: {
        eyebrow: 'இடர் மற்றும் இணக்க அறிக்கை',
        title: 'தகுதிநீக்கப் பாதுகாப்பு',
        body: 'சமர்ப்பிக்கும் முன் தீர்க்கப்படாத குறைகள், முன்னுரிமை நடவடிக்கைகள் மற்றும் சரிபார்ப்பு முடிவுகளைப் பார்க்கவும்.',
        cta: 'சரிபார்ப்பு நிலை பார்',
        mode: 'Report',
      },
    },
  },
  Hin: {
    navLabels: {
      'How it works': 'कैसे काम करता है',
      Upload: 'अपलोड',
      Chat: 'चैट',
      Report: 'रिपोर्ट',
    },
    ctaButton: 'बिड जांचें',
    closeOverviewAria: 'अनुभाग विवरण बंद करें',
    panels: {
      Upload: {
        eyebrow: 'निविदा दस्तावेज़ अपलोड',
        title: 'टेंडर दस्तावेज़ अपलोड करें',
        body: 'पात्रता शर्तें, समय-सीमा और छूटे हुए प्रमाण जांचने के लिए टेंडर PDF और सप्लायर दस्तावेज़ ZIP जोड़ें।',
        cta: 'बिड इनटेक खोलें',
        mode: 'Upload',
      },
      Chat: {
        eyebrow: 'क्लॉज़ स्पष्टीकरण',
        title: 'हर शर्त पर सवाल पूछें',
        body: 'रुकावटें, समाप्त प्रमाणपत्र और सटीक पेज संदर्भ स्पष्ट रूप से समझें।',
        cta: 'टेंडर Q&A खोलें',
        mode: 'Chat',
      },
      Report: {
        eyebrow: 'अनुपालन और जोखिम रिपोर्ट',
        title: 'अयोग्यता सुरक्षा कवच',
        body: 'जमा करने से पहले लंबित कमियां, सुधार प्राथमिकताएं और सत्यापन निष्कर्ष देखें।',
        cta: 'स्थिति और इनटेक देखें',
        mode: 'Report',
      },
    },
  },
};

const LETTERS = 'Tender'.split('');

export default function App() {
  const heroRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const wordRef = useRef<HTMLHeadingElement>(null);
  const baselineProbeRef = useRef<HTMLSpanElement>(null);

  const doorLeftRef = useRef<HTMLDivElement>(null);
  const doorRightRef = useRef<HTMLDivElement>(null);
  const openingBoxRef = useRef<HTMLDivElement>(null);
  const aerialImgRef = useRef<HTMLImageElement>(null);
  const tiltVideoRef = useRef<HTMLVideoElement>(null);

  const backLayerRef = useRef<HTMLDivElement>(null);
  const backImgRef = useRef<HTMLImageElement>(null);
  const rainARef = useRef<HTMLVideoElement>(null);
  const rainBRef = useRef<HTMLVideoElement>(null);
  const topShadeRef = useRef<HTMLDivElement>(null);

  const headlineBlockRef = useRef<HTMLDivElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const midLayerRef = useRef<HTMLDivElement>(null);
  const midImgRef = useRef<HTMLImageElement>(null);
  const frontLayerRef = useRef<HTMLDivElement>(null);
  const frontImgRef = useRef<HTMLImageElement>(null);
  const sideMottoRef = useRef<HTMLParagraphElement>(null);

  const [riponMaskSrc, setRiponMaskSrc] = useState<string>('');
  const [maskReady, setMaskReady] = useState<boolean>(false);
  const maskPromiseRef = useRef<Promise<string> | null>(null);

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const [introActive, setIntroActive] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const [introFinished, setIntroFinished] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const [activeNav, setActiveNav] = useState<NavItem>('How it works');
  const [language, setLanguage] = useState<LanguageCode>('Eng');
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [bidModalOpen, setBidModalOpen] = useState(false);
  const [bidModalMode, setBidModalMode] = useState<'Upload' | 'Chat' | 'Report'>('Upload');
  const [activeSession, setActiveSession] = useState<SessionState | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('Chat');
  const [integrations, setIntegrations] = useState<IntegrationBoundaries | undefined>(undefined);

  useEffect(() => {
    checkServerHealth()
      .then((res) => setIntegrations(res.integrations))
      .catch(() => {});

    let savedId: string | null = null;
    try {
      savedId = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      savedId = null;
    }
    if (!savedId) return;

    fetchSessionApi(savedId)
      .then((session) => {
        setActiveSession(session);
      })
      .catch(() => {
        try {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // ignore storage error
        }
      });
  }, []);

  const handleSessionCreated = useCallback((session: SessionState) => {
    setActiveSession(session);
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, session.sessionId);
    } catch {
      // ignore storage error
    }
    setBidModalOpen(false);
    setActiveNav('Report');
    setWorkspaceTab('Findings');
    setWorkspaceOpen(true);
  }, []);

  const handleSessionUpdate = useCallback((next: SessionState) => {
    setActiveSession(next);
  }, []);

  const handleClearSession = useCallback(() => {
    const id = activeSession?.sessionId;
    if (id) {
      authenticatedFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setActiveSession(null);
    setWorkspaceOpen(false);
    setActiveNav('How it works');
  }, [activeSession?.sessionId]);

  const [layout, setLayout] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1440,
    vh: typeof window !== 'undefined' ? Math.max(window.innerHeight, 520) : 900,
    u: 1,
    stageWidth: 1600,
    stageHeight: 900,
    wordFontSize: 290,
    kickerFontSize: 34.2,
    wordTop: 150,
    kickerTop: 170,
    kickerShiftLeft: 12,
  }));

  // Compute optimal resizer width once on initial mount
  const assetUrls = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        doors: buildImageUrl(RAW_ASSETS.doors, 2000),
        aerial: buildImageUrl(RAW_ASSETS.aerial, 2000),
        back: buildImageUrl(RAW_ASSETS.back, 2000),
        front: buildImageUrl(RAW_ASSETS.front, 2000),
      };
    }
    const vw = window.innerWidth;
    const vh = Math.max(window.innerHeight, 520);
    const dpr = window.devicePixelRatio || 1;
    const stageW = Math.max(vw, (vh * 16) / 9);
    const scaleFactor = dpr > 1 ? 1.25 : 1;
    const roundUp100 = (n: number) => Math.min(2688, Math.max(800, Math.ceil(n / 100) * 100));

    const stageImgW = roundUp100(stageW * scaleFactor);
    const doorImgW = roundUp100(vw * scaleFactor);

    return {
      doors: buildImageUrl(RAW_ASSETS.doors, doorImgW),
      aerial: buildImageUrl(RAW_ASSETS.aerial, stageImgW),
      back: buildImageUrl(RAW_ASSETS.back, stageImgW),
      front: buildImageUrl(RAW_ASSETS.front, stageImgW),
    };
  }, []);

  // Mask out the pitch-black night sky of the Ripon Building panorama once on mount
  useEffect(() => {
    let cancelled = false;
    const p = createRiponForegroundMask(RIPON_IMAGE_SRC);
    maskPromiseRef.current = p;
    p.then((maskedUrl) => {
      if (!cancelled) {
        setRiponMaskSrc(maskedUrl);
        setMaskReady(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setRiponMaskSrc(RIPON_IMAGE_SRC);
        setMaskReady(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Measure and lay out stage, nav unit u, and headline geometry
  const computeLayout = useCallback(() => {
    const hero = heroRef.current;
    const vw = hero ? hero.clientWidth : window.innerWidth;
    const vh = hero ? hero.clientHeight : Math.max(window.innerHeight, 520);

    const isSmallWidth = vw < 820 && vh > 500;
    const isShortLandscape = vh <= 500;
    const u = !isSmallWidth && !isShortLandscape ? Math.min(vw / 1440, vh / 900) : 1;

    const stageWidth = Math.max(vw, (vh * 16) / 9);
    const stageHeight = (stageWidth * 9) / 16;
    const stageTop = (vh - stageHeight) / 2;

    // Measure "Tender" at 100px
    let widthPerEm = 3.22;
    if (measureRef.current) {
      const measured = measureRef.current.getBoundingClientRect().width;
      if (measured > 50) {
        widthPerEm = measured / 100;
      }
    }

    // Measure nav bottom in viewport coordinates without intro transform
    let navBottom = isShortLandscape ? 46 : isSmallWidth ? 104 : 100 * u;
    if (navRef.current) {
      const top = navRef.current.offsetTop;
      const height = navRef.current.offsetHeight;
      if (height > 0) {
        navBottom = top + height;
      }
    }

    const isPortrait = vh > 1.2 * vw;
    const baselinePct = isPortrait ? 0.362 : 0.43;
    const baselineYInStage = baselinePct * stageHeight;
    const baselineYInViewport = stageTop + baselineYInStage;

    const fontSizeA = (0.625 * stageWidth) / widthPerEm;
    const fontSizeB = (0.92 * vw) / widthPerEm;
    const gap = baselineYInViewport - (navBottom + 0.035 * vh);
    const fontSizeC = gap / 0.88;

    const wordFontSize = Math.max(24, Math.min(fontSizeA, fontSizeB, fontSizeC));
    const kickerFontSize = 0.118 * wordFontSize;
    const kickerTop = baselineYInStage - 0.727 * wordFontSize - 0.02 * wordFontSize;
    const kickerShiftLeft = 0.04 * wordFontSize;

    // Measure actual baseline offset inside <h1>
    let baselineOffset = 0.805 * wordFontSize;
    if (wordRef.current && baselineProbeRef.current) {
      const h1Rect = wordRef.current.getBoundingClientRect();
      const probeRect = baselineProbeRef.current.getBoundingClientRect();
      const measuredOffset = probeRect.top - h1Rect.top;
      if (measuredOffset > 0) {
        baselineOffset = measuredOffset;
      }
    }
    const wordTop = baselineYInStage - baselineOffset;

    setLayout({
      vw,
      vh,
      u,
      stageWidth,
      stageHeight,
      wordFontSize,
      kickerFontSize,
      wordTop,
      kickerTop,
      kickerShiftLeft,
    });
  }, []);

  useLayoutEffect(() => {
    computeLayout();
  }, [computeLayout]);

  useEffect(() => {
    let rafId = 0;
    const scheduleCompute = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => computeLayout());
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleCompute) : null;
    if (ro && heroRef.current) {
      ro.observe(heroRef.current);
    }
    window.addEventListener('resize', scheduleCompute);

    let active = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (active) scheduleCompute();
      });
    }

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', scheduleCompute);
    };
  }, [computeLayout]);

  useLayoutEffect(() => {
    if (!wordRef.current || !baselineProbeRef.current) return;
    const h1Rect = wordRef.current.getBoundingClientRect();
    const probeRect = baselineProbeRef.current.getBoundingClientRect();
    const measuredOffset = probeRect.top - h1Rect.top;
    if (measuredOffset <= 0) return;

    const isPortrait = layout.vh > 1.2 * layout.vw;
    const baselineYInStage = (isPortrait ? 0.362 : 0.43) * layout.stageHeight;
    const exactTop = baselineYInStage - measuredOffset;
    if (Math.abs(exactTop - layout.wordTop) > 0.4) {
      setLayout((prev) => ({ ...prev, wordTop: exactTop }));
    }
  }, [layout.wordFontSize, layout.stageHeight, layout.vw, layout.vh, layout.wordTop]);

  // Rain loop state
  const rainStartedRef = useRef(false);
  const activeRainIdxRef = useRef<0 | 1>(0);
  const rainSwapLockedRef = useRef(false);
  const rainPauseTimerRef = useRef<number | null>(null);
  const rainUnlockTimerRef = useRef<number | null>(null);

  const startRain = useCallback(() => {
    if (rainStartedRef.current || reducedMotion) return;
    rainStartedRef.current = true;
    activeRainIdxRef.current = 0;
    rainSwapLockedRef.current = false;

    const rainA = rainARef.current;
    const rainB = rainBRef.current;
    if (rainB) {
      rainB.style.opacity = '0';
      rainB.pause();
    }
    if (rainA) {
      rainA.currentTime = 0;
      rainA.style.opacity = '1';
      rainA.play().catch(() => {});
    }
  }, [reducedMotion]);

  const handleRainTimeUpdate = useCallback(
    (idx: 0 | 1) => {
      if (reducedMotion || !rainStartedRef.current) return;
      if (idx !== activeRainIdxRef.current || rainSwapLockedRef.current) return;

      const curVid = idx === 0 ? rainARef.current : rainBRef.current;
      const nextIdx: 0 | 1 = idx === 0 ? 1 : 0;
      const nextVid = nextIdx === 0 ? rainARef.current : rainBRef.current;
      if (!curVid || !nextVid) return;

      if (curVid.currentTime >= RAIN_SWAP_TIME_S) {
        rainSwapLockedRef.current = true;

        nextVid.currentTime = 0;
        nextVid.play().catch(() => {});
        nextVid.style.opacity = '1';
        curVid.style.opacity = '0';

        activeRainIdxRef.current = nextIdx;

        if (rainPauseTimerRef.current !== null) {
          window.clearTimeout(rainPauseTimerRef.current);
        }
        rainPauseTimerRef.current = window.setTimeout(() => {
          curVid.pause();
        }, 800);

        if (rainUnlockTimerRef.current !== null) {
          window.clearTimeout(rainUnlockTimerRef.current);
        }
        rainUnlockTimerRef.current = window.setTimeout(() => {
          rainSwapLockedRef.current = false;
        }, 500);
      }
    },
    [reducedMotion]
  );

  // Reduced-motion listener
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
      if (e.matches) {
        setIntroActive(false);
        setIntroFinished(true);
        rainARef.current?.pause();
        rainBRef.current?.pause();
        tiltVideoRef.current?.pause();
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Master 7.4s intro clock + readiness gate
  useEffect(() => {
    if (reducedMotion) {
      setIntroActive(false);
      setIntroFinished(true);
      return;
    }

    let cancelled = false;
    let started = false;
    let delayTimer: number | null = null;
    let failsafeTimer: number | null = null;
    let rafId = 0;
    const animations: Animation[] = [];

    const readyState = {
      doors: false,
      aerial: false,
      back: false,
      mid: false,
      front: false,
      tilt: false,
    };

    const startClock = () => {
      if (cancelled || started) return;
      started = true;
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (failsafeTimer !== null) window.clearTimeout(failsafeTimer);

      const createAnim = (el: Element | null, keyframes: Keyframe[]) => {
        if (!el || typeof el.animate !== 'function') return;
        const anim = el.animate(keyframes, {
          duration: TOTAL_DURATION_MS,
          fill: 'both',
        });
        anim.pause();
        anim.currentTime = 0;
        animations.push(anim);
      };

      const o = (ms: number) => ms / TOTAL_DURATION_MS;

      // Doors
      createAnim(doorLeftRef.current, [
        { offset: 0, transform: 'translateX(0%)' },
        { offset: o(20), transform: 'translateX(0%)', easing: 'cubic-bezier(0.1, 0.2, 0.8, 1)' },
        { offset: o(1130), transform: 'translateX(-101%)' },
        { offset: 1, transform: 'translateX(-101%)' },
      ]);

      createAnim(doorRightRef.current, [
        { offset: 0, transform: 'translateX(0%)' },
        { offset: o(20), transform: 'translateX(0%)', easing: 'cubic-bezier(0.4, 0.6, 0.9, 1)' },
        { offset: o(1240), transform: 'translateX(101%)' },
        { offset: 1, transform: 'translateX(101%)' },
      ]);

      // Tilt video opacity
      createAnim(tiltVideoRef.current, [
        { offset: 0, opacity: 0 },
        { offset: o(1190), opacity: 0, easing: 'ease-in-out' },
        { offset: o(1470), opacity: 1 },
        { offset: 1, opacity: 1 },
      ]);

      // Opening box fade out
      createAnim(openingBoxRef.current, [
        { offset: 0, opacity: 1 },
        { offset: o(2450), opacity: 1, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
        { offset: o(2950), opacity: 0 },
        { offset: 1, opacity: 0 },
      ]);

      // Nav fade & slide
      createAnim(navRef.current, [
        { offset: 0, opacity: 0, transform: 'translateY(-6px)' },
        { offset: o(2450), opacity: 0, transform: 'translateY(-6px)', easing: 'ease-out' },
        { offset: o(2750), opacity: 1, transform: 'translateY(0px)' },
        { offset: 1, opacity: 1, transform: 'translateY(0px)' },
      ]);

      // Side motto fade in after balcony opens
      createAnim(sideMottoRef.current, [
        { offset: 0, opacity: 0, transform: 'translateY(6px)' },
        { offset: o(4200), opacity: 0, transform: 'translateY(6px)', easing: 'ease-out' },
        { offset: o(5400), opacity: 1, transform: 'translateY(0px)' },
        { offset: 1, opacity: 1, transform: 'translateY(0px)' },
      ]);

      // Kicker
      createAnim(kickerRef.current, [
        { offset: 0, opacity: 0, transform: 'translateY(0.5em)' },
        {
          offset: o(2450),
          opacity: 0,
          transform: 'translateY(0.5em)',
          easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)',
        },
        { offset: o(3100), opacity: 1, transform: 'translateY(0em)' },
        { offset: 1, opacity: 1, transform: 'translateY(0em)' },
      ]);

      // Letters T, e, n, d, e, r
      LETTERS.forEach((_, idx) => {
        const startMs = 2450 + idx * 54;
        const endMs = startMs + 700;
        createAnim(letterRefs.current[idx], [
          { offset: 0, opacity: 0, transform: 'translateY(0.14em)' },
          {
            offset: o(startMs),
            opacity: 0,
            transform: 'translateY(0.14em)',
            easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)',
          },
          { offset: o(endMs), opacity: 1, transform: 'translateY(0em)' },
          { offset: 1, opacity: 1, transform: 'translateY(0em)' },
        ]);
      });

      // Top shade
      createAnim(topShadeRef.current, [
        { offset: 0, opacity: 0 },
        { offset: o(2900), opacity: 0, easing: 'ease-in-out' },
        { offset: o(3700), opacity: 1 },
        { offset: 1, opacity: 1 },
      ]);

      // Back layer parallax
      createAnim(backLayerRef.current, [
        { offset: 0, transform: 'translateY(0%)' },
        {
          offset: o(2900),
          transform: 'translateY(0%)',
          easing: 'cubic-bezier(0.45, 0, 0.35, 1)',
        },
        { offset: o(4300), transform: 'translateY(-1.5%)' },
        { offset: 1, transform: 'translateY(-1.5%)' },
      ]);

      // Mid layer (Chennai Ripon Building) parallax: rise over word's feet, hold, settle
      createAnim(midLayerRef.current, [
        { offset: 0, transform: 'translateY(0%)' },
        {
          offset: o(2900),
          transform: 'translateY(0%)',
          easing: 'cubic-bezier(0.45, 0, 0.3, 1)',
        },
        { offset: o(4300), transform: 'translateY(-4%)' },
        {
          offset: o(4600),
          transform: 'translateY(-4%)',
          easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
        },
        { offset: o(6900), transform: 'translateY(0%)' },
        { offset: 1, transform: 'translateY(0%)' },
      ]);

      // Headline block upward drift
      createAnim(headlineBlockRef.current, [
        { offset: 0, transform: 'translateY(6%)' },
        {
          offset: o(3000),
          transform: 'translateY(6%)',
          easing: 'cubic-bezier(0.3, 0, 0.4, 1)',
        },
        { offset: o(4800), transform: 'translateY(0%)' },
        { offset: 1, transform: 'translateY(0%)' },
      ]);

      // Front layer (man in long dark coat + glass railing) rise & settle
      createAnim(frontLayerRef.current, [
        { offset: 0, transform: 'translateY(66%)' },
        {
          offset: o(3350),
          transform: 'translateY(66%)',
          easing: 'cubic-bezier(0.2, 0.5, 0.2, 1)',
        },
        {
          offset: o(6000),
          transform: 'translateY(-2.5%)',
          easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
        },
        { offset: o(7300), transform: 'translateY(0%)' },
        { offset: 1, transform: 'translateY(0%)' },
      ]);

      const t0 = performance.now();
      let tiltStarted = false;
      let tiltEnded = false;

      const tick = (now: number) => {
        if (cancelled) return;
        const elapsed = Math.min(TOTAL_DURATION_MS, Math.max(0, now - t0));

        for (let i = 0; i < animations.length; i++) {
          animations[i].currentTime = elapsed;
        }

        // Tilt video playback window: 1.25s -> 2.85s
        const tilt = tiltVideoRef.current;
        if (tilt) {
          const clipLen =
            Number.isFinite(tilt.duration) && tilt.duration > 0 ? tilt.duration : 5.04;
          const baseRate = clipLen / 1.6;
          if (elapsed >= 1250 && elapsed < 2850) {
            const targetTime = ((elapsed - 1250) / 1600) * clipLen;
            if (!tiltStarted) {
              tiltStarted = true;
              try {
                tilt.currentTime = Math.max(0, Math.min(clipLen, targetTime));
              } catch {
                // ignore seek before ready
              }
              tilt.playbackRate = baseRate;
              tilt.play().catch(() => {});
            } else {
              const error = targetTime - tilt.currentTime;
              if (Math.abs(error) > 0.45) {
                try {
                  tilt.currentTime = Math.max(0, Math.min(clipLen, targetTime));
                } catch {
                  // ignore seek error
                }
              }
              const nudged = baseRate + error * 2.5;
              tilt.playbackRate = Math.max(0.85 * baseRate, Math.min(1.2 * baseRate, nudged));
            }
          } else if (elapsed >= 2850 && !tiltEnded) {
            tiltEnded = true;
            tilt.pause();
            try {
              tilt.currentTime = Math.max(0, clipLen - 0.01);
            } catch {
              // ignore seek error
            }
          }
        }

        // Start rain at 2.40s
        if (elapsed >= 2400 && !rainStartedRef.current) {
          startRain();
        }

        if (elapsed < TOTAL_DURATION_MS) {
          rafId = requestAnimationFrame(tick);
        } else {
          setIntroActive(false);
          setIntroFinished(true);
        }
      };

      rafId = requestAnimationFrame(tick);
    };

    const checkAllReady = () => {
      if (cancelled || started) return;
      if (
        readyState.doors &&
        readyState.aerial &&
        readyState.back &&
        readyState.mid &&
        readyState.front &&
        readyState.tilt
      ) {
        if (delayTimer === null) {
          delayTimer = window.setTimeout(startClock, 120);
        }
      }
    };

    const markReady = (key: keyof typeof readyState) => {
      if (readyState[key]) return;
      readyState[key] = true;
      checkAllReady();
    };

    // 1. Preload door image
    const doorPreload = new Image();
    doorPreload.onload = () => markReady('doors');
    doorPreload.onerror = () => markReady('doors');
    doorPreload.src = assetUrls.doors;
    if (doorPreload.complete) markReady('doors');

    // 2. Wire stage & opening images
    const bindImage = (el: HTMLImageElement | null, key: keyof typeof readyState) => {
      if (!el) return () => {};
      if (el.complete && el.naturalWidth > 0) {
        markReady(key);
        return () => {};
      }
      const onDone = () => markReady(key);
      el.addEventListener('load', onDone, { once: true });
      el.addEventListener('error', onDone, { once: true });
      return () => {
        el.removeEventListener('load', onDone);
        el.removeEventListener('error', onDone);
      };
    };

    const cleanAerial = bindImage(aerialImgRef.current, 'aerial');
    const cleanBack = bindImage(backImgRef.current, 'back');
    const cleanFront = bindImage(frontImgRef.current, 'front');

    // Mid image readiness waits for the fast sky mask (~35ms) + decode without restarting the clock
    let midFallbackTimer: number | null = null;
    if (maskPromiseRef.current) {
      maskPromiseRef.current
        .then((url) => {
          if (cancelled) return;
          const preload = new Image();
          preload.onload = () => markReady('mid');
          preload.onerror = () => markReady('mid');
          preload.src = url;
          if (preload.complete) markReady('mid');
        })
        .catch(() => markReady('mid'));
    } else if (midImgRef.current?.complete && midImgRef.current.naturalWidth > 0) {
      markReady('mid');
    }
    midFallbackTimer = window.setTimeout(() => markReady('mid'), 1200);

    // 3. Tilt video readiness (use canplay + short grace timer so 11MB MP4 never stalls closed doors)
    const tiltEl = tiltVideoRef.current;
    const onTiltReady = () => markReady('tilt');
    let tiltGraceTimer: number | null = null;
    if (tiltEl) {
      if (tiltEl.readyState >= 3) {
        markReady('tilt');
      } else {
        tiltEl.addEventListener('canplay', onTiltReady, { once: true });
        tiltEl.addEventListener('canplaythrough', onTiltReady, { once: true });
        tiltEl.load();
        tiltGraceTimer = window.setTimeout(() => markReady('tilt'), 1200);
      }
    } else {
      markReady('tilt');
    }

    // Also kick off rain video preloading cleanly
    rainARef.current?.load();
    rainBRef.current?.load();

    // 4. 3.0s outer failsafe
    failsafeTimer = window.setTimeout(startClock, 3000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (delayTimer !== null) window.clearTimeout(delayTimer);
      if (failsafeTimer !== null) window.clearTimeout(failsafeTimer);
      if (midFallbackTimer !== null) window.clearTimeout(midFallbackTimer);
      if (tiltGraceTimer !== null) window.clearTimeout(tiltGraceTimer);
      if (rainPauseTimerRef.current !== null) window.clearTimeout(rainPauseTimerRef.current);
      if (rainUnlockTimerRef.current !== null) window.clearTimeout(rainUnlockTimerRef.current);
      cleanAerial();
      cleanBack();
      cleanFront();
      tiltEl?.removeEventListener('canplay', onTiltReady);
      tiltEl?.removeEventListener('canplaythrough', onTiltReady);
      animations.forEach((a) => a.cancel());
    };
  }, [assetUrls, reducedMotion, startRain]);

  const handleWordmarkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setActiveNav('How it works');
    setLangMenuOpen(false);
    setBidModalOpen(false);
    setWorkspaceOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLangMenuOpen(false);
        if (!bidModalOpen && !workspaceOpen && activeNav !== 'How it works') {
          setActiveNav('How it works');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bidModalOpen, workspaceOpen, activeNav]);

  const t = UI_TRANSLATIONS[language];
  const activeInfoCard = activeNav !== 'How it works' ? t.panels[activeNav] : null;

  return (
    <main
      ref={heroRef}
      className={`hero${introActive ? ' intro' : ''}`}
      style={{ '--u': `${layout.u}px` } as React.CSSProperties}
    >
      {/* Hidden 100px width measurement probe for "Tender" */}
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          visibility: 'hidden',
          pointerEvents: 'none',
          fontFamily: '"Inter", sans-serif',
          fontWeight: 700,
          fontSize: '100px',
          letterSpacing: '-0.045em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        Tender
      </span>

      {/* Stage: 16:9 box centred both ways covering the hero */}
      <div
        className="stage"
        style={{
          width: `${layout.stageWidth}px`,
          height: `${layout.stageHeight}px`,
        }}
      >
        {/* 1. Back layer: storm sky image + two rain videos + top shade */}
        <div ref={backLayerRef} className="stage-layer stage-layer-back">
          <img
            ref={backImgRef}
            src={assetUrls.back}
            alt="Storm sky and misty mountain ridges above dark harbour water"
            className="stage-media"
            draggable={false}
          />
          {!reducedMotion && (
            <>
              <video
                ref={rainARef}
                src={RAIN_VIDEO_URL}
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                aria-hidden="true"
                className="stage-media rain-video"
                onTimeUpdate={() => handleRainTimeUpdate(0)}
              />
              <video
                ref={rainBRef}
                src={RAIN_VIDEO_URL}
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                aria-hidden="true"
                className="stage-media rain-video"
                onTimeUpdate={() => handleRainTimeUpdate(1)}
              />
            </>
          )}
          <div className="tn-lightning-cloud" aria-hidden="true">
            <TamilNaduLightningCloud className="tn-lightning-cloud-svg" />
          </div>
          <div ref={topShadeRef} className="top-shade" />
        </div>

        {/* 2. Headline block: spans viewport width, horizontally centred on viewport */}
        <div
          className="headline-viewport-wrap"
          style={{
            width: `${layout.vw}px`,
            marginLeft: `${-layout.vw / 2}px`,
          }}
        >
          <div ref={headlineBlockRef} className="headline-block">
            <div
              className="headline-kicker-anchor"
              style={{
                top: `${layout.kickerTop}px`,
                transform: `translateX(calc(-50% - ${layout.kickerShiftLeft}px))`,
              }}
            >
              <p
                ref={kickerRef}
                aria-hidden="true"
                className="headline-kicker"
                style={{ fontSize: `${layout.kickerFontSize}px` }}
              >
                Claim Your
              </p>
            </div>

            <h1
              ref={wordRef}
              className="headline-word"
              aria-label="Claim Your Tender"
              style={{
                top: `${layout.wordTop}px`,
                fontSize: `${layout.wordFontSize}px`,
              }}
            >
              {LETTERS.map((letter, idx) => (
                <span
                  key={idx}
                  ref={(el) => {
                    letterRefs.current[idx] = el;
                  }}
                  aria-hidden="true"
                  className="headline-letter"
                >
                  {letter}
                </span>
              ))}
              <span
                ref={baselineProbeRef}
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 0,
                  height: 0,
                  verticalAlign: 'baseline',
                }}
              />
            </h1>
          </div>
        </div>

        {/* 3. Mid layer: Chennai Ripon Building embedded organically behind the man on the balcony */}
        <div ref={midLayerRef} className="stage-layer stage-layer-mid">
          <div className="ripon-mid-frame">
            <div className="ripon-mid-img-wrap">
              {riponMaskSrc ? (
                <img
                  ref={midImgRef}
                  src={riponMaskSrc}
                  alt="Illuminated Chennai Ripon Building in frontal panoramic view"
                  className="ripon-mid-img"
                  style={maskReady ? undefined : { mixBlendMode: 'lighten' }}
                  draggable={false}
                />
              ) : null}
            </div>
            <div className="ripon-mist-veil" aria-hidden="true" />
          </div>
        </div>

        {/* 4. Front layer: original glass tint panel + balcony & man standing in dark coat */}
        <div ref={frontLayerRef} className="stage-layer stage-layer-front">
          <div className="glass-tint" aria-hidden="true" />
          <img
            ref={frontImgRef}
            src={assetUrls.front}
            alt="Man in long dark coat standing on glass penthouse balcony overlooking the Ripon Building"
            className="stage-media"
            draggable={false}
          />
          <div className="coat-brand-overlay" aria-hidden="true">
            <PrimaryEmblemMark className="coat-emblem" />
          </div>
        </div>
      </div>

      <p ref={sideMottoRef} className="side-motto" aria-hidden="true">
        “Make your papers speak clearly.”
      </p>

      {/* Opening layer: original aerial still + tilt video */}
      <div
        ref={openingBoxRef}
        className={`opening-box${introFinished ? ' is-hidden' : ''}`}
        style={{
          width: `${layout.stageWidth}px`,
          height: `${layout.stageHeight}px`,
        }}
        aria-hidden="true"
      >
        <img
          ref={aerialImgRef}
          src={assetUrls.aerial}
          alt=""
          className="stage-media"
          draggable={false}
        />
        {!reducedMotion && (
          <video
            ref={tiltVideoRef}
            src={TILT_VIDEO_URL}
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
            className="stage-media opening-tilt-video"
          />
        )}
      </div>

      {/* Doors layer: original two 50% black lacquer panels splitting from the centre seam */}
      <div className={`doors-box${introFinished ? ' is-hidden' : ''}`} aria-hidden="true">
        <div
          ref={doorLeftRef}
          className="door-panel door-left"
          style={{ backgroundImage: `url("${assetUrls.doors}")` }}
        />
        <div
          ref={doorRightRef}
          className="door-panel door-right"
          style={{ backgroundImage: `url("${assetUrls.doors}")` }}
        />
      </div>

      {/* Navigation pinned to viewport */}
      <header ref={navRef} className="nav-bar">
        <a
          href="/"
          onClick={handleWordmarkClick}
          className="nav-wordmark"
          aria-label="Namma Tender — Home"
          title="Namma Tender"
        >
          <FullBrandLockupMark compact className="nav-brand-lockup" />
        </a>

        <nav className="nav-pill-bar" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setActiveNav(item);
                  setLangMenuOpen(false);
                  if (item === 'Upload') {
                    setBidModalMode('Upload');
                    setBidModalOpen(true);
                  } else if (item === 'Chat' && activeSession) {
                    setWorkspaceTab('Chat');
                    setWorkspaceOpen(true);
                  } else if (item === 'Report' && activeSession) {
                    setWorkspaceTab('Report');
                    setWorkspaceOpen(true);
                  }
                }}
                className={`nav-pill-link${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {t.navLabels[item]}
              </button>
            );
          })}
        </nav>

        <div className="nav-right">
          <AuthButton />
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => setLangMenuOpen((prev) => !prev)}
              className="nav-lang-btn"
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              aria-label={`Select language, current ${language}`}
            >
              <IconWorld
                className="ti ti-world nav-globe-icon"
                stroke={1.5}
                aria-hidden="true"
              />
              <span>{language}</span>
            </button>

            {langMenuOpen && (
              <div
                role="listbox"
                aria-label="Language options"
                className="absolute right-0 top-full mt-3 min-w-[96px] rounded-xl bg-[#12101a]/95 backdrop-blur-md border border-white/15 p-1 shadow-xl"
              >
                {LANGUAGES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    role="option"
                    aria-selected={language === code}
                    onClick={() => {
                      setLanguage(code);
                      setLangMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                      language === code
                        ? 'bg-white text-[#1A1206] font-semibold'
                        : 'text-white/85 hover:bg-white/10'
                    }`}
                  >
                    {code === 'Eng' ? 'Eng · EN' : code === 'Tam' ? 'Tam · தமிழ்' : 'Hin · हिन्दी'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setLangMenuOpen(false);
              if (activeSession) {
                setWorkspaceTab('Chat');
                setWorkspaceOpen(true);
              } else {
                setBidModalMode('Upload');
                setBidModalOpen(true);
              }
            }}
            className="nav-cta-btn"
          >
            {activeSession
              ? language === 'Tam'
                ? 'ஏல மீட்பு திற'
                : language === 'Hin'
                  ? 'बिड रेस्क्यू खोलें'
                  : 'Open Bid Rescue'
              : t.ctaButton}
          </button>
        </div>
      </header>

      {/* Workflow drawer when user selects Chat / Report before uploading */}
      {activeInfoCard && !workspaceOpen && !bidModalOpen && (
        <aside
          aria-label={activeInfoCard.title}
          className="fixed bottom-5 left-5 right-5 sm:right-auto sm:left-8 sm:bottom-8 z-20 max-w-sm rounded-2xl bg-[#0e0c18]/90 backdrop-blur-md border border-white/18 p-5 text-white shadow-2xl"
        >
          <button
            type="button"
            onClick={() => setActiveNav('How it works')}
            aria-label={t.closeOverviewAria}
            className="absolute right-3.5 top-3.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11px] font-medium tracking-[0.14em] uppercase text-[#E0A458]">
            {activeInfoCard.eyebrow}
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight pr-6">{activeInfoCard.title}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-white/80">{activeInfoCard.body}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setBidModalMode(activeInfoCard.mode);
                setBidModalOpen(true);
              }}
              className="h-10 px-5 rounded-full bg-[#E0A458] hover:bg-[#EBB46B] text-[#1A1206] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              {activeInfoCard.cta}
            </button>
            {activeSession && (
              <button
                type="button"
                onClick={() => {
                  setWorkspaceTab(activeInfoCard.mode === 'Report' ? 'Report' : 'Chat');
                  setWorkspaceOpen(true);
                }}
                className="h-10 px-4 rounded-full border border-white/25 text-xs text-white hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                Resume Workspace
              </button>
            )}
          </div>
        </aside>
      )}

      <BidCheckModal
        open={bidModalOpen}
        initialMode={bidModalMode}
        language={language}
        onClose={() => setBidModalOpen(false)}
        onSessionCreated={handleSessionCreated}
      />

      <BidWorkspacePanel
        open={workspaceOpen}
        session={activeSession}
        initialTab={workspaceTab}
        language={language}
        integrations={integrations}
        onClose={() => setWorkspaceOpen(false)}
        onSessionUpdate={handleSessionUpdate}
        onStartNewAnalysis={() => {
          setWorkspaceOpen(false);
          setBidModalMode('Upload');
          setBidModalOpen(true);
        }}
        onClearSession={handleClearSession}
      />
    </main>
  );
}
