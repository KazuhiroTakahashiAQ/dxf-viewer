/** MIF codepage digit (\M+n) → WHATWG encoding. Johab (4) is not decodable by browsers. */
const MIF_ENCODINGS: Record<string, string> = {
  '1': 'shift_jis',
  '2': 'big5',
  '3': 'euc-kr',
  '4': 'euc-kr',
  '5': 'gbk',
};

const decoders = new Map<string, TextDecoder>();
function decoder(enc: string): TextDecoder {
  let d = decoders.get(enc);
  if (!d) {
    d = new TextDecoder(enc);
    decoders.set(enc, d);
  }
  return d;
}

/** Decode one MIF double-byte character (\M+nHHLL). */
export function decodeMif(cp: string, hex: string): string {
  const enc = MIF_ENCODINGS[cp];
  if (!enc) return '�';
  const v = parseInt(hex, 16);
  const bytes = v > 0xff ? new Uint8Array([v >> 8, v & 0xff]) : new Uint8Array([v]);
  return decoder(enc).decode(bytes);
}

const ESCAPE_RE = /\\[Uu]\+([0-9A-Fa-f]{4})|\\[Mm]\+([1-5])([0-9A-Fa-f]{4})/g;

/**
 * Decode `\U+XXXX` and `\M+nXXXX` escapes used by pre-2007 DXF for characters
 * outside the file codepage. Applied to all plain strings (TEXT, names, ...).
 * MTEXT content is handled by the MTEXT parser instead because `\\` escapes
 * a backslash there.
 */
export function decodeEscapes(s: string): string {
  if (s.indexOf('\\') < 0) return s;
  return s.replace(ESCAPE_RE, (_m, u: string | undefined, cp: string | undefined, hex: string | undefined) =>
    u !== undefined ? String.fromCharCode(parseInt(u, 16)) : decodeMif(cp!, hex!),
  );
}

export interface TextRun {
  text: string;
  underline: boolean;
  overline: boolean;
  strike: boolean;
}

const cp1252 = new TextDecoder('windows-1252');

/**
 * Interpret TEXT/ATTRIB control codes: %%c %%d %%p %%% %%nnn and the
 * %%u / %%o / %%k toggles. Returns styled runs.
 */
export function parseTextSpecials(input: string): TextRun[] {
  const s = decodeEscapes(input);
  const runs: TextRun[] = [];
  let cur = '';
  let underline = false;
  let overline = false;
  let strike = false;
  const flush = () => {
    if (cur) runs.push({ text: cur, underline, overline, strike });
    cur = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '%' && s[i + 1] === '%' && i + 2 < s.length) {
      const c = s[i + 2];
      const lc = c.toLowerCase();
      if (lc === 'c') { cur += 'Ø'; i += 2; continue; }
      if (lc === 'd') { cur += '°'; i += 2; continue; }
      if (lc === 'p') { cur += '±'; i += 2; continue; }
      if (c === '%') { cur += '%'; i += 2; continue; }
      if (lc === 'u') { flush(); underline = !underline; i += 2; continue; }
      if (lc === 'o') { flush(); overline = !overline; i += 2; continue; }
      if (lc === 'k') { flush(); strike = !strike; i += 2; continue; }
      const m = /^\d{1,3}/.exec(s.slice(i + 2, i + 5));
      if (m) {
        const n = Number(m[0]);
        cur += n < 128 ? String.fromCharCode(n) : cp1252.decode(new Uint8Array([n & 0xff]));
        i += 1 + m[0].length;
        continue;
      }
    }
    cur += ch;
  }
  flush();
  return runs;
}

/** Plain text of a TEXT value (control codes removed/resolved). */
export function plainText(input: string): string {
  return parseTextSpecials(input)
    .map((r) => r.text)
    .join('');
}
