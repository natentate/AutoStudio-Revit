// Roof solids. Flat roofs extrude their footprint; pitched roofs (gable, hip,
// shed) are built over the footprint's bounding rectangle as closed solids made
// of planar faces, each a list of {x, y, z} with z relative to the roof base.

import { bbox } from './geometry.js';

export const ROOF_SHAPES = ['flat', 'gable', 'hip', 'shed'];

/** Faces for a pitched roof, ordered counter-clockwise when seen from outside. */
export function pitchedRoofFaces(points, shape, slopeDeg) {
  const { minX, minY, maxX, maxY } = bbox(points);
  const W = maxX - minX;
  const D = maxY - minY;
  const tan = Math.tan((Math.max(1, Math.min(75, slopeDeg)) * Math.PI) / 180);
  const P = (x, y, z) => ({ x, y, z });

  // Work in a frame where the ridge runs along local X (the longer side).
  const alongX = W >= D;
  const L = alongX ? W : D;
  const S = alongX ? D : W;
  const toWorld = (u, v, z) => (alongX ? P(minX + u, minY + v, z) : P(minX + v, minY + u, z));
  const mapFace = (f) => {
    const pts = f.map(([u, v, z]) => toWorld(u, v, z));
    // Swapping axes mirrors the frame, which flips winding.
    return alongX ? pts : pts.reverse();
  };

  let faces;
  if (shape === 'shed') {
    const h = S * tan;
    faces = [
      [[0, 0, 0], [L, 0, 0], [L, S, h], [0, S, h]], // slope
      [[0, S, 0], [0, S, h], [L, S, h], [L, S, 0]], // high wall
      [[0, 0, 0], [0, S, h], [0, S, 0]], // west end
      [[L, 0, 0], [L, S, 0], [L, S, h]], // east end
      [[0, 0, 0], [0, S, 0], [L, S, 0], [L, 0, 0]], // bottom
    ];
  } else if (shape === 'hip') {
    const h = (S / 2) * tan;
    const r0 = S / 2;
    const r1 = L - S / 2;
    faces = [
      [[0, 0, 0], [L, 0, 0], [r1, S / 2, h], [r0, S / 2, h]], // south slope
      [[L, S, 0], [0, S, 0], [r0, S / 2, h], [r1, S / 2, h]], // north slope
      [[0, S, 0], [0, 0, 0], [r0, S / 2, h]], // west hip
      [[L, 0, 0], [L, S, 0], [r1, S / 2, h]], // east hip
      [[0, 0, 0], [0, S, 0], [L, S, 0], [L, 0, 0]], // bottom
    ].map((f) => f.filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1], p[2] - arr[i - 1][2]) > 1e-6));
  } else {
    // gable
    const h = (S / 2) * tan;
    faces = [
      [[0, 0, 0], [L, 0, 0], [L, S / 2, h], [0, S / 2, h]],
      [[L, S, 0], [0, S, 0], [0, S / 2, h], [L, S / 2, h]],
      [[0, S, 0], [0, 0, 0], [0, S / 2, h]],
      [[L, 0, 0], [L, S, 0], [L, S / 2, h]],
      [[0, 0, 0], [0, S, 0], [L, S, 0], [L, 0, 0]],
    ];
  }
  return faces.filter((f) => f.length >= 3).map(mapFace);
}

/** Height of the roof ridge above its base. */
export function roofRise(points, shape, slopeDeg, thickness) {
  if (shape === 'flat') return thickness;
  const { minX, minY, maxX, maxY } = bbox(points);
  const S = Math.min(maxX - minX, maxY - minY);
  const tan = Math.tan((Math.max(1, Math.min(75, slopeDeg)) * Math.PI) / 180);
  return shape === 'shed' ? S * tan : (S / 2) * tan;
}
