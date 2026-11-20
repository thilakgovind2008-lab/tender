import React from 'react';

interface MarkProps {
  className?: string;
}

/**
 * 01. PRIMARY APP ICON / EMBLEM
 * Gold double-bordered shield, cream Ripon clock tower with analog dial, and golden upward N-check ribbon.
 */
export function PrimaryEmblemMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 120 132"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Outer dark-navy halo shadow behind shield for crisp contrast */}
      <path
        d="M60 14L104 26V65C104 93 84 114 60 125C36 114 16 93 16 65V26L60 14Z"
        fill="#131629"
        fillOpacity="0.88"
      />
      {/* Outer Gold Shield */}
      <path
        d="M60 16L102 27.5V65C102 91.5 83 112 60 122.5C37 112 18 91.5 18 65V27.5L60 16Z"
        stroke="#C99846"
        strokeWidth="4.2"
        strokeLinejoin="round"
      />
      {/* Inner Thin Gold Shield */}
      <path
        d="M60 22.5L96 32.2V65C96 88 79.5 106 60 115.5C40.5 106 24 88 24 65V32.2L60 22.5Z"
        fill="#15182B"
        stroke="#C99846"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />

      {/* Ripon Building Tower Silhouette inside shield */}
      <g>
        {/* Spire Finial */}
        <path d="M60 5.5L61.4 13.5H58.6L60 5.5Z" fill="#F6F0E2" />
        <circle cx="60" cy="14" r="2.2" fill="#F6F0E2" />
        {/* Main Rounded Dome */}
        <path d="M47 29C47.5 19.5 53 15 60 15C67 15 72.5 19.5 73 29H47Z" fill="#F6F0E2" />
        {/* Dome vertical rib shadows */}
        <path d="M60 15.2C64 16 67 20.5 67.4 29H73C72.5 19.5 67 15 60 15.2Z" fill="#DCD2BC" />
        <path d="M53.5 17.5C52 20.5 51.5 24.5 51.5 29" stroke="#D3C7AE" strokeWidth="1.2" />
        <path d="M66.5 17.5C68 20.5 68.5 24.5 68.5 29" stroke="#C6B89A" strokeWidth="1.2" />
        {/* Dome Collar Cornice */}
        <rect x="44.5" y="28.5" width="31" height="3.2" rx="1" fill="#F6F0E2" />
        {/* Lantern Neck */}
        <rect x="47" y="31.7" width="26" height="6.8" fill="#EFE7D6" />
        <rect x="61.5" y="31.7" width="11.5" height="6.8" fill="#D8CEB8" />
        {/* Lantern Windows */}
        <rect x="50.5" y="33.2" width="2.4" height="4" rx="1" fill="#15182B" />
        <rect x="55" y="33.2" width="2.4" height="4" rx="1" fill="#15182B" />
        <rect x="59.5" y="33.2" width="2.4" height="4" rx="1" fill="#15182B" />
        <rect x="64" y="33.2" width="2.4" height="4" rx="1" fill="#15182B" />
        {/* Tower Pediment Cornice */}
        <path d="M36 41.5H84L82 38.5H38L36 41.5Z" fill="#F6F0E2" />
        {/* Main Clock Body */}
        <rect x="38.5" y="41.5" width="43" height="46" fill="#F6F0E2" />
        <rect x="66" y="41.5" width="15.5" height="46" fill="#DDD3BE" />
        {/* Side Tower Flanks */}
        <rect x="33.5" y="47" width="5" height="38" fill="#EBE2CE" />
        <rect x="81.5" y="47" width="5" height="38" fill="#CFC3AA" />
        {/* Arched lower bays */}
        <path d="M43 72C43 69.5 46.5 69.5 46.5 72V86H43V72Z" fill="#15182B" />
        <path d="M73.5 72C73.5 69.5 77 69.5 77 72V86H73.5V72Z" fill="#15182B" />
        {/* Clock Dial */}
        <circle cx="60" cy="57" r="10.2" fill="#15182B" />
        <circle cx="60" cy="57" r="8.2" fill="#FAF6ED" />
        <circle cx="60" cy="57" r="7" stroke="#15182B" strokeWidth="0.8" strokeDasharray="1 2.2" />
        <path d="M60 57L56.2 53.6M60 57L64.6 54.4" stroke="#15182B" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="60" cy="57" r="1.2" fill="#15182B" />
      </g>

      {/* Bold Golden N-Checkmark Ribbon sweeping past right edge */}
      <path
        d="M32 95.5L46 66L60 82L111 45C92 61 73 84 60 100.5L46.5 84.5L38 100.5L32 95.5Z"
        fill="#D69F4C"
        stroke="#131629"
        strokeWidth="3.8"
        strokeLinejoin="round"
      />
      <path
        d="M33.5 94.5L46 67.5L60 83.2L108.5 46.5C90.5 61.8 72.5 83.2 60 99L46.5 83L37.8 98.5L33.5 94.5Z"
        fill="url(#tkGoldGrad)"
      />
      <defs>
        <linearGradient id="tkGoldGrad" x1="34" y1="98" x2="105" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#B98234" />
          <stop offset="55%" stopColor="#E5B45F" />
          <stop offset="100%" stopColor="#C8913E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * 02. FULL BRAND LOCKUP
 * Primary shield emblem paired with NAMMA / TENDER wordmark and தமிழ் tagline.
 */
export function FullBrandLockupMark({
  className,
  showTamil = true,
  compact = false,
}: {
  className?: string;
  showTamil?: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center ${compact ? 'gap-2' : 'gap-2.5'} select-none ${className ?? ''}`}
    >
      <PrimaryEmblemMark className={compact ? 'h-[2.45em] w-auto shrink-0' : 'h-[2.6em] w-auto shrink-0'} />
      <span className="flex flex-col leading-none text-left">
        <span
          className="font-extrabold uppercase tracking-[0.06em] text-white"
          style={{ fontSize: '1.05em', lineHeight: 0.96 }}
        >
          NAMMA
        </span>
        <span
          className="font-extrabold uppercase tracking-[0.06em] text-white"
          style={{ fontSize: '1.05em', lineHeight: 0.96 }}
        >
          TENDER
        </span>
        {showTamil && (
          <span
            className="font-semibold tracking-[0.02em] text-[#E0A458]"
            style={{
              fontSize: '0.52em',
              lineHeight: 1.15,
              marginTop: '0.18em',
              fontFamily: '"Noto Sans Tamil", "Inter", sans-serif',
            }}
          >
            நம்ம டெண்டர்
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * 03. MONOCHROME SEAL / STAMP
 * Circular ink stamp: NAMMA TENDER • BID READINESS with central dome and check mark.
 */
export function MonochromeSealStamp({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Namma Tender Bid Readiness Verified Seal"
    >
      <circle cx="90" cy="90" r="82" fill="#FFFFFF" stroke="#181512" strokeWidth="5.5" />
      <circle cx="90" cy="90" r="46" stroke="#181512" strokeWidth="3.2" />

      <defs>
        <path id="tkSealTopArc" d="M 32,90 A 58,58 0 1,1 148,90" />
        <path id="tkSealBottomArc" d="M 24,96 A 66,66 0 0,0 156,96" />
      </defs>

      <text
        fill="#181512"
        fontSize="16.2"
        fontWeight="800"
        fontFamily="Inter, Arial, sans-serif"
        letterSpacing="2.2"
      >
        <textPath href="#tkSealTopArc" startOffset="50%" textAnchor="middle">
          NAMMA TENDER
        </textPath>
      </text>

      <text
        fill="#181512"
        fontSize="15.2"
        fontWeight="800"
        fontFamily="Inter, Arial, sans-serif"
        letterSpacing="1.8"
      >
        <textPath href="#tkSealBottomArc" startOffset="50%" textAnchor="middle">
          BID READINESS
        </textPath>
      </text>

      {/* Left & Right Dots */}
      <circle cx="26" cy="92" r="3" fill="#181512" />
      <circle cx="154" cy="92" r="3" fill="#181512" />

      {/* Inner Dome Silhouette */}
      <path d="M90 54L91.6 60H88.4L90 54Z" fill="#181512" />
      <circle cx="90" cy="60.5" r="2.2" fill="#181512" />
      <path d="M72 80C72.8 66 79 61 90 61C101 61 107.2 66 108 80H72Z" fill="#181512" />
      <path d="M68 82.5C75 79.5 105 79.5 112 82.5V84.5C105 81.5 75 81.5 68 84.5V82.5Z" fill="#181512" />

      {/* Bold Verified Checkmark */}
      <path
        d="M66 102L83 121L125 83L119 78L83 108L72 96.5L66 102Z"
        fill="#181512"
      />
    </svg>
  );
}

/**
 * Tamil Nadu state silhouette rendered as electric sheet-lightning inside storm clouds beside Ripon Building.
 */
export function TamilNaduLightningCloud({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 220 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <filter id="tnLightningGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5.5" result="blurWide" />
          <feGaussianBlur stdDeviation="1.6" result="blurTight" />
          <feMerge>
            <feMergeNode in="blurWide" />
            <feMergeNode in="blurTight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="tnCloudHalo" cx="52%" cy="48%" r="52%">
          <stop offset="0%" stopColor="#A9C8FF" stopOpacity="0.46" />
          <stop offset="48%" stopColor="#7C8CFF" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1D1640" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tnBoltStroke" x1="160" y1="20" x2="68" y2="235" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F5FAFF" />
          <stop offset="45%" stopColor="#B8DCFF" />
          <stop offset="100%" stopColor="#F3C77C" />
        </linearGradient>
      </defs>

      {/* Atmospheric thunderhead halo */}
      <ellipse cx="114" cy="128" rx="96" ry="112" fill="url(#tnCloudHalo)" />

      {/* Tamil Nadu State Outer Silhouette */}
      <g filter="url(#tnLightningGlow)">
        <path
          d="M174 16L183 19L192 14L200 18L199 28L193 40L188 55L183 70L178 86L173 102L173 116L170 128L158 138L147 146L145 157L158 164L168 168L155 170L143 166L134 176L127 188L121 198L108 202L98 214L88 228L77 242L71 238L68 226L72 214L75 202L69 194L62 184L65 174L60 163L55 151L51 140L44 132L32 126L22 120L27 110L21 102L30 96L42 98L50 88L58 84L67 74L79 71L80 58L91 54L103 48L108 38L121 36L132 30L140 24L154 22L165 16L174 16Z"
          fill="#9EC6FF"
          fillOpacity="0.14"
          stroke="url(#tnBoltStroke)"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />

        {/* Faint glowing internal district ridge lines (resembling lightning veins) */}
        <path
          d="M140 24L138 46L154 58L178 60M108 38L116 62L138 46M80 58L102 74L116 62M154 58L148 82L173 94M102 74L92 104L124 108L148 82M58 84L76 106L92 104M44 132L74 126L92 104M74 126L98 140L128 134L124 108M128 134L158 138M75 156L98 140L104 172L134 176M68 188L104 172L98 214"
          stroke="#DCEEFF"
          strokeOpacity="0.52"
          strokeWidth="0.95"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Crisp electric discharge fork branching from cloud top through Chennai/Madurai spine */}
        <path
          d="M174 17L160 44L168 50L142 86L150 92L120 132L126 138L96 184L102 188L77 240"
          stroke="#FFFFFF"
          strokeOpacity="0.78"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

