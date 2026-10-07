import * as THREE from "three";

// All lengths in millimetres. Package envelope follows the MM20 datasheet drawing
// (3.350 × 2.500 × 1.300); every internal dimension below is ILLUSTRATIVE (conceptual architecture),
// with layer thicknesses exaggerated so they are visible.
export const L = 3.35; // package length (x)
export const W = 2.5; // package width (z)
export const H = 1.3; // package height (y)
export const T_SUB = 0.2; // substrate thickness (illustrative)
export const WALL = 0.08; // can wall thickness (illustrative)
export const PORT_X = -L / 2 + 1.08; // datasheet: port centre 1.080 mm from the top edge
export const PORT_R = 0.485; // illustrative hole radius (drawing shows Ø0.450 / Ø0.970 / Ø1.478 rings)
export const RING_R = 1.478 / 2;
export const DIE_SIZE = 1.1;
export const DIE_BORE_R = 0.35;
export const DIE_T = 0.35;
export const DIAPHRAGM_R = 0.42;
export const DIAPHRAGM_T = 0.02;
export const GAP_T = 0.05;
export const BACKPLATE_T = 0.05;

export const Y_DIE_TOP = T_SUB + DIE_T; // 0.55
export const Y_DIAPHRAGM = Y_DIE_TOP + DIAPHRAGM_T / 2;
export const Y_GAP = Y_DIE_TOP + DIAPHRAGM_T + GAP_T / 2;
export const Y_BACKPLATE = Y_DIE_TOP + DIAPHRAGM_T + GAP_T + BACKPLATE_T / 2;

export const INNER_H = H - T_SUB - WALL;

/** Rect with an optional circular hole, extruded along +Y (shape lies in the XZ plane). */
export function slabWithHole(
  sizeX: number,
  sizeZ: number,
  hole: { x: number; z: number; r: number } | null,
  height: number,
  cx = 0,
  cz = 0,
): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(cx - sizeX / 2, -(cz - sizeZ / 2));
  s.lineTo(cx + sizeX / 2, -(cz - sizeZ / 2));
  s.lineTo(cx + sizeX / 2, -(cz + sizeZ / 2));
  s.lineTo(cx - sizeX / 2, -(cz + sizeZ / 2));
  s.closePath();
  if (hole) {
    const h = new THREE.Path();
    h.absarc(hole.x, -hole.z, hole.r, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 40 });
  g.rotateX(-Math.PI / 2); // shape-y → -z, extrusion → +y
  return g;
}

/** Disc with a set of small circular holes, extruded along +Y. */
export function perforatedDisc(radius: number, holes: { x: number; z: number; r: number }[], height: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, radius, 0, Math.PI * 2, false);
  for (const h of holes) {
    const p = new THREE.Path();
    p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true);
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Hex-ish pattern: 1 + 6 + 12 holes. Illustrative only. */
export const PERFORATION_HOLES: { x: number; z: number; r: number }[] = (() => {
  const out = [{ x: 0, z: 0, r: 0.035 }];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    out.push({ x: 0.14 * Math.cos(a), z: 0.14 * Math.sin(a), r: 0.035 });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    out.push({ x: 0.27 * Math.cos(a), z: 0.27 * Math.sin(a), r: 0.035 });
  }
  return out;
})();

export interface PartStyle {
  color: string;
  /** Exploded-view displacement along Y at slider = 1. */
  explodeY: number;
  /** Optional exploded-view displacement along X. */
  explodeX?: number;
  /** World label anchor (before explosion offset). */
  labelAt: [number, number, number];
}

export const PART_STYLE: Record<string, PartStyle> = {
  "comp.package": { color: "#8895a7", explodeY: 0, labelAt: [-1.3, 0.1, 1.25] },
  "comp.lid": { color: "#b7c0cc", explodeY: 2.2, labelAt: [1.2, H, 1.25] },
  "comp.port": { color: "#2dd4bf", explodeY: -0.45, labelAt: [PORT_X, -0.25, 0.9] },
  "comp.cavity": { color: "#60a5fa", explodeY: 0, labelAt: [0.95, 1.0, 0] },
  "comp.die": { color: "#5b6b82", explodeY: 0.35, labelAt: [PORT_X - 0.75, 0.4, 0.6] },
  "comp.diaphragm": { color: "#f59e0b", explodeY: 0.8, labelAt: [PORT_X - 0.75, Y_DIAPHRAGM, 0.35] },
  "comp.airgap": { color: "#93c5fd", explodeY: 1.2, labelAt: [PORT_X - 0.75, Y_GAP, 0.2] },
  "comp.backplate": { color: "#a78bfa", explodeY: 1.6, labelAt: [PORT_X - 0.75, Y_BACKPLATE, 0.05] },
  "comp.perforations": { color: "#111827", explodeY: 1.6, labelAt: [PORT_X + 0.2, Y_BACKPLATE + 0.1, 0.5] },
  "comp.asic": { color: "#374151", explodeY: 0.35, explodeX: 0.35, labelAt: [0.7, 0.55, 0.6] },
  "comp.bondwires": { color: "#fbbf24", explodeY: 0.95, labelAt: [0.25, 0.75, 0.3] },
  "comp.pads": { color: "#d4a017", explodeY: -0.8, labelAt: [1.25, -0.3, 0.95] },
};
