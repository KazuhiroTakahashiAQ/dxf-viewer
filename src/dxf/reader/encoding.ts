import type { EncodingInfo } from '../model';

/** $DWGCODEPAGE → WHATWG encoding label. */
const CODEPAGES: Record<string, string> = {
  ANSI_874: 'windows-874',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
  ANSI_1361: 'euc-kr',
  DOS437: 'windows-1252',
  DOS850: 'windows-1252',
  DOS852: 'windows-1250',
  DOS855: 'windows-1251',
  DOS857: 'windows-1254',
  DOS860: 'windows-1252',
  DOS861: 'windows-1252',
  DOS863: 'windows-1252',
  DOS864: 'windows-1256',
  DOS865: 'windows-1252',
  DOS866: 'ibm866',
  DOS869: 'windows-1253',
  DOS932: 'shift_jis',
  DOS936: 'gbk',
  DOS949: 'euc-kr',
  DOS950: 'big5',
  ISO8859_1: 'iso-8859-1',
  ISO8859_2: 'iso-8859-2',
  ISO8859_3: 'iso-8859-3',
  ISO8859_4: 'iso-8859-4',
  ISO8859_5: 'iso-8859-5',
  ISO8859_6: 'iso-8859-6',
  ISO8859_7: 'iso-8859-7',
  ISO8859_8: 'iso-8859-8',
  ISO8859_9: 'iso-8859-9',
  ISO8859_15: 'iso-8859-15',
  BIG5: 'big5',
  GB2312: 'gbk',
  KSC5601: 'euc-kr',
  JOHAB: 'euc-kr',
  MACINTOSH: 'macintosh',
  KOI8_R: 'koi8-r',
  UTF8: 'utf-8',
  'UTF-8': 'utf-8',
};

export function codepageToEncoding(codepage: string | undefined): string | undefined {
  if (!codepage) return undefined;
  const key = codepage.trim().toUpperCase().replace(/-/g, '_');
  return CODEPAGES[key] ?? CODEPAGES[key.replace(/_/g, '')];
}

/** Encodings offered in the UI for manual override. */
export const ENCODING_CHOICES = [
  'utf-8',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'windows-1252',
  'iso-8859-1',
  'gbk',
  'big5',
  'euc-kr',
  'windows-1250',
  'windows-1251',
  'utf-16le',
  'utf-16be',
];

/** ACADVER → release name. */
export const RELEASES: Record<string, string> = {
  AC1006: 'R10',
  AC1009: 'R11/R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'R2000',
  AC1018: 'R2004',
  AC1021: 'R2007',
  AC1024: 'R2010',
  AC1027: 'R2013',
  AC1032: 'R2018',
};

export interface HeaderProbe {
  acadver?: string;
  codepage?: string;
}

/**
 * Read $ACADVER and $DWGCODEPAGE from the raw bytes without decoding the
 * whole file (header variables are ASCII).
 */
export function probeHeader(bytes: Uint8Array, limit = 1024 * 1024): HeaderProbe {
  const n = Math.min(bytes.length, limit);
  // single-byte view: one char per byte, safe for matching ASCII header names
  let text = new TextDecoder('windows-1252').decode(bytes.subarray(0, n));
  const endsec = text.search(/\r?\n\s*0\s*\r?\n\s*ENDSEC/);
  if (endsec >= 0) text = text.slice(0, endsec);
  const probe: HeaderProbe = {};
  const read = (name: string) => {
    const re = new RegExp(`\\${name}\\s*\\r?\\n\\s*\\d+\\s*\\r?\\n([^\\r\\n]*)`);
    const m = re.exec(text);
    return m ? m[1].trim() : undefined;
  };
  probe.acadver = read('$ACADVER');
  probe.codepage = read('$DWGCODEPAGE');
  return probe;
}

function isAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return false;
  return true;
}

function validUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shift_JIS plausibility: fraction of high bytes that form valid double-byte
 * pairs or half-width katakana. Returns 0..1.
 */
export function shiftJisScore(bytes: Uint8Array): number {
  let high = 0;
  let good = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    high++;
    if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) {
      const t = bytes[i + 1];
      if (t !== undefined && t >= 0x40 && t <= 0xfc && t !== 0x7f) {
        good += 2;
        high++;
        i++;
        continue;
      }
    } else if (b >= 0xa1 && b <= 0xdf) {
      good++;
    }
  }
  return high === 0 ? 0 : good / high;
}

export function eucJpScore(bytes: Uint8Array): number {
  let high = 0;
  let good = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    high++;
    const t = bytes[i + 1];
    if (((b >= 0xa1 && b <= 0xfe) || b === 0x8e) && t !== undefined && t >= 0xa1 && t <= 0xfe) {
      good += 2;
      high++;
      i++;
    }
  }
  return high === 0 ? 0 : good / high;
}

export function countReplacements(s: string): number {
  let n = 0;
  for (let i = s.indexOf('�'); i >= 0; i = s.indexOf('�', i + 1)) n++;
  return n;
}

function acadverNumber(v: string | undefined): number {
  const m = v ? /AC(\d{4})/i.exec(v) : null;
  return m ? Number(m[1]) : 0;
}

/**
 * Decide the text encoding of an ASCII DXF.
 * Order: BOM → R2007+ UTF-8 → valid UTF-8 → $DWGCODEPAGE → heuristics.
 */
export function detectEncoding(bytes: Uint8Array): Omit<EncodingInfo, 'replacements' | 'overridden'> {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', reason: 'UTF-8 byte order mark' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', reason: 'UTF-16LE byte order mark' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', reason: 'UTF-16BE byte order mark' };

  const probe = probeHeader(bytes);
  const codepage = probe.codepage;
  const cpEncoding = codepageToEncoding(codepage);
  const ver = acadverNumber(probe.acadver);

  if (isAscii(bytes)) {
    return { encoding: 'utf-8', reason: 'File contains only ASCII bytes (non-ASCII text, if any, is stored as \\U+ escapes)', codepage };
  }
  const utf8 = validUtf8(bytes);
  if (ver >= 1021) {
    if (utf8) return { encoding: 'utf-8', reason: `$ACADVER ${probe.acadver} (R2007 or later) stores text as UTF-8`, codepage };
  }
  if (utf8) {
    return {
      encoding: 'utf-8',
      reason: `Bytes are valid UTF-8${codepage ? ` (header declares ${codepage})` : ''}`,
      codepage,
    };
  }
  const sjis = shiftJisScore(bytes);
  if (cpEncoding && cpEncoding !== 'windows-1252' && cpEncoding !== 'utf-8') {
    return { encoding: cpEncoding, reason: `$DWGCODEPAGE = ${codepage}`, codepage };
  }
  if (sjis > 0.98) {
    return {
      encoding: 'shift_jis',
      reason: codepage
        ? `Byte patterns match Shift_JIS although the header declares ${codepage}`
        : 'No $DWGCODEPAGE; byte patterns match Shift_JIS',
      codepage,
    };
  }
  const euc = eucJpScore(bytes);
  if (euc > 0.98) {
    return { encoding: 'euc-jp', reason: 'Byte patterns match EUC-JP', codepage };
  }
  if (cpEncoding) return { encoding: cpEncoding, reason: `$DWGCODEPAGE = ${codepage}`, codepage };
  return { encoding: 'windows-1252', reason: 'No $DWGCODEPAGE; defaulting to Windows-1252', codepage };
}

export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  let start = 0;
  if (encoding === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  return new TextDecoder(encoding).decode(start ? bytes.subarray(start) : bytes);
}
