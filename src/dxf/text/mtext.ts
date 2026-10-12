import { decodeMif } from './escapes';

/**
 * MTEXT inline formatting parser.
 * Produces paragraphs of styled items plus a plain-text rendition.
 * Unknown codes are preserved as literal text so nothing is silently lost.
 */

export interface MTextStyle {
  /** \f family (TrueType) or \F font file (SHX); undefined = entity style font */
  font?: string;
  shx?: boolean;
  bold: boolean;
  italic: boolean;
  /** absolute character height in drawing units */
  height: number;
  widthFactor: number;
  /** degrees */
  oblique: number;
  /** tracking factor (1 = normal) */
  tracking: number;
  /** ACI color, 256 = BYLAYER/entity, 0 = BYBLOCK */
  aci?: number;
  /** 0xRRGGBB */
  rgb?: number;
  underline: boolean;
  overline: boolean;
  strike: boolean;
  /** \A: 0 bottom, 1 center, 2 top */
  valign: number;
}

export type MTextItem =
  | { kind: 'text'; text: string; style: MTextStyle }
  | { kind: 'tab'; style: MTextStyle }
  | { kind: 'stack'; upper: string; lower: string; type: '^' | '/' | '#'; style: MTextStyle };

export interface ParagraphProps {
  /** first-line indent, left/right indents (in drawing units, relative to height) */
  indent: number;
  left: number;
  right: number;
  /** l c r j d (distributed) */
  align?: 'l' | 'c' | 'r' | 'j' | 'd';
  tabs: number[];
}

export interface MTextParagraph {
  items: MTextItem[];
  props: ParagraphProps;
  /** paragraph starts a new column (\N) */
  columnBreak: boolean;
}

export interface ParsedMText {
  paragraphs: MTextParagraph[];
  plain: string;
}

function defaultProps(): ParagraphProps {
  return { indent: 0, left: 0, right: 0, tabs: [] };
}

export function parseMText(content: string, baseHeight: number): ParsedMText {
  let style: MTextStyle = {
    bold: false,
    italic: false,
    height: baseHeight,
    widthFactor: 1,
    oblique: 0,
    tracking: 1,
    underline: false,
    overline: false,
    strike: false,
    valign: 0,
  };
  const stack: MTextStyle[] = [];
  let props = defaultProps();
  const paragraphs: MTextParagraph[] = [];
  let items: MTextItem[] = [];
  let columnBreak = false;
  let text = '';
  const plain: string[] = [];

  const flushText = () => {
    if (text) {
      items.push({ kind: 'text', text, style });
      plain.push(text);
      text = '';
    }
  };
  const newParagraph = (col = false) => {
    flushText();
    paragraphs.push({ items, props, columnBreak });
    plain.push('\n');
    items = [];
    columnBreak = col;
    props = { ...props, tabs: [...props.tabs] };
  };
  const setStyle = (patch: Partial<MTextStyle>) => {
    flushText();
    style = { ...style, ...patch };
  };

  const n = content.length;
  let i = 0;
  /** read until ';' (unescaped), returns argument and advances i past ';' */
  const readArg = (): string | null => {
    const end = content.indexOf(';', i);
    if (end < 0) return null;
    const arg = content.slice(i, end);
    i = end + 1;
    return arg;
  };
  const parseFactor = (arg: string, current: number): number => {
    const rel = /x$/i.test(arg);
    const v = parseFloat(rel ? arg.slice(0, -1) : arg);
    if (!Number.isFinite(v)) return current;
    return rel ? current * v : v;
  };

  while (i < n) {
    const ch = content[i];
    if (ch === '\\' && i + 1 < n) {
      const cmd = content[i + 1];
      i += 2;
      switch (cmd) {
        case '\\':
        case '{':
        case '}':
          text += cmd;
          break;
        case 'P':
          newParagraph();
          break;
        case 'N':
          newParagraph(true);
          break;
        case 'X':
          newParagraph();
          break;
        case '~':
          text += ' ';
          break;
        case 'L':
          setStyle({ underline: true });
          break;
        case 'l':
          setStyle({ underline: false });
          break;
        case 'O':
          setStyle({ overline: true });
          break;
        case 'o':
          setStyle({ overline: false });
          break;
        case 'K':
          setStyle({ strike: true });
          break;
        case 'k':
          setStyle({ strike: false });
          break;
        case 'U':
        case 'u': {
          const m = /^\+([0-9A-Fa-f]{4})/.exec(content.slice(i, i + 5));
          if (m) {
            text += String.fromCharCode(parseInt(m[1], 16));
            i += 5;
          } else text += '\\' + cmd;
          break;
        }
        case 'M':
        case 'm': {
          const m = /^\+([1-5])([0-9A-Fa-f]{4})/.exec(content.slice(i, i + 6));
          if (m) {
            text += decodeMif(m[1], m[2]);
            i += 6;
          } else text += '\\' + cmd;
          break;
        }
        case 'f':
        case 'F': {
          const arg = readArg();
          if (arg === null) {
            text += '\\' + cmd;
            break;
          }
          const parts = arg.split('|');
          const patch: Partial<MTextStyle> = { font: parts[0] || undefined, shx: cmd === 'F' || /\.shx$/i.test(parts[0]) };
          for (const p of parts.slice(1)) {
            if (/^b\d/i.test(p)) patch.bold = p[1] === '1';
            else if (/^i\d/i.test(p)) patch.italic = p[1] === '1';
          }
          setStyle(patch);
          break;
        }
        case 'H': {
          const arg = readArg();
          if (arg !== null) setStyle({ height: parseFactor(arg, style.height) });
          break;
        }
        case 'W': {
          const arg = readArg();
          if (arg !== null) setStyle({ widthFactor: parseFactor(arg, style.widthFactor) });
          break;
        }
        case 'T': {
          const arg = readArg();
          if (arg !== null) setStyle({ tracking: parseFactor(arg, style.tracking) });
          break;
        }
        case 'Q': {
          const arg = readArg();
          if (arg !== null) {
            const v = parseFloat(arg);
            if (Number.isFinite(v)) setStyle({ oblique: v });
          }
          break;
        }
        case 'C': {
          const arg = readArg();
          if (arg !== null) {
            const v = parseInt(arg, 10);
            if (Number.isFinite(v)) setStyle({ aci: v, rgb: undefined });
          }
          break;
        }
        case 'c': {
          const arg = readArg();
          if (arg !== null) {
            const v = parseInt(arg, 10);
            if (Number.isFinite(v)) setStyle({ rgb: mtextTrueColor(v), aci: undefined });
          }
          break;
        }
        case 'A': {
          const arg = readArg();
          if (arg !== null) setStyle({ valign: Math.max(0, Math.min(2, parseInt(arg, 10) || 0)) });
          break;
        }
        case 'S': {
          // \Supper^lower; – separators ^ / #, "\;" escapes ';'
          let j = i;
          let raw = '';
          while (j < n) {
            const c = content[j];
            if (c === '\\' && content[j + 1] === ';') {
              raw += ';';
              j += 2;
              continue;
            }
            if (c === ';') break;
            raw += c;
            j++;
          }
          if (j >= n) {
            text += '\\S';
            break;
          }
          i = j + 1;
          const sep = /[\^/#]/.exec(raw);
          flushText();
          if (sep) {
            const upper = raw.slice(0, sep.index).replace(/\\(.)/g, '$1');
            const lower = raw.slice(sep.index + 1).replace(/\\(.)/g, '$1');
            items.push({ kind: 'stack', upper, lower, type: sep[0] as '^' | '/' | '#', style });
            plain.push(sep[0] === '^' ? `${upper} ${lower}`.trim() : `${upper}/${lower}`);
          } else {
            text += raw;
          }
          break;
        }
        case 'p': {
          const arg = readArg();
          if (arg === null) break;
          flushText();
          const next = { ...props, tabs: [...props.tabs] };
          let tabsReset = false;
          for (const part of arg.split(',')) {
            const p = part.trim();
            if (!p || p === 'x') continue;
            const key = p[0];
            const val = p.slice(1);
            if (key === 'i') next.indent = val === '*' ? 0 : parseFloat(val) || 0;
            else if (key === 'l') next.left = val === '*' ? 0 : parseFloat(val) || 0;
            else if (key === 'r') next.right = val === '*' ? 0 : parseFloat(val) || 0;
            else if (key === 'q') next.align = val === '*' ? undefined : (val[0] as ParagraphProps['align']);
            else if (key === 't') {
              if (!tabsReset) {
                next.tabs = [];
                tabsReset = true;
              }
              const v = parseFloat(val.replace(/^[lcr]/, ''));
              if (Number.isFinite(v)) next.tabs.push(v);
            } else if (/^[\d.]/.test(p) && tabsReset) {
              const v = parseFloat(p);
              if (Number.isFinite(v)) next.tabs.push(v);
            }
          }
          props = next;
          break;
        }
        default:
          // unknown command: keep literally
          text += '\\' + cmd;
      }
      continue;
    }
    if (ch === '{') {
      flushText();
      stack.push(style);
      i++;
      continue;
    }
    if (ch === '}') {
      flushText();
      if (stack.length) style = stack.pop()!;
      i++;
      continue;
    }
    if (ch === '^' && i + 1 < n) {
      const c = content[i + 1];
      i += 2;
      if (c === 'I') {
        flushText();
        items.push({ kind: 'tab', style });
        plain.push('\t');
      } else if (c === 'J') newParagraph();
      else if (c === 'M') {
        /* ignored */
      } else if (c === ' ') text += '^';
      else text += '▯';
      continue;
    }
    if (ch === '%' && content[i + 1] === '%' && i + 2 < n) {
      const c = content[i + 2].toLowerCase();
      if (c === 'c') { text += 'Ø'; i += 3; continue; }
      if (c === 'd') { text += '°'; i += 3; continue; }
      if (c === 'p') { text += '±'; i += 3; continue; }
      if (c === '%') { text += '%'; i += 3; continue; }
    }
    if (ch === '\n') {
      newParagraph();
      i++;
      continue;
    }
    text += ch;
    i++;
  }
  flushText();
  paragraphs.push({ items, props, columnBreak });
  return { paragraphs, plain: plain.join('') };
}

/**
 * MTEXT \c true color value. AutoCAD stores it with red in the low byte
 * (0x00BBGGRR); converted here to 0xRRGGBB.
 */
export function mtextTrueColor(v: number): number {
  const r = v & 0xff;
  const g = (v >> 8) & 0xff;
  const b = (v >> 16) & 0xff;
  return (r << 16) | (g << 8) | b;
}

/** Plain text of MTEXT content (formatting removed). */
export function mtextPlain(content: string): string {
  return parseMText(content, 1).plain;
}
