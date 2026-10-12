import { fromAxes, identity, type Mat34 } from './matrix';
import { cross3, norm3, type Vec3 } from './vec';

const ARBITRARY_LIMIT = 1 / 64;

/**
 * Arbitrary Axis Algorithm (DXF reference): derives the OCS X/Y axes from an
 * extrusion (normal) vector.
 */
export function ocsAxes(extrusion: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = norm3(extrusion);
  const ax: Vec3 =
    Math.abs(z[0]) < ARBITRARY_LIMIT && Math.abs(z[1]) < ARBITRARY_LIMIT
      ? cross3([0, 1, 0], z)
      : cross3([0, 0, 1], z);
  const x = norm3(ax);
  const y = norm3(cross3(z, x));
  return { x, y, z };
}

export function isDefaultExtrusion(e: Vec3 | undefined): boolean {
  return !e || (Math.abs(e[0]) < 1e-12 && Math.abs(e[1]) < 1e-12 && e[2] > 0);
}

/** Matrix mapping OCS coordinates to WCS. Identity for the default +Z extrusion. */
export function ocsToWcs(extrusion: Vec3 | undefined): Mat34 {
  if (isDefaultExtrusion(extrusion)) return identity();
  const { x, y, z } = ocsAxes(extrusion!);
  return fromAxes(x, y, z);
}
