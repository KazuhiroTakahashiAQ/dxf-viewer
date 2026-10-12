import { describe, expect, it } from 'vitest';

import { mtextPlain, mtextTrueColor, parseMText, type MTextItem } from '../../src/dxf/text/mtext';

/** Text items of the parsed content, flattened (text runs only). */
const runs = (s: string, h = 2.5) =>
  parseMText(s, h).paragraphs.flatMap((p) => p.items.filter((i): i is Extract<MTextItem, { kind: 'text' }> => i.kind === 'text'));

describe('MTEXT inline codes (DXF reference examples and edge cases)', () => {
  it('paragraphs, non-breaking space and escaped characters', () => {
    const p = parseMText('Line 1\\PLine\\~2 \\\\ \\{x\\}', 1);
    expect(p.paragraphs.length).toBe(2);
    // \\~ is a non-breaking space (U+00A0) so line wrapping keeps the words together
    expect(mtextPlain('Line 1\\PLine\\~2 \\\\ \\{x\\}')).toBe('Line 1\nLine\u00a02 \\ {x}');
  });

  it('groups restore the style after }', () => {
    const r = runs('a{\\Lb}c');
    expect(r.map((x) => [x.text, x.style.underline])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
  });

  it('underline / overline / strike-through on and off', () => {
    const r = runs('\\Lu\\l \\Oo\\o \\Kk\\kz');
    const u = r.find((x) => x.text.startsWith('u'))!;
    const o = r.find((x) => x.text.startsWith('o'))!;
    const k = r.find((x) => x.text.startsWith('k'))!;
    expect([u.style.underline, o.style.overline, k.style.strike]).toEqual([true, true, true]);
    expect(r[r.length - 1].style.strike).toBe(false);
  });

  it('font, bold and italic (\\f family|b1|i1; and \\F file;)', () => {
    const r = runs('{\\fArial|b1|i1|c0|p34;A}{\\Fromans.shx;B}');
    expect(r[0].style).toMatchObject({ font: 'Arial', bold: true, italic: true, shx: false });
    expect(r[1].style).toMatchObject({ font: 'romans.shx', shx: true });
  });

  it('height absolute and relative (\\H2; \\H1.5x;)', () => {
    const r = runs('{\\H5;a}{\\H2x;b}c', 2.5);
    expect(r.map((x) => x.style.height)).toEqual([5, 5, 2.5]);
  });

  it('width, tracking and oblique (\\W \\T \\Q)', () => {
    const r = runs('\\W0.8;\\T1.2;\\Q15;x');
    expect(r[0].style).toMatchObject({ widthFactor: 0.8, tracking: 1.2, oblique: 15 });
  });

  it('ACI and true colors (\\C1; \\c<BGR>;)', () => {
    const r = runs('{\\C1;red}{\\c7528479;rgb}');
    expect(r[0].style.aci).toBe(1);
    // AutoCAD stores \c as 0xBBGGRR: (r, g, b) = (31, 224, 114)
    expect(r[1].style.rgb).toBe((31 << 16) | (224 << 8) | 114);
    expect(mtextTrueColor(7528479)).toBe(0x1fe072);
  });

  it('vertical alignment \\A', () => {
    expect(runs('\\A1;x')[0].style.valign).toBe(1);
  });

  it('stacked fractions with ^, / and # (incl. escaped ;)', () => {
    const items = parseMText('1\\S1/2;x\\S3^4;\\S5#6;\\Sa\\;b/c;', 1).paragraphs[0].items;
    const stacks = items.filter((i): i is Extract<MTextItem, { kind: 'stack' }> => i.kind === 'stack');
    expect(stacks.map((s) => [s.upper, s.lower, s.type])).toEqual([
      ['1', '2', '/'],
      ['3', '4', '^'],
      ['5', '6', '#'],
      ['a;b', 'c', '/'],
    ]);
  });

  it('paragraph properties incl. the extended x prefix', () => {
    const p = parseMText('\\pxqr;right\\P\\pxi-3,l3,t4,8;list\\P\\pq*;plain\\P\\pqc;center', 1).paragraphs;
    expect(p[0].props.align).toBe('r');
    expect(p[1].props).toMatchObject({ indent: -3, left: 3, tabs: [4, 8] });
    expect(p[2].props.align).toBeUndefined();
    expect(p[3].props.align).toBe('c');
  });

  it('tabs and line feeds from caret codes (^I ^J ^M)', () => {
    const p = parseMText('a^Ib^Jc', 1);
    expect(p.paragraphs[0].items.some((i) => i.kind === 'tab')).toBe(true);
    expect(p.paragraphs.length).toBe(2);
  });

  it('column break \\N starts a new column', () => {
    const p = parseMText('a\\Nb', 1).paragraphs;
    expect(p.length).toBe(2);
    expect(p[1].columnBreak).toBe(true);
  });

  it('\\U+ and \\M+ escapes inside MTEXT', () => {
    // MIF \\M+1 = Shift_JIS: 0x8ABF is 漢
    expect(mtextPlain('\\U+2205 \\M+18ABF')).toBe('∅ 漢');
  });

  it('unknown codes and unterminated arguments are kept as text', () => {
    expect(mtextPlain('a\\Zb')).toContain('\\Z');
    expect(mtextPlain('x\\H2.5')).toContain('x');
  });

  it('fields %<…>% keep their cached text in the plain rendition', () => {
    expect(mtextPlain('Date: %<\\AcVar Date \\f "M/d/yyyy">%')).toContain('Date:');
  });
});
