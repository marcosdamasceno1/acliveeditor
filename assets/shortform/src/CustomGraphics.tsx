/**
 * CustomGraphics — the ONE file you edit in Phase 2, and ONLY when a spoken
 * word calls for a bespoke motion graphic instead of a stock image (e.g.
 * "animações" → animated shapes, "roteiro" → a typewriter script sheet,
 * "gráfico" → a growing chart). Everything else is data in edit-data.json.
 *
 * Default: renders nothing. To add graphics, build components here (worked
 * examples below — same upper-zone card motif as the image inserts) and mount
 * them in <CustomGraphics/> with their own <Sequence from/durationInFrames>.
 *
 * Timings: get the payoff word's timestamp from the cut transcript and land
 * the animation on it. Keep 0.5–2s per accent; whoosh on entry, pop on shapes.
 */
import {
  AbsoluteFill,
  Sequence,
  Img,
  OffthreadVideo,
  staticFile,
  interpolate,
  spring,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Poppins';
import {Sfx} from './Main';
import editData from '../public/edit-data.json';

const {fontFamily} = loadFont('normal', {weights: ['400', '600', '900']});
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ============ MOUNT POINT (edit this) ==========================================
// STYLE "TELA DIVIDIDA" (split screen) — driven by edit-data.json `splitInserts`.
// Leave the array out and this renders nothing, as before.
type SplitInsert = {
  src: string;
  start: number;
  end: number;
  fit?: 'cover' | 'contain';
  bandH?: number;
  layout?: 'top' | 'bottom';
};

// Two variants of one idea — both PIN THE FACE to a fixed region and give the
// rest of the frame to the image:
//   'top'    "Tela dividida"   — art on top, head raised underneath
//   'bottom' "Tela dividida 2" — head held high, art underneath
// The zoom/focus pair is what pins the face and is NOT interchangeable between
// them. `focusY` is a SOURCE y that lands at the top of the video window, so a
// point y_src renders at (y_src - focusY) * zoom.
//   top:    the head must be lifted out of the source's headroom → zoom in hard.
//   bottom: that headroom is the point — it is what puts the face under the
//           frame edge instead of in the middle.
// MEASURE THE SOURCE before trusting these numbers: ffmpeg a frame out of
// cut.mp4, read the hair-top and chin y, and set focusY so the head lands where
// the user asked. The values below fit a head ~660px tall starting at y 455.
const LAYOUT = {
  top: {zoom: 1.25, focusY: 400},
  bottom: {zoom: 1.0, focusY: 225},
} as const;

// A cut transition: a light beam whips across the frame while a short flash
// blooms, with a click on the cut. Data, not JSX — `transitions` in
// edit-data.json — so the windows stay visible to the preview timeline and
// retimeable without touching code.
type CutFlash = {at: number; intensity?: number; sfx?: string; volume?: number};

// A count-up stat card ("+40% de faturamento") — animated number racing up to a
// target with a pop on entry. OPTIONAL and data-driven: driven by `counters` in
// edit-data.json, which defaults to [] so this renders NOTHING unless the user
// asks for it. Windows stay visible to the preview timeline and retimeable
// without touching this code — same contract as splitInserts/transitions.
type CounterInsert = {
  target: number;        // final number, e.g. 40
  start: number;         // seconds on cut.mp4 timeline
  end: number;           // seconds — when it leaves
  label?: string;        // caption under the number, e.g. "FATURAMENTO"
  prefix?: string;       // e.g. "+" or "R$ "
  suffix?: string;       // e.g. "%" or "k"
  countFrames?: number;  // how long the number races up (default 20)
  color?: string;        // accent override; default edit-data accent (Lytex blue)
  sfx?: string;          // entry sound (default "pop.mp3")
};

// Family of optional highlight motions. ALL default OFF (empty array = nothing).
// Each reads its own array from edit-data.json; each carries an optional `color`
// so the LLM picks per context, falling back to the brand accent.
type WordPop = {          // one spoken word slammed on screen, huge
  text: string; start: number; end: number;
  color?: string; sfx?: string;
};
type Typewriter = {       // text typing itself in, cursor blinking
  lines: string[]; start: number; end: number;
  cps?: number;           // chars per frame (default 1.7)
  color?: string; sfx?: string;
};
type Pill = {             // a label/badge sliding in ("NOVIDADE", "OFERTA ↑")
  text: string; start: number; end: number;
  from?: 'left' | 'right' | 'bottom';  // slide direction (default 'bottom')
  color?: string; sfx?: string;
};
type BarGrow = {          // a horizontal bar growing to a percentage
  pct: number;            // 0..100 fill
  start: number; end: number;
  label?: string;
  color?: string; sfx?: string;
};

export const CustomGraphics: React.FC = () => {
  const d = editData as {
    splitInserts?: SplitInsert[];
    transitions?: CutFlash[];
    counters?: CounterInsert[];
    wordPops?: WordPop[];
    typewriters?: Typewriter[];
    pills?: Pill[];
    bars?: BarGrow[];
  };
  const splits = d.splitInserts ?? [];
  const flashes = d.transitions ?? [];
  const counters = d.counters ?? [];
  const wordPops = d.wordPops ?? [];
  const typewriters = d.typewriters ?? [];
  const pills = d.pills ?? [];
  const bars = d.bars ?? [];
  return (
    <>
      {splits.length ? <SplitScreen items={splits} /> : null}
      {flashes.length ? <CutFlashes items={flashes} /> : null}
      {counters.length ? <Counters items={counters} /> : null}
      {wordPops.length ? <WordPops items={wordPops} /> : null}
      {typewriters.length ? <Typewriters items={typewriters} /> : null}
      {pills.length ? <Pills items={pills} /> : null}
      {bars.length ? <Bars items={bars} /> : null}
    </>
  );
};

const ACCENT_DEFAULT = () => (editData as {accent?: string}).accent || '#1B3A6B';

// pick the active window by frame — shared by every highlight motion below
function pickActive<T extends {start: number; end: number}>(
  items: T[], frame: number, fps: number,
): {item: T; a: number; b: number; local: number} | null {
  for (const it of items) {
    const a = Math.round(it.start * fps) + VIDEO_LAG;
    const b = Math.round(it.end * fps) + VIDEO_LAG;
    if (frame >= a && frame < b) return {item: it, a, b, local: frame - a};
  }
  return null;
}

// ============ COUNTER (optional stat card) ====================================
// One always-mounted layer; the active window is picked by frame, like the split.
// ease-out on the count (number runs fast then settles) + ease-out-back on the
// card scale (the "pop"). The accent bar grows across the top with progress.
const Counters: React.FC<{items: CounterInsert[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const active = items.find((it) => {
    const a = Math.round(it.start * fps) + VIDEO_LAG;
    const b = Math.round(it.end * fps) + VIDEO_LAG;
    return frame >= a && frame < b;
  });
  if (!active) return null;
  const ACCENT = active.color || ACCENT_DEFAULT();

  const a = Math.round(active.start * fps) + VIDEO_LAG;
  const b = Math.round(active.end * fps) + VIDEO_LAG;
  const countLen = active.countFrames ?? 20;
  const local = frame - a;

  // count-up (ease-out cubic) — fast then settles on target
  const cp = clamp(local / Math.max(1, countLen), 0, 1);
  const eased = 1 - Math.pow(1 - cp, 3);
  const val = Math.round(active.target * eased);

  // card pop (ease-out-back) over the first ~10 frames
  const pp = clamp(local / 10, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const back = 1 + c3 * Math.pow(pp - 1, 3) + c1 * Math.pow(pp - 1, 2);
  const scale = clamp(0.6 + 0.4 * back, 0.01, 1.12);

  // fade out on the last 6 frames of the window
  const outOp = interpolate(frame, [b - 6, b], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // accent bar grows with the same count progress
  const barP = eased;
  const labelOp = clamp(local / 8, 0, 1);
  const num = `${active.prefix ?? ''}${val}${active.suffix ?? ''}`;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          position: 'relative',
          background: '#16181e',
          borderRadius: 48,
          padding: '54px 72px 46px',
          minWidth: 520,
          textAlign: 'center',
          fontFamily,
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          scale: String(scale),
          opacity: outOp,
        }}
      >
        <div
          style={{
            height: 16,
            width: `${Math.round(barP * 100)}%`,
            margin: '0 auto 34px',
            borderRadius: 9,
            background: ACCENT,
          }}
        />
        <div style={{fontWeight: 900, fontSize: 210, lineHeight: 1, color: '#fff', letterSpacing: -4}}>
          {num}
        </div>
        {active.label ? (
          <div
            style={{
              marginTop: 18,
              fontWeight: 900,
              fontSize: 44,
              letterSpacing: 2,
              color: ACCENT,
              opacity: labelOp,
            }}
          >
            {active.label}
          </div>
        ) : null}
      </div>
      <Sequence from={a} durationInFrames={10} layout="none">
        <Sfx src={active.sfx ?? 'pop.mp3'} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ WORD POP (one spoken word slammed on screen) ====================
// The word arrives with an overshoot spring, holds, then drops out. Use it on a
// single payoff word ("GRÁTIS", "AGORA", "DOBROU") landed on its own timestamp.
const WordPops: React.FC<{items: WordPop[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hit = pickActive(items, frame, fps);
  if (!hit) return null;
  const {item, a, b, local} = hit;
  const color = item.color || '#fff';

  // overshoot in (spring), settle, punch out on the last 5 frames
  const s = spring({frame: local, fps, config: {damping: 9, stiffness: 170, mass: 0.7}});
  const scaleIn = interpolate(s, [0, 1], [0.3, 1]);
  const outK = interpolate(frame, [b - 5, b], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const outScale = interpolate(frame, [b - 5, b], [1, 1.35], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rot = interpolate(s, [0, 1], [-6, 0]);

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 200,
          letterSpacing: -4,
          color,
          textShadow: '0 8px 40px rgba(0,0,0,0.55)',
          WebkitTextStroke: color === '#fff' ? '0' : '4px rgba(0,0,0,0.25)',
          scale: String(scaleIn * outScale),
          opacity: outK,
          rotate: `${rot}deg`,
          textTransform: 'uppercase',
        }}
      >
        {item.text}
      </div>
      <Sequence from={a} durationInFrames={8} layout="none">
        <Sfx src={item.sfx ?? 'pop.mp3'} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ TYPEWRITER (text typing itself in) ==============================
// Lines type in char by char with a blinking cursor. Good for lists, a script
// sheet, "3 passos". Reuses the tilted-card motif of the worked ScriptInner
// example but is driven entirely by data (typewriters[]), no per-video code.
const Typewriters: React.FC<{items: Typewriter[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hit = pickActive(items, frame, fps);
  if (!hit) return null;
  const {item, a, b, local} = hit;
  const accent = item.color || ACCENT_DEFAULT();
  const cps = item.cps ?? 1.7;

  const appear = interpolate(local, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const exit = interpolate(frame, [b - 7, b], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(appear, [0, 1], [24, 0]);

  // total chars typed so far; distribute across lines in order
  const typed = Math.max(0, Math.floor(local * cps));
  let remaining = typed;
  const shown = item.lines.map((ln) => {
    const take = clamp(remaining, 0, ln.length);
    remaining -= take;
    return {full: ln, n: take};
  });
  const cursorOn = Math.floor(local / 8) % 2 === 0;
  const activeLine = shown.findIndex((l) => l.n < l.full.length);

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          fontFamily,
          background: '#f6f3ec',
          color: '#16181e',
          borderRadius: 22,
          padding: '54px 60px',
          minWidth: 640,
          maxWidth: 860,
          boxShadow: '0 26px 70px rgba(0,0,0,0.5)',
          transform: `rotate(-2.2deg) translateY(${rise}px)`,
          opacity: appear * exit,
          borderLeft: `12px solid ${accent}`,
        }}
      >
        {shown.map((l, i) => (
          <div key={i} style={{fontWeight: 700, fontSize: 54, lineHeight: 1.35, whiteSpace: 'pre-wrap'}}>
            {l.full.slice(0, l.n)}
            {i === activeLine && cursorOn ? <span style={{color: accent}}>|</span> : null}
          </div>
        ))}
      </div>
      <Sequence from={a} durationInFrames={8} layout="none">
        <Sfx src={item.sfx ?? 'click.mp3'} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ PILL / BADGE (label sliding in) =================================
// A rounded label that slides in from an edge and settles with a small spring.
// Sits high on the frame by default so it doesn't fight the captions at bottom.
const Pills: React.FC<{items: Pill[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hit = pickActive(items, frame, fps);
  if (!hit) return null;
  const {item, a, b, local} = hit;
  const accent = item.color || ACCENT_DEFAULT();
  const from = item.from ?? 'bottom';

  const s = spring({frame: local, fps, config: {damping: 13, stiffness: 140, mass: 0.8}});
  const off = interpolate(s, [0, 1], [1, 0]);
  const outK = interpolate(frame, [b - 6, b], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const dx = from === 'left' ? -600 * off : from === 'right' ? 600 * off : 0;
  const dy = from === 'bottom' ? 180 * off : 0;

  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', pointerEvents: 'none'}}>
      <div
        style={{
          marginTop: 300,
          transform: `translate(${dx}px, ${dy}px)`,
          opacity: outK,
          background: accent,
          color: '#fff',
          fontFamily,
          fontWeight: 900,
          fontSize: 56,
          letterSpacing: 1,
          padding: '22px 52px',
          borderRadius: 999,
          textTransform: 'uppercase',
          boxShadow: '0 16px 44px rgba(0,0,0,0.4)',
        }}
      >
        {item.text}
      </div>
      <Sequence from={a} durationInFrames={8} layout="none">
        <Sfx src={item.sfx ?? 'whoosh.mp3'} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ BAR (horizontal bar growing to a percentage) ====================
// A track with a fill that grows to pct with ease-out, a moving % readout above.
// Distinct from the counter card: this is the "progresso/participação" shape.
const Bars: React.FC<{items: BarGrow[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const hit = pickActive(items, frame, fps);
  if (!hit) return null;
  const {item, a, b, local} = hit;
  const accent = item.color || ACCENT_DEFAULT();

  const grow = interpolate(local, [0, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const appear = interpolate(local, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exit = interpolate(frame, [b - 6, b], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pct = Math.round(clamp(item.pct, 0, 100) * grow);
  const TRACK = 760;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', pointerEvents: 'none'}}>
      <div style={{fontFamily, opacity: appear * exit, width: TRACK}}>
        {item.label ? (
          <div style={{fontWeight: 900, fontSize: 40, color: '#fff', marginBottom: 18, textShadow: '0 3px 16px rgba(0,0,0,0.6)'}}>
            {item.label}
          </div>
        ) : null}
        <div style={{position: 'relative', height: 44, borderRadius: 999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden'}}>
          <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${clamp(item.pct, 0, 100) * grow}%`, background: accent, borderRadius: 999}} />
        </div>
        <div style={{textAlign: 'right', fontWeight: 900, fontSize: 52, color: '#fff', marginTop: 14, textShadow: '0 3px 16px rgba(0,0,0,0.6)'}}>
          {pct}%
        </div>
      </div>
      <Sequence from={a} durationInFrames={8} layout="none">
        <Sfx src={item.sfx ?? 'pop.mp3'} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ CUT FLASH =======================================================
// Starts BEFORE the cut and peaks on it. A transition that begins on the cut
// frame reads as a flash after the fact; leading it by two frames makes the
// light look like the thing that caused the change.
// `at` is the cut time exactly as segments.json states it — VIDEO_LAG lines it
// up with the frame the picture actually changes on, same as the split windows.
const FLASH_LEAD = 2; // frames before the cut
const FLASH_LEN = 7; // total, ~230ms at 30fps

const CutFlashes: React.FC<{items: CutFlash[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();

  const active = items.find((it) => {
    const c = Math.round(it.at * fps) + VIDEO_LAG;
    return frame >= c - FLASH_LEAD && frame < c - FLASH_LEAD + FLASH_LEN;
  });
  if (!active) return null;

  const c = Math.round(active.at * fps) + VIDEO_LAG;
  const k = active.intensity ?? 1;
  const p = (frame - (c - FLASH_LEAD)) / (FLASH_LEN - 1); // 0..1 pela janela

  // beam sweeps left→right, brightest as it crosses centre
  const x = interpolate(p, [0, 1], [-1.35 * width, 1.35 * width]);
  const beam = interpolate(p, [0, 0.35, 1], [0, 1 * k, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // the bloom is short and lands ON the cut, not spread across the window
  const bloom = interpolate(frame, [c - 1, c, c + 2], [0, 0.5 * k, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{backgroundColor: '#fff', opacity: bloom, mixBlendMode: 'screen'}} />
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <div
          style={{
            position: 'absolute',
            top: '-30%',
            left: 0,
            width: width * 0.46,
            height: '160%',
            transform: `translateX(${x.toFixed(1)}px) rotate(-18deg)`,
            background:
              'linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.95) 50%,rgba(255,255,255,0) 100%)',
            opacity: beam,
            mixBlendMode: 'screen',
            filter: 'blur(16px)',
          }}
        />
      </AbsoluteFill>
      <Sequence from={c} durationInFrames={10} layout="none">
        <Sfx src={active.sfx ?? 'cut-click.mp3'} volume={active.volume ?? 0.9} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ============ SPLIT SCREEN ("tela dividida") ==================================
// Art on top, the talking head re-drawn underneath, seam at the subject's hairline.
//
// ONE always-mounted layer, NOT a <Sequence> per window. The obvious version wraps
// each window in <Sequence from> + <OffthreadVideo startFrom>, and that samples
// cut.mp4 ONE FRAME BEHIND the base video: on the first frame of the split you
// still see the previous take, so the layout appears to change before the picture
// does. Mounted flat with no startFrom, this layer decodes the same frame the base
// layer does, and the window edges land exactly on the cut.
const SplitFrame: React.FC<{
  image: string;
  bandH: number;
  fit: 'cover' | 'contain';
  progress: number;
  layout: 'top' | 'bottom';
}> = ({image, bandH, fit, progress, layout}) => {
  // slow Ken-Burns so the band is not a dead still
  const artScale = 1 + 0.03 * progress;
  const {zoom, focusY} = LAYOUT[layout];
  const videoH = 1920 - bandH;
  const bandTop = layout === 'top' ? 0 : videoH;
  const videoTop = layout === 'top' ? bandH : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#0a0a0c'}}>
      <div style={{position: 'absolute', left: 0, top: videoTop, width: 1080, height: videoH, overflow: 'hidden'}}>
        <OffthreadVideo
          src={staticFile('cut.mp4')}
          muted
          style={{
            position: 'absolute',
            width: 1080 * zoom,
            height: 1920 * zoom,
            left: -(1080 * (zoom - 1)) / 2,
            top: -focusY * zoom,
          }}
        />
      </div>

      <div style={{position: 'absolute', left: 0, top: bandTop, width: 1080, height: bandH, overflow: 'hidden'}}>
        <Img
          src={staticFile(image)}
          style={{width: '100%', height: '100%', objectFit: fit, scale: String(artScale)}}
        />
        {/* Soft falloff into the seam — 'top' ONLY. There the caption sits ON the
            seam over the art and needs the darkening to stay legible. On
            'bottom' the caption sits above the seam over the video, so the same
            gradient only smears grey across the top of the photo. */}
        {layout === 'top' ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: '100%',
              height: 110,
              background: 'linear-gradient(180deg,rgba(10,10,12,0),rgba(10,10,12,0.75))',
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// OffthreadVideo draws the source frame at or before frame/fps; on an exact frame
// boundary that lands one frame LATE, so the decoded picture changes one
// composition frame after the index says it should. Measured, not guessed: with
// the split disabled, the camera zoom (index-driven) steps at frame 350 while the
// take itself changes at 351. Delay the layout by the same frame or the split
// visibly precedes the cut.
export const VIDEO_LAG = 1;

export const SplitScreen: React.FC<{items: SplitInsert[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // frame-indexed, not seconds: the window edges ARE cut frames
  const active = items.find((it) => {
    const a = Math.round(it.start * fps) + VIDEO_LAG;
    const b = Math.round(it.end * fps) + VIDEO_LAG;
    return frame >= a && frame < b;
  });
  if (!active) return null;
  const a = Math.round(active.start * fps) + VIDEO_LAG;
  const b = Math.round(active.end * fps) + VIDEO_LAG;
  return (
    <SplitFrame
      image={active.src}
      bandH={active.bandH ?? 750}
      fit={active.fit ?? 'cover'}
      layout={active.layout ?? 'top'}
      progress={clamp((frame - a) / Math.max(1, b - a), 0, 1)}
    />
  );
};

// ============ WORKED EXAMPLE 1: editing timeline being cut + caption tracks =====
// For "os cortes, as legendas e as animações" — a mini editor UI: playhead
// sweeps and splits the video track, caption chips pop in, shapes pop last.
const TL_W = 800;
const TL_H = 378;
const PAD = 46;
const INNER = TL_W - PAD * 2;

const TimelineInner: React.FC<{totalFrames: number}> = ({totalFrames}) => {
  const f = useCurrentFrame();
  const appear = interpolate(f, [0, 9], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const exit = interpolate(f, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(appear, [0, 1], [26, 0]);

  // playhead sweeps, bar splits into 3
  const gap = interpolate(f, [6, 16], [0, 16], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pieceW = (INNER - gap * 2) / 3;
  const playX = interpolate(f, [0, 16], [0, INNER], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const playOp = interpolate(f, [0, 2, 15, 19], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="whoosh.mp3" />
      <div style={{width: TL_W, height: TL_H, marginTop: 105, borderRadius: 28, background: '#15171c', border: '1px solid #262a31', boxShadow: '0 18px 50px rgba(0,0,0,0.5)', opacity: appear * exit, scale: String(interpolate(appear, [0, 1], [0.93, 1])), translate: `0px ${rise}px`, padding: PAD, boxSizing: 'border-box', position: 'relative', fontFamily}}>
        {/* window dots */}
        <div style={{display: 'flex', gap: 12}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (<div key={c} style={{width: 16, height: 16, borderRadius: 999, background: c}} />))}
        </div>

        {/* VIDEO track — being cut */}
        <div style={{position: 'absolute', left: PAD, top: 92, width: INNER, height: 62}}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{position: 'absolute', left: i * (pieceW + gap), width: pieceW, height: 62, borderRadius: 10, background: 'linear-gradient(180deg,#5b8dff,#3f6fe0)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)'}} />
          ))}
          <div style={{position: 'absolute', left: playX, top: -8, width: 3, height: 78, background: 'white', opacity: playOp, boxShadow: '0 0 8px rgba(255,255,255,0.8)'}} />
        </div>

        {/* LEGENDAS track — caption chips appear */}
        <div style={{position: 'absolute', left: PAD, top: 188, width: INNER, height: 46}}>
          {[0, 1, 2, 3].map((k) => {
            const ap = interpolate(f, [16 + k * 5, 24 + k * 5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.5))});
            return (
              <div key={k} style={{position: 'absolute', left: k * (INNER / 4), width: INNER / 4 - 14, height: 46, borderRadius: 9, background: '#33e0a3', opacity: Math.min(1, ap), scale: String(Math.max(0.01, ap)), display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '0 12px', boxSizing: 'border-box'}}>
                <div style={{height: 6, width: '80%', borderRadius: 4, background: 'rgba(0,0,0,0.55)'}} />
                <div style={{height: 6, width: '55%', borderRadius: 4, background: 'rgba(0,0,0,0.4)'}} />
              </div>
            );
          })}
        </div>

        {/* ANIMAÇÕES track — shapes pop */}
        <div style={{position: 'absolute', left: PAD, top: 270, width: INNER, height: 60, display: 'flex', gap: 20, alignItems: 'center'}}>
          {[0, 1, 2, 3].map((k) => {
            const ap = interpolate(f, [34 + k * 4, 42 + k * 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.8))});
            const rot = Math.sin((f + k * 7) * 0.2) * 20;
            const colors = ['#ffffff', '#ffd23f', '#ff5f9e', '#5b8dff'];
            const rounds = [999, 12, 6, 999];
            return (<div key={k} style={{width: 52, height: 52, background: colors[k], borderRadius: rounds[k], opacity: Math.min(1, ap), scale: String(Math.max(0.01, ap)), rotate: `${rot}deg`}} />);
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TimelineGraphic: React.FC<{startSec: number; endSec: number}> = ({startSec, endSec}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <TimelineInner totalFrames={duration} />
    </Sequence>
  );
};

// ============ WORKED EXAMPLE 2: script sheet with typewriter text ===============
// For "ela leu o roteiro" — a tilted paper card, lines typing in with a cursor.
const ScriptInner: React.FC<{totalFrames: number; lines: string[]}> = ({totalFrames, lines}) => {
  const f = useCurrentFrame();
  const appear = interpolate(f, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const exit = interpolate(f, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cps = 1.7; // chars per frame

  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="whoosh.mp3" />
      <div style={{width: 640, height: 420, marginTop: 100, borderRadius: 16, background: '#f4f1e8', boxShadow: '0 22px 55px rgba(0,0,0,0.5)', opacity: appear * exit, scale: String(interpolate(appear, [0, 1], [0.94, 1])), rotate: '-2deg', translate: `0px ${interpolate(appear, [0, 1], [26, 0])}px`, padding: 46, boxSizing: 'border-box', fontFamily}}>
        <div style={{fontWeight: 900, fontSize: 26, letterSpacing: 3, color: '#c2492b'}}>ROTEIRO</div>
        <div style={{height: 4, width: 90, background: '#c2492b', borderRadius: 3, marginTop: 10, marginBottom: 30}} />
        {lines.map((line, i) => {
          const startLocal = 10 + i * 12;
          const shown = clamp(Math.floor((f - startLocal) * cps), 0, line.length);
          const isTyping = shown > 0 && shown < line.length;
          const cursor = isTyping && Math.floor(f / 6) % 2 === 0 ? '|' : '';
          return (
            <div key={i} style={{fontWeight: 400, fontSize: 32, color: '#2b2b2b', lineHeight: 1.5, minHeight: 40}}>
              {line.slice(0, shown)}
              <span style={{color: '#c2492b'}}>{cursor}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const ScriptGraphic: React.FC<{startSec: number; endSec: number; lines: string[]}> = ({startSec, endSec, lines}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <ScriptInner totalFrames={duration} lines={lines} />
    </Sequence>
  );
};

// ============ WORKED EXAMPLE 3: playful shapes pop (for "animações") ============
const Shape: React.FC<{i: number; color: string; round: number}> = ({i, color, round}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [i * 3, i * 3 + 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6))});
  const pulse = 1 + 0.16 * Math.sin((frame + i * 6) * 0.28);
  const rot = Math.sin((frame + i * 8) * 0.12) * 22;
  return (
    <div
      style={{
        width: 92,
        height: 92,
        background: color,
        borderRadius: round,
        opacity: appear,
        scale: String(appear * pulse),
        rotate: `${rot}deg`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}
    />
  );
};

const ShapesInner: React.FC<{totalFrames: number}> = ({totalFrames}) => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [totalFrames - 7, totalFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(frame, [0, 8], [24, 0], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center'}}>
      <Sfx src="pop.mp3" volume={0.12} />
      <div style={{marginTop: 210, display: 'flex', gap: 34, opacity: exit, translate: `0px ${rise}px`}}>
        <Shape i={0} color="white" round={46} />
        <Shape i={1} color="#33e0a3" round={20} />
        <Shape i={2} color="white" round={8} />
      </div>
    </AbsoluteFill>
  );
};

export const ShapesGraphic: React.FC<{startSec: number; endSec: number}> = ({startSec, endSec}) => {
  const {fps} = useVideoConfig();
  const from = Math.round(startSec * fps);
  const duration = Math.round((endSec - startSec) * fps);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <ShapesInner totalFrames={duration} />
    </Sequence>
  );
};
