/**
 * SatelliteSchematic.jsx
 *
 * Pure SVG 2D technical diagram of SAT-001 — a canonical front-facing
 * spacecraft schematic used as the static image background of the
 * 2D Optical Keypoint Projection panel.
 *
 * Layout matches the actual satellite.glb geometry proportions:
 *   • Central bus body (rectangular hull)
 *   • Port + Starboard solar arrays (long rectangular panels)
 *   • Forward docking collar (cylindrical ring, bottom)
 *   • High-gain antenna dish (parabolic, top-aft)
 *   • RCS thrusters (small corner nozzles)
 *
 * The SVG viewBox is 1000 × 440.
 * All 7 landmark percentage positions (used in PoseViewer.jsx) are
 * derived from this viewBox:
 *   KP-1 Bus CoM         → (500/1000, 220/440) = (50.0%, 50.0%)
 *   KP-2 Docking Collar  → (500/1000, 325/440) = (50.0%, 73.9%)
 *   KP-3 HGA Dish rim    → (500/1000,  88/440) = (50.0%, 20.0%)
 *   KP-4 Left Wing Root  → (305/1000, 220/440) = (30.5%, 50.0%)
 *   KP-5 Left Wing Tip   → ( 48/1000, 220/440) = ( 4.8%, 50.0%)
 *   KP-6 Right Wing Root → (695/1000, 220/440) = (69.5%, 50.0%)
 *   KP-7 Right Wing Tip  → (952/1000, 220/440) = (95.2%, 50.0%)
 */
export default function SatelliteSchematic() {
  const C = "#0d1e38";          // dark fill background tint
  const HULL = "#1e3a5f";       // main bus body
  const HULL_HI = "#2d5a8a";    // hull highlight
  const PANEL = "#193350";      // solar panel base
  const PANEL_CELL = "#1b4a7a"; // photovoltaic cell rows
  const PANEL_FRAME = "#2a6aaa";
  const STRUT = "#1a3a60";
  const ANTENNA = "#16304f";
  const ANTENNA_RIM = "#2a6aaa";
  const COLLAR = "#0e2a48";
  const COLLAR_RIM = "#2a6aaa";
  const GRID = "rgba(56,189,248,0.07)";
  const LINE = "rgba(56,189,248,0.18)";
  const DIM = "rgba(56,189,248,0.10)";
  const GLOW = "rgba(56,189,248,0.55)";

  return (
    <svg
      viewBox="0 0 1000 440"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-label="SAT-001 Structural Schematic"
    >
      <defs>
        {/* Subtle radial glow behind the spacecraft body */}
        <radialGradient id="bodyGlow" cx="50%" cy="50%" r="40%">
          <stop offset="0%"   stopColor="rgba(56,189,248,0.08)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>

        {/* Solar panel photovoltaic cell pattern */}
        <pattern id="pvCells" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill={PANEL} />
          <rect x="1" y="1" width="7" height="7" fill={PANEL_CELL} rx="1" />
          <rect x="10" y="1" width="7" height="7" fill={PANEL_CELL} rx="1" />
          <rect x="1" y="10" width="7" height="7" fill={PANEL_CELL} rx="1" />
          <rect x="10" y="10" width="7" height="7" fill={PANEL_CELL} rx="1" />
        </pattern>

        {/* Hull cross-hatch shading */}
        <pattern id="hullHatch" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={HULL} />
          <line x1="0" y1="12" x2="12" y2="0" stroke={HULL_HI} strokeWidth="0.6" opacity="0.5" />
        </pattern>

        {/* Annotation grid */}
        <pattern id="schGrid" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50,0 L0,0 0,50" fill="none" stroke={GRID} strokeWidth="0.5" />
        </pattern>

        {/* Soft glow filter for key structural edges */}
        <filter id="edgeGlow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

        {/* Dish parabola clip */}
        <clipPath id="dishClip">
          <ellipse cx="500" cy="88" rx="85" ry="52" />
        </clipPath>
      </defs>

      {/* ── Background ─────────────────────────────────────────────── */}
      <rect width="1000" height="440" fill="#030b1a" />
      <rect width="1000" height="440" fill="url(#schGrid)" />
      <ellipse cx="500" cy="220" rx="420" ry="210" fill="url(#bodyGlow)" />

      {/* ── Annotation reference lines (dimension ticks) ─────────── */}
      {/* Horizontal centre line */}
      <line x1="30" y1="220" x2="970" y2="220" stroke={DIM} strokeWidth="0.75" strokeDasharray="8 6" />
      {/* Vertical centre line */}
      <line x1="500" y1="20" x2="500" y2="420" stroke={DIM} strokeWidth="0.75" strokeDasharray="8 6" />

      {/* ── PORT (LEFT) SOLAR ARRAY ───────────────────────────────── */}
      {/* Deploy hinge strut */}
      <rect x="48"  y="208" width="257" height="24" fill={STRUT} stroke={LINE} strokeWidth="0.8" />
      {/* Panel body */}
      <rect x="48"  y="176" width="257" height="88" rx="4"
            fill="url(#pvCells)" stroke={PANEL_FRAME} strokeWidth="1.5" />
      {/* Panel frame border */}
      <rect x="48"  y="176" width="257" height="88" rx="4"
            fill="none" stroke={PANEL_FRAME} strokeWidth="2" />
      {/* Wing-tip edge highlight */}
      <line x1="48" y1="176" x2="48" y2="264" stroke={GLOW} strokeWidth="1.5" filter="url(#edgeGlow)" />

      {/* ── STARBOARD (RIGHT) SOLAR ARRAY ────────────────────────── */}
      <rect x="695" y="208" width="257" height="24" fill={STRUT} stroke={LINE} strokeWidth="0.8" />
      <rect x="695" y="176" width="257" height="88" rx="4"
            fill="url(#pvCells)" stroke={PANEL_FRAME} strokeWidth="1.5" />
      <rect x="695" y="176" width="257" height="88" rx="4"
            fill="none" stroke={PANEL_FRAME} strokeWidth="2" />
      <line x1="952" y1="176" x2="952" y2="264" stroke={GLOW} strokeWidth="1.5" filter="url(#edgeGlow)" />

      {/* ── CENTRAL BUS BODY ─────────────────────────────────────── */}
      <rect x="305" y="142" width="390" height="156" rx="10"
            fill="url(#hullHatch)" stroke={LINE} strokeWidth="2" />
      {/* Panel seams */}
      <line x1="305" y1="183" x2="695" y2="183" stroke={LINE} strokeWidth="0.8" />
      <line x1="305" y1="257" x2="695" y2="257" stroke={LINE} strokeWidth="0.8" />
      <line x1="425" y1="142" x2="425" y2="298" stroke={LINE} strokeWidth="0.8" />
      <line x1="575" y1="142" x2="575" y2="298" stroke={LINE} strokeWidth="0.8" />
      {/* Bus glow edges */}
      <rect x="305" y="142" width="390" height="156" rx="10"
            fill="none" stroke={ANTENNA_RIM} strokeWidth="1.2" filter="url(#edgeGlow)" opacity="0.4" />

      {/* ── FORWARD DOCKING COLLAR (bottom) ──────────────────────── */}
      {/* Collar neck */}
      <rect x="460" y="298" width="80" height="22" fill={COLLAR} stroke={LINE} strokeWidth="1" />
      {/* Collar ring */}
      <ellipse cx="500" cy="325" rx="52" ry="16"
               fill={COLLAR} stroke={COLLAR_RIM} strokeWidth="2" />
      {/* Inner docking ring detail */}
      <ellipse cx="500" cy="325" rx="30" ry="9"
               fill="none" stroke={COLLAR_RIM} strokeWidth="1" strokeDasharray="4 3" />
      {/* Alignment cross */}
      <line x1="490" y1="325" x2="510" y2="325" stroke={COLLAR_RIM} strokeWidth="1" />
      <line x1="500" y1="315" x2="500" y2="335" stroke={COLLAR_RIM} strokeWidth="1" />

      {/* ── HIGH-GAIN ANTENNA DISH (top) ─────────────────────────── */}
      {/* Feed boom */}
      <line x1="500" y1="142" x2="500" y2="104" stroke={LINE} strokeWidth="2.5" />
      <line x1="500" y1="104" x2="500" y2="90"  stroke={ANTENNA_RIM} strokeWidth="1.5" />
      {/* Dish outline (parabolic arc approximated by ellipse) */}
      <ellipse cx="500" cy="88" rx="82" ry="48"
               fill={ANTENNA} stroke={ANTENNA_RIM} strokeWidth="2" />
      {/* Dish mesh cross-ribs */}
      <ellipse cx="500" cy="88" rx="82" ry="48"
               fill="none" stroke={ANTENNA_RIM} strokeWidth="0.8" strokeDasharray="5 4" opacity="0.5" clipPath="url(#dishClip)" />
      <line x1="418" y1="88" x2="582" y2="88"  stroke={ANTENNA_RIM} strokeWidth="0.8" opacity="0.5" />
      <line x1="500" y1="40"  x2="500" y2="136" stroke={ANTENNA_RIM} strokeWidth="0.8" opacity="0.5" />
      {/* Dish rim highlight */}
      <ellipse cx="500" cy="88" rx="82" ry="48"
               fill="none" stroke={GLOW} strokeWidth="1.2" filter="url(#edgeGlow)" opacity="0.5" />
      {/* Feed horn */}
      <circle cx="500" cy="88" r="7" fill={HULL_HI} stroke={ANTENNA_RIM} strokeWidth="1.5" />

      {/* ── RCS THRUSTERS (corner nozzles on bus) ────────────────── */}
      {[
        [305, 142], [695, 142],
        [305, 298], [695, 298],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9}
                fill={COLLAR} stroke={ANTENNA_RIM} strokeWidth="1.2" opacity="0.9" />
      ))}

      {/* ── Type label ───────────────────────────────────────────── */}
      <text x="500" y="420"
            textAnchor="middle"
            fontFamily="'Orbitron', monospace"
            fontSize="11"
            fill="rgba(56,189,248,0.4)"
            letterSpacing="3">
        SAT-001  ·  STRUCTURAL REFERENCE  ·  FRONT VIEW
      </text>
    </svg>
  );
}

