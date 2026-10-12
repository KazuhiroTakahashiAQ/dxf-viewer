import type { HatchEntity } from '../dxf/entities/hatch';
import type { DxfDocument, Entity } from '../dxf/model';
import type { Mat34 } from '../geom/matrix';
import type { Vec3 } from '../geom/vec';
import type { Projector } from './geoOut';
import type { InheritCtx, Style, StyleResolver } from './style';
import type { PlacedText, TextMeasurer } from './textLayout';

/**
 * What entity emitters need from the scene builder. Implemented twice: once
 * to build render batches and once to compute bounding boxes, so geometry
 * code is written a single time.
 */
export interface EmitHost {
  readonly doc: DxfDocument;
  readonly out: Projector;
  readonly measurer: TextMeasurer;
  readonly styles: StyleResolver;
  readonly fill: boolean;
  /** resolve the effective style of `e` and make it current */
  use(e: Entity, ctx: InheritCtx): Style;
  /** make an explicit style current */
  useStyle(st: Style): void;
  text(p: PlacedText, m: Mat34, st: Style, entity: number): void;
  hatch(h: HatchEntity, m: Mat34, st: Style, entity: number, opts: { solidColor?: number; outline?: boolean }): void;
  image(item: ImageBuild, st: Style, entity: number): void;
  infinite(base: Vec3, dir: Vec3, ray: boolean, st: Style, entity: number): void;
  point(p: Vec3, st: Style, entity: number): void;
  /** expand a block definition with matrix `m` (block coords → world) */
  block(name: string, m: Mat34, owner: Entity, ctx: InheritCtx, depth: number): boolean;
  /** emit a (virtual) child entity */
  child(e: Entity, m: Mat34, ctx: InheritCtx, depth: number): void;
  diag(code: string, message: string, handle?: string): void;
}

export interface ImageBuild {
  /** WCS corners: insert, insert+U, insert+U+V, insert+V */
  corners: Vec3[];
  /** clip polygon (WCS), if any */
  clip?: Vec3[];
  label: string;
  wipeout: boolean;
  /** referenced file name (images) */
  fileName?: string;
  /** pixel size */
  width: number;
  height: number;
}
