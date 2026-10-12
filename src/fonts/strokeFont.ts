import hershey from './hershey/hershey-subset.json';

/**
 * Single-stroke ("SHX-like") fonts. Glyph space: y grows downward; `cap` is
 * the cap height in glyph units and `baseline` the y of the baseline.
 * Built-in providers are Hershey fonts (substitutes for AutoCAD SHX fonts,
 * which are not redistributable); user-supplied SHX files register more.
 */
export interface StrokeProvider {
  name: string;
  cap: number;
  baseline: number;
  has(ch: string): boolean;
  advance(ch: string): number;
  glyph(ch: string): number[][];
}

const providers = new Map<string, StrokeProvider>();

export function registerStrokeFont(id: string, p: StrokeProvider): void {
  providers.set(id, p);
}

export function unregisterStrokeFonts(prefix: string): void {
  for (const k of [...providers.keys()]) if (k.startsWith(prefix)) providers.delete(k);
}

export function strokeProvider(id: string): StrokeProvider | undefined {
  return providers.get(id);
}

// ---- Hershey ----
type FontData = { name: string; chars: [string, number][] };
const HERSHEY_SPACE = 16;

function hersheyProvider(data: FontData): StrokeProvider {
  const cache = new Map<string, number[][]>();
  const g = (ch: string) => data.chars[ch.charCodeAt(0) - 33];
  return {
    name: `Hershey ${data.name}`,
    cap: 21,
    baseline: 22,
    has(ch) {
      if (ch === ' ' || ch === ' ') return true;
      const c = ch.charCodeAt(0);
      return ch.length === 1 && c >= 33 && c - 33 < data.chars.length;
    },
    advance(ch) {
      if (ch === ' ' || ch === ' ') return HERSHEY_SPACE;
      const d = g(ch);
      return d ? d[1] * 2 : HERSHEY_SPACE;
    },
    glyph(ch) {
      let polys = cache.get(ch);
      if (polys) return polys;
      polys = [];
      const d = g(ch);
      if (d) {
        let cur: number[] | null = null;
        for (const tok of d[0].split(/\s+/)) {
          if (!tok) continue;
          let t = tok;
          if (t[0] === 'M') {
            cur = [];
            polys.push(cur);
            t = t.slice(1);
          } else if (t[0] === 'L') t = t.slice(1);
          const [x, y] = t.split(',').map(Number);
          if (cur && Number.isFinite(x) && Number.isFinite(y)) cur.push(x, y);
        }
      }
      cache.set(ch, polys);
      return polys;
    },
  };
}

for (const [id, data] of Object.entries(hershey as unknown as Record<string, FontData>)) {
  registerStrokeFont(id, hersheyProvider(data));
}

export function hasStrokeGlyph(id: string, ch: string): boolean {
  return providers.get(id)?.has(ch) ?? false;
}

/** Width of `text` in units of the font's cap height (1 = cap height). */
export function strokeMeasureCap(id: string, text: string): number {
  const p = providers.get(id);
  if (!p) return text.length * 0.8;
  let w = 0;
  for (const ch of text) w += p.advance(ch);
  return w / p.cap;
}

/** Map an SHX font file name to the closest Hershey font. */
export function shxToStroke(file: string): string {
  const n = file.replace(/^.*[\\/]/, '').replace(/\.shx$/i, '').toLowerCase();
  if (/^romand|^isocp?d|duplex/.test(n)) return 'futuram';
  if (/^romant|triplex/.test(n)) return 'timesrb';
  if (/^romanc|complex/.test(n)) return 'timesr';
  if (/^italic/.test(n)) return 'timesi';
  if (/^scriptc/.test(n)) return 'scriptc';
  if (/^script/.test(n)) return 'scripts';
  if (/^gothice/.test(n)) return 'gothiceng';
  if (/^gothicg/.test(n)) return 'gothicger';
  if (/^gothici/.test(n)) return 'gothicita';
  if (/^greek/.test(n)) return 'greek';
  if (/^cyril/.test(n)) return 'cyrillic';
  return 'futural';
}
