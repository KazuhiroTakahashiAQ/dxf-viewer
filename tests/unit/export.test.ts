import { describe, expect, it } from 'vitest';

import { SvgContext, SvgPath, xmlEscape } from '../../src/render/svgContext';
import { toCsv } from '../../src/ui/download';

describe('SVG export context', () => {
  it('escapes text, fonts, colors and titles (no markup from drawing data)', () => {
    const c = new SvgContext(100, 50);
    c.font = '12px "a" onload="x"';
    c.fillStyle = 'red"/><script>alert(1)</script>';
    c.fillText('<script>alert("x")</script> & ü', 1, 2);
    const svg = c.toSvg('</title><script>bad()</script>');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; ü');
    expect(new DOMParserLike(svg).ok).toBe(true);
  });

  it('records paths with transforms, dashes, fills and nested clips', () => {
    const c = new SvgContext(10, 10);
    c.setTransform(2, 0, 0, -2, 5, 5);
    c.lineWidth = 0.5;
    c.setLineDash([1, 2]);
    const p = new SvgPath();
    p.moveTo(0, 0);
    p.lineTo(1, 1);
    c.stroke(p as unknown as Path2D);
    c.save();
    c.clip(p as unknown as Path2D, 'evenodd');
    c.fill(p as unknown as Path2D, 'evenodd');
    c.restore();
    c.fillRect(0, 0, 1, 1);
    const svg = c.toSvg('t');
    expect(svg).toContain('<path d="M0 0L1 1" fill="none"');
    expect(svg).toContain('stroke-dasharray="1 2"');
    expect(svg).toContain('transform="matrix(2 0 0 -2 5 5)"');
    expect(svg).toMatch(/<g clip-path="url\(#c\d+\)"><path d="M0 0L1 1" fill="#000" fill-rule="evenodd"/);
    // after restore the clip no longer applies
    expect(svg).toMatch(/\n<path d="M0 0L1 0L1 1L0 1Z" fill/);
  });

  it('converts arcs to Béziers that end exactly at the arc end point', () => {
    const p = new SvgPath();
    p.arc(0, 0, 10, 0, Math.PI / 2);
    expect(p.toString()).toMatch(/^M10 0C10 5\.5228 5\.5228 10 0 10$/);
    const q = new SvgPath();
    q.ellipse(0, 0, 4, 2, 0, 0, 2 * Math.PI);
    expect(q.toString().match(/C/g)?.length).toBe(4);
    expect(q.toString().endsWith(' 4 0')).toBe(true);
  });

  it('xmlEscape covers all five entities', () => {
    expect(xmlEscape(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas and quotes separators', () => {
    const csv = toCsv(['a', 'b'], [['=1+2', '+x'], ['-3', '@SUM(A1)'], ['a,b', 'say "hi"']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`'=1+2,'+x`);
    expect(csv).toContain(`'-3,'@SUM(A1)`);
    expect(csv).toContain(`"a,b","say ""hi"""`);
  });
});

/** Tiny well-formedness check without a DOM: balanced tags of the SVG. */
class DOMParserLike {
  ok: boolean;
  constructor(xml: string) {
    const stack: string[] = [];
    let ok = true;
    for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
      if (m[1]) ok = ok && stack.pop() === m[2];
      else if (!m[3]) stack.push(m[2]);
    }
    this.ok = ok && stack.length === 0;
  }
}
