import { aciToRgb, transparencyToAlpha } from '../dxf/colors';
import { headerNumber } from '../dxf/parser';
import { nameKey, type DxfDocument, type Entity, type Layer } from '../dxf/model';

export interface SceneLayer {
  name: string;
  /** resolved color */
  rgb: number;
  /** ACI 7: follows the background (white on dark, black on light) */
  fg: boolean;
  aci: number;
  trueColor?: number;
  linetype: string;
  lineweight: number;
  /** state from the file */
  fileOn: boolean;
  fileFrozen: boolean;
  locked: boolean;
  plot: boolean;
  alpha: number;
  /** true if referenced but not defined in the LAYER table */
  undefinedInFile: boolean;
  /** properties replaced by a layer state */
  overridden?: boolean;
  /** entities (top-level and nested) using this effective layer */
  count: number;
}

export interface Style {
  layer: number;
  rgb: number;
  fg: boolean;
  /** lineweight in 1/100 mm (resolved, >= 0) */
  lw: number;
  /** linetype index, -1 = continuous */
  lt: number;
  /** effective linetype scale */
  lts: number;
  alpha: number;
  /** index of the INSERT layer chain (for frozen-layer inheritance) */
  chain: number;
}

export function styleKey(s: Style): string {
  return `${s.layer}|${s.rgb}|${s.fg ? 1 : 0}|${s.lw}|${s.lt}|${s.lt < 0 ? 1 : s.lts.toPrecision(5)}|${s.alpha}|${s.chain}`;
}

/** Inherited properties from an enclosing INSERT/DIMENSION (BYBLOCK / layer 0). */
export interface InheritCtx {
  /** effective layer name of the block reference, null at top level */
  layer: string | null;
  rgb: number;
  fg: boolean;
  linetype: string;
  lw: number;
  alpha: number;
  /** extra linetype scale factor from block scaling */
  ltsFactor: number;
  chain: number;
}

/** Layer property replacements (e.g. from a layer state); keyed by nameKey(layer). */
export interface LayerOverride {
  color?: number;
  /** null: drop the file's true color */
  trueColor?: number | null;
  linetype?: string;
  lineweight?: number;
  alpha?: number;
}

export const TOP_CTX: InheritCtx = { layer: null, rgb: 0xffffff, fg: true, linetype: 'CONTINUOUS', lw: -3, alpha: 1, ltsFactor: 1, chain: 0 };

export class StyleResolver {
  readonly layers: SceneLayer[] = [];
  private layerIndex = new Map<string, number>();
  readonly linetypes: { name: string; pattern: number[]; complex: boolean }[] = [];
  private ltIndex = new Map<string, number>();
  /** chain id → layer indices of enclosing inserts */
  readonly chains: number[][] = [[]];
  private chainIndex = new Map<string, number>([['', 0]]);
  readonly ltscale: number;
  readonly lwDefault: number;
  readonly missingLinetypes = new Set<string>();

  constructor(
    private doc: DxfDocument,
    private overrides?: Map<string, LayerOverride>,
  ) {
    for (const layer of doc.layers.values()) this.addLayer(layer, false);
    for (const lt of doc.linetypes.values()) {
      const key = nameKey(lt.name);
      if (key === 'CONTINUOUS' || key === 'BYLAYER' || key === 'BYBLOCK') continue;
      const usable = lt.pattern.length >= 2 && lt.pattern.some((v) => v !== 0);
      if (!usable) continue;
      this.ltIndex.set(key, this.linetypes.length);
      this.linetypes.push({ name: lt.name, pattern: lt.pattern, complex: lt.complex });
    }
    this.ltscale = headerNumber(doc, '$LTSCALE', 1) || 1;
    const lwd = headerNumber(doc, '$LWDEFAULT', 25);
    this.lwDefault = lwd >= 0 ? lwd : 25;
  }

  private addLayer(layer: Layer, undefinedInFile: boolean): number {
    const idx = this.layers.length;
    const o = undefinedInFile ? undefined : this.overrides?.get(nameKey(layer.name));
    const aci = o?.color ?? (Math.abs(layer.color) || 7);
    const trueColor = o?.trueColor === null ? undefined : (o?.trueColor ?? layer.trueColor);
    this.layers.push({
      name: layer.name,
      rgb: trueColor ?? aciToRgb(aci),
      fg: trueColor === undefined && aci === 7,
      aci,
      trueColor,
      linetype: o?.linetype ?? layer.linetype,
      lineweight: o?.lineweight ?? layer.lineweight,
      fileOn: layer.color >= 0,
      fileFrozen: (layer.flags & 1) !== 0,
      locked: (layer.flags & 4) !== 0,
      plot: layer.plot,
      alpha: o?.alpha ?? transparencyToAlpha(layer.transparency) ?? 1,
      undefinedInFile,
      overridden: !!o,
      count: 0,
    });
    this.layerIndex.set(nameKey(layer.name), idx);
    return idx;
  }

  layerIdx(name: string): number {
    const key = nameKey(name);
    const idx = this.layerIndex.get(key);
    if (idx !== undefined) return idx;
    return this.addLayer({ name, flags: 0, color: 7, linetype: 'CONTINUOUS', lineweight: -3, plot: true, tag: -1 }, true);
  }

  chainWith(parent: number, layer: number): number {
    const layers = [...this.chains[parent], layer];
    const key = layers.join(',');
    let id = this.chainIndex.get(key);
    if (id === undefined) {
      id = this.chains.length;
      this.chains.push(layers);
      this.chainIndex.set(key, id);
    }
    return id;
  }

  private linetypeIdx(name: string): number {
    const key = nameKey(name);
    if (key === 'CONTINUOUS' || key === '') return -1;
    const idx = this.ltIndex.get(key);
    if (idx === undefined) {
      if (!this.doc.linetypes.has(key)) this.missingLinetypes.add(name);
      return -1;
    }
    return idx;
  }

  /** Effective layer name (layer 0 inside blocks inherits the reference's layer). */
  effectiveLayer(e: Entity, ctx: InheritCtx): string {
    return e.layer === '0' && ctx.layer !== null ? ctx.layer : e.layer;
  }

  resolve(e: Entity, ctx: InheritCtx): Style {
    const layerName = this.effectiveLayer(e, ctx);
    const li = this.layerIdx(layerName);
    const layer = this.layers[li];
    let rgb: number;
    let fg = false;
    // 420 (true color) takes precedence over the approximate ACI in 62
    if (e.trueColor !== undefined && e.color !== 0) {
      rgb = e.trueColor;
    } else if (e.color === 0) {
      rgb = ctx.rgb;
      fg = ctx.fg;
    } else if (e.color === 256 || e.color === undefined) {
      rgb = layer.rgb;
      fg = layer.fg;
    } else {
      const aci = Math.abs(e.color);
      rgb = aciToRgb(aci);
      fg = aci === 7;
    }
    const ltName = e.linetype === undefined || /^bylayer$/i.test(e.linetype) ? layer.linetype : /^byblock$/i.test(e.linetype) ? ctx.linetype : e.linetype;
    let lw = e.lineweight;
    if (lw === -1) lw = layer.lineweight;
    else if (lw === -2) lw = ctx.lw;
    if (lw < 0) lw = this.lwDefault;
    let alpha = transparencyToAlpha(e.transparency);
    if (alpha === undefined) alpha = e.transparency === 0x01000000 ? ctx.alpha : layer.alpha;
    return {
      layer: li,
      rgb,
      fg,
      lw,
      lt: this.linetypeIdx(ltName),
      lts: this.ltscale * (e.ltscale || 1) * ctx.ltsFactor,
      alpha,
      chain: ctx.chain,
    };
  }

  /** Inherit context for the children of a block reference `e`. */
  childCtx(e: Entity, ctx: InheritCtx, scaleFactor: number): InheritCtx {
    const s = this.resolve(e, ctx);
    const layerName = this.effectiveLayer(e, ctx);
    let linetype = e.linetype === undefined || /^bylayer$/i.test(e.linetype) ? this.layers[s.layer].linetype : /^byblock$/i.test(e.linetype) ? ctx.linetype : e.linetype;
    if (!linetype) linetype = 'CONTINUOUS';
    return {
      layer: layerName,
      rgb: s.rgb,
      fg: s.fg,
      linetype,
      lw: s.lw,
      alpha: s.alpha,
      ltsFactor: ctx.ltsFactor * scaleFactor,
      chain: this.chainWith(ctx.chain, s.layer),
    };
  }
}
