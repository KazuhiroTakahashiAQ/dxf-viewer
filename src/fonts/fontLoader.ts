import type { FontSpec } from './resolve';
import { cssFont } from './resolve';
import type { FontMetrics, TextMeasurer } from '../scene/textLayout';
import { REF_PX } from '../scene/textLayout';

export interface FontManifest {
  version: number;
  families: {
    id: string;
    family: string;
    license: string;
    totalSize: number;
    faces: { weight: number; style: 'normal' | 'italic'; files: { url: string; unicodeRange: string; size: number }[] }[];
  }[];
}

/** Font registry for a worker or window scope (`self.fonts` / `document.fonts`). */
export class FontRegistry {
  manifest: FontManifest | null = null;
  private registered = false;

  constructor(
    private fontSet: FontFaceSet,
    private baseUrl: string,
  ) {}

  async init(): Promise<void> {
    if (this.registered) return;
    this.registered = true;
    try {
      const res = await fetch(new URL('fonts/manifest.json', this.baseUrl));
      if (!res.ok) throw new Error(String(res.status));
      this.manifest = (await res.json()) as FontManifest;
    } catch {
      this.manifest = { version: 1, families: [] };
      return;
    }
    for (const fam of this.manifest.families) {
      for (const face of fam.faces) {
        for (const file of face.files) {
          const url = new URL(`fonts/${file.url}`, this.baseUrl).href;
          const ff = new FontFace(fam.family, `url(${JSON.stringify(url)}) format("woff2")`, {
            weight: String(face.weight),
            style: face.style,
            unicodeRange: file.unicodeRange,
            display: 'block',
          });
          this.fontSet.add(ff);
        }
      }
    }
  }

  /** Load the unicode-range slices needed to draw `text` with each font spec. */
  async ensure(specs: Iterable<FontSpec>, text: string): Promise<void> {
    const sample = uniqueChars(text) || 'A';
    const seen = new Set<string>();
    const jobs: Promise<unknown>[] = [];
    for (const spec of specs) {
      const f = cssFont(spec, 16);
      if (seen.has(f)) continue;
      seen.add(f);
      jobs.push(this.fontSet.load(f, sample).catch(() => []));
    }
    await Promise.all(jobs);
  }
}

function uniqueChars(text: string): string {
  const set = new Set<string>();
  for (const ch of text) if (ch.trim()) set.add(ch);
  return [...set].join('');
}

/** TextMeasurer backed by an OffscreenCanvas 2D context. */
export class CanvasMeasurer implements TextMeasurer {
  private ctx: OffscreenCanvasRenderingContext2D;
  private metricsCache = new Map<string, FontMetrics>();
  private widthCache = new Map<string, number>();
  private current = '';

  constructor() {
    const c = new OffscreenCanvas(8, 8);
    this.ctx = c.getContext('2d')!;
  }

  private setFont(font: FontSpec): string {
    const f = cssFont(font, REF_PX);
    if (f !== this.current) {
      this.ctx.font = f;
      this.current = f;
    }
    return f;
  }

  width(text: string, font: FontSpec): number {
    const f = this.setFont(font);
    if (text.length <= 8) {
      const key = f + '\u0000' + text;
      const hit = this.widthCache.get(key);
      if (hit !== undefined) return hit;
      const w = this.ctx.measureText(text).width;
      if (this.widthCache.size < 200_000) this.widthCache.set(key, w);
      return w;
    }
    return this.ctx.measureText(text).width;
  }

  metrics(font: FontSpec): FontMetrics {
    const f = this.setFont(font);
    let m = this.metricsCache.get(f);
    if (!m) {
      const h = this.ctx.measureText('H');
      const g = this.ctx.measureText('gjpqy');
      const capHeight = h.actualBoundingBoxAscent / REF_PX || 0.7;
      m = {
        capHeight: capHeight > 0.2 && capHeight < 1.2 ? capHeight : 0.7,
        ascent: (h.fontBoundingBoxAscent ?? REF_PX * 0.9) / REF_PX,
        descent: (g.actualBoundingBoxDescent || REF_PX * 0.21) / REF_PX,
      };
      this.metricsCache.set(f, m);
    }
    return m;
  }
}
