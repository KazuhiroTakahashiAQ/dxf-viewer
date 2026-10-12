/**
 * Substitute fonts bundled with the app (all SIL OFL 1.1, self-hosted).
 * `cssFamily` is the family name used inside the app; it is prefixed so a
 * locally installed font with the same name never shadows the bundled copy.
 */
export interface BundledFamilyDef {
  /** @fontsource package id */
  id: string;
  /** Family name registered via FontFace */
  cssFamily: string;
  /** Upstream family name (for display) */
  displayName: string;
  weights: number[];
  styles: ('normal' | 'italic')[];
  /** Fonts this family stands in for (display only) */
  substitutes: string[];
  /** Load eagerly on startup (small, used by almost every drawing) */
  core?: boolean;
}

export const BUNDLED_FONT_FAMILIES: BundledFamilyDef[] = [
  {
    id: 'biz-udgothic',
    cssFamily: 'dxfv BIZ UDGothic',
    displayName: 'BIZ UDGothic',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['MS Gothic', 'ＭＳ ゴシック', 'MS UI Gothic', 'Osaka-Mono', 'SHX big fonts (extfont, extfont2, bigfont)'],
    core: true,
  },
  {
    id: 'biz-udpgothic',
    cssFamily: 'dxfv BIZ UDPGothic',
    displayName: 'BIZ UDPGothic',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['MS PGothic', 'ＭＳ Ｐゴシック'],
  },
  {
    id: 'biz-udmincho',
    cssFamily: 'dxfv BIZ UDMincho',
    displayName: 'BIZ UDMincho',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['MS Mincho', 'ＭＳ 明朝'],
  },
  {
    id: 'biz-udpmincho',
    cssFamily: 'dxfv BIZ UDPMincho',
    displayName: 'BIZ UDPMincho',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['MS PMincho', 'ＭＳ Ｐ明朝'],
  },
  {
    id: 'noto-sans-jp',
    cssFamily: 'dxfv Noto Sans JP',
    displayName: 'Noto Sans JP',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['Meiryo', 'メイリオ', 'Yu Gothic', '游ゴシック', 'HG Gothic', 'Hiragino Sans'],
  },
  {
    id: 'noto-serif-jp',
    cssFamily: 'dxfv Noto Serif JP',
    displayName: 'Noto Serif JP',
    weights: [400, 700],
    styles: ['normal'],
    substitutes: ['Yu Mincho', '游明朝', 'HG Mincho', 'Hiragino Mincho'],
  },
  {
    id: 'arimo',
    cssFamily: 'dxfv Arimo',
    displayName: 'Arimo',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    substitutes: ['Arial', 'Helvetica', 'Arial Narrow (scaled)', 'Segoe UI'],
    core: true,
  },
  {
    id: 'tinos',
    cssFamily: 'dxfv Tinos',
    displayName: 'Tinos',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    substitutes: ['Times New Roman', 'Century'],
  },
  {
    id: 'cousine',
    cssFamily: 'dxfv Cousine',
    displayName: 'Cousine',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    substitutes: ['Courier New', 'Consolas'],
  },
  {
    id: 'carlito',
    cssFamily: 'dxfv Carlito',
    displayName: 'Carlito',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    substitutes: ['Calibri'],
  },
  {
    id: 'caladea',
    cssFamily: 'dxfv Caladea',
    displayName: 'Caladea',
    weights: [400, 700],
    styles: ['normal', 'italic'],
    substitutes: ['Cambria'],
  },
];
