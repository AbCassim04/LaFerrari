import { CatmullRomCurve3, Curve, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { DIMS, type Vec3 } from '../../config/dims';
import { SEGMENTS } from '../../config/detail';
import { circlePoints, cylinderY, extrude, hull2d, lathe, merge, polygonShape, roundCorners, roundedBox, tubeAlong, type P2 } from '../../geometry/build';
import type { MeshSpec } from '../../scene/MeshSet';
import { band, boltHead } from '../engine/geometry/core';
import { compose, sideSign, type Side } from '../engine/layout';

/**
 * Milestone 2d geometry in car coordinates (left side given in DIMS, mirrored by `sx`):
 * rear subframe and bumper beam, rear suspension, discs and anti-roll bar, fuel tank.
 */

const RS = DIMS.rearSuspension;
const W = DIMS.wheel.rear;
const up = new Vector3(0, 1, 0);
const BEVEL = 0.002;

/** A DIMS point on side `s` (x mirrored). */
export const sidePoint = (p: Vec3 | readonly number[], s: Side) => new Vector3(sideSign(s) * p[0], p[1], p[2]);

/** Hub centre (car coordinates). */
export const hubCentre = (s: Side) => new Vector3(sideSign(s) * W.centreX, W.centreY, W.axleZ);

/** Cylinder from a to b. */
function rod(a: Vector3, b: Vector3, r: number, segments: number = SEGMENTS.small) {
  const d = b.clone().sub(a);
  const g = cylinderY(r, 0, d.length(), segments);
  g.applyMatrix4(compose(a, new Quaternion().setFromUnitVectors(up, d.normalize())));
  return g;
}

/**
 * Solid of revolution about the hub axis on side `s`, from an (r, d) profile where d runs
 * outboard from x0 (a rotation, not a mirror, turns it for the right side).
 */
function latheOut(profile: readonly P2[], s: Side, x0: number, segments: number = SEGMENTS.cylinder) {
  const hub = hubCentre(s);
  const g = lathe(profile, segments);
  g.rotateZ(-Math.PI / 2); // lathe axis +y → +x
  if (sideSign(s) < 0) g.rotateY(Math.PI);
  g.translate(sideSign(s) * x0, hub.y, hub.z);
  return g;
}

/** Short cylinder along z (bushes, eyes) centred on p. */
function alongZ(p: Vector3, r: number, length: number, segments: number = SEGMENTS.small) {
  const g = cylinderY(r, -length / 2, length / 2, segments);
  g.rotateX(Math.PI / 2);
  g.translate(p.x, p.y, p.z);
  return g;
}

/** Short cylinder along y from y0 to y1 at (x, z). */
function alongY(x: number, z: number, r: number, y0: number, y1: number, segments: number = SEGMENTS.small) {
  const g = cylinderY(r, y0, y1, segments);
  g.translate(x, 0, z);
  return g;
}

/**
 * A cast or plate outline in the y-z plane (points given as (z, y)), extruded across x
 * from x0 to x1. Shape coordinates are (−z, y) so the extrusion along +x keeps its winding.
 */
function plateYZ(points: readonly (readonly [number, number])[], x0: number, x1: number, bevel = BEVEL, bore?: { z: number; y: number; r: number }) {
  const outline = hull2d(points.map(([z, y]) => [-z, y] as P2));
  const holes = bore ? [{ c: [-bore.z, bore.y] as P2, r: bore.r }] : [];
  const g = extrude(polygonShape(outline, holes), Math.abs(x1 - x0), bevel);
  g.applyMatrix4(new Matrix4().set(0, 0, 1, Math.min(x0, x1), 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}

/** Circle of (z, y) points for plateYZ outlines. */
const ring = (z: number, y: number, r: number, n = 20) => circlePoints(z, y, r, n);

/**
 * Two plates either side of a pivot whose axis runs along z, reaching from an anchor
 * (a rail or arm) to the pivot. A link held between them slides straight out sideways.
 */
function clevis(anchor: Vector3, pivot: Vector3, gap: number) {
  const t = RS.clevisPlate;
  const w = RS.bushRadius * 2.2;
  const outline = hull2d([...circlePoints(anchor.x, anchor.y, w / 2, 16), ...circlePoints(pivot.x, pivot.y, w / 2, 16)]);
  return [-1, 1].map((k) => {
    const g = extrude(polygonShape(outline), t, t * 0.3);
    g.translate(0, 0, pivot.z + k * (gap / 2 + t / 2) - t / 2);
    return g;
  });
}

const smallBolt = () => boltHead(mm(6), mm(4));
const mm = (v: number) => v / 1000;

/** Instances baked into one geometry, so they merge with a mesh of the same material (one draw). */
const baked = (g: BufferGeometry, at: readonly Matrix4[]) => merge(at.map((m) => g.clone().applyMatrix4(m)));

/** Bolt heads facing along `normal` at each point. */
const boltsAt = (points: readonly Vector3[], normal: Vector3) =>
  points.map((p) => compose(p, new Quaternion().setFromUnitVectors(up, normal.clone().normalize())));

// ─── Rear subframe and bumper beam ──────────────────────────────────────────

const railPoint = (rail: readonly [number, number], z: number, s: Side) => new Vector3(sideSign(s) * rail[0], rail[1], z);

/** Chassis pivots on the subframe, per side: [rail, pivot, gap between the plates]. */
function subframePickups(s: Side) {
  const L = RS.lowerRail;
  const U = RS.upperRail;
  const lf = sidePoint(RS.lowerFront, s);
  const lr = sidePoint(RS.lowerRear, s);
  const ti = sidePoint(RS.toeInner, s);
  const ui = sidePoint(RS.upperInner, s);
  const ct = sidePoint(RS.coiloverTop, s);
  const bush = RS.bushLength;
  return [
    [railPoint(L, lf.z, s), lf, bush],
    [railPoint(L, lr.z, s), lr, bush],
    [railPoint(L, ti.z, s), ti, RS.jointRadius * 1.3],
    [railPoint(U, ui.z, s), ui, RS.jointRadius * 1.3],
    [railPoint(U, ct.z, s), ct, RS.damper.eyeRadius * 1.7],
  ] as const;
}

export function subframeMeshes(): MeshSpec[] {
  const tubes: BufferGeometry[] = [];
  const plates: BufferGeometry[] = [];
  const bolts: Matrix4[] = [];
  const collars: Matrix4[] = [];
  const [z0, z1] = RS.railZ;
  const r = RS.railRadius;
  for (const s of ['l', 'r'] as Side[]) {
    const sx = sideSign(s);
    const U = RS.upperRail;
    const L = RS.lowerRail;
    const lEnd = RS.lowerRailEnd;
    tubes.push(rod(railPoint(U, z0, s), railPoint(U, z1, s), r, SEGMENTS.small * 2));
    tubes.push(rod(railPoint(L, z0, s), railPoint(L, lEnd, s), r, SEGMENTS.small * 2));
    // Posts between the rails; the rear one rakes back from the lower rail's end.
    for (const [zl, zu] of [
      [z0, z0],
      [RS.midPostZ, RS.midPostZ],
      [lEnd, z1],
    ]) {
      tubes.push(rod(railPoint(L, zl, s), railPoint(U, zu, s), r * 0.85, SEGMENTS.small * 2));
      // Welded node collars where each post meets a rail.
      for (const [rail, z] of [
        [L, zl],
        [U, zu],
      ] as const) {
        collars.push(compose(railPoint(rail, z, s), new Quaternion().setFromUnitVectors(up, new Vector3(0, 0, 1))));
      }
    }
    // Mounting plates: bolted to the tub's bay wall at the front (full height), and at the
    // back to the model's rear frame, which only reaches down to the upper rail's level.
    const rearBottom = 0.43;
    for (const [z, face, y0] of [
      [z0, 1, L[1] - r * 1.5],
      [z1, -1, rearBottom],
    ] as const) {
      const y1 = U[1] + r * 1.5;
      const x = face > 0 ? (U[0] + L[0]) / 2 : U[0];
      const plate = roundedBox(r * 3, y1 - y0, mm(8), BEVEL);
      plate.translate(sx * x, (y0 + y1) / 2, z + face * (r + mm(4)));
      plates.push(plate);
      for (const y of face > 0 ? [L[1], (L[1] + U[1]) / 2, U[1]] : [y0 + r, U[1]]) {
        bolts.push(...boltsAt([new Vector3(sx * x + sx * r * 0.9, y, z + face * (r + mm(8)))], new Vector3(0, 0, face)));
      }
    }
    for (const [anchor, pivot, gap] of subframePickups(s)) plates.push(...clevis(anchor, pivot, gap));
  }
  const collar = lathe(band(r * 0.98, r * 1.22, -mm(14), mm(14)), SEGMENTS.small * 2);
  return [
    { geometry: merge([...tubes, ...plates, baked(collar, collars), baked(smallBolt(), bolts)]), material: 'aluminium' },
  ];
}

export function bumperBeamMeshes(): MeshSpec[] {
  const B = DIMS.bumperBeam;
  const [y0, y1] = B.y;
  const [z0, z1] = B.z;
  const beam = roundedBox(B.halfWidth * 2, y1 - y0, z1 - z0, mm(10));
  beam.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
  // Ribbed face: two shallow grooves along the beam.
  const cans: BufferGeometry[] = [];
  const bolts: Matrix4[] = [];
  for (const sx of [1, -1]) {
    const can = roundedBox(mm(76), y1 - y0 - mm(16), z1 - B.crashCanZ, mm(6));
    can.translate(sx * B.crashCanX, (y0 + y1) / 2, (B.crashCanZ + z1) / 2);
    cans.push(can);
    const flange = roundedBox(mm(110), y1 - y0 + mm(14), mm(8), mm(3));
    flange.translate(sx * B.crashCanX, (y0 + y1) / 2, B.crashCanZ - mm(4) + mm(8));
    cans.push(flange);
    for (const dx of [-1, 1]) {
      for (const dy of [-1, 1]) bolts.push(...boltsAt([new Vector3(sx * B.crashCanX + dx * mm(42), (y0 + y1) / 2 + dy * (y1 - y0 + mm(4)) / 2, B.crashCanZ + mm(12))], new Vector3(0, 0, -1)));
    }
  }
  return [{ geometry: merge([beam, ...cans, baked(smallBolt(), bolts)]), material: 'aluminium' }];
}

// ─── Upright, hub and disc ───────────────────────────────────────────────────

export function uprightMeshes(s: Side): MeshSpec[] {
  const sx = sideSign(s);
  const hub = hubCentre(s);
  const H = RS.housing;
  const Wb = RS.web;
  const lj = sidePoint(RS.lowerJoint, s);
  const uj = sidePoint(RS.upperJoint, s);
  const tj = sidePoint(RS.toeJoint, s);
  const lug = RS.caliperLugs;
  const xs = (a: number, b: number) => [sx * a, sx * b] as const;
  // Bearing housing round the hub axis, bored for the driveshaft's stub axle.
  const [hx0, hx1] = H.x;
  const housing = latheOut(
    [
      [H.bore, 0],
      [H.radius * 0.85, 0],
      [H.radius, mm(10)],
      [H.radius, hx1 - hx0 - mm(6)],
      [H.radius * 0.9, hx1 - hx0],
      [H.bore, hx1 - hx0],
    ],
    s,
    hx0,
  );
  // Cast arms from the housing to each joint and to the caliper lugs. The web is bored on
  // the hub axis like the housing (the stub axle passes through), and each arm starts
  // from the housing's rim, not its centre.
  const [wx0, wx1] = xs(...Wb.x);
  const bore = { z: hub.z, y: hub.y, r: H.bore };
  const core = ring(hub.z, hub.y, H.radius * 0.9);
  const arm = (z: number, y: number, r = Wb.armRadius) => {
    const toward = new Vector3(0, y - hub.y, z - hub.z).normalize();
    const root = H.bore + r * 0.9 + mm(3);
    return plateYZ([...ring(hub.z + toward.z * root, hub.y + toward.y * root, r * 0.9), ...ring(z, y, r)], wx0, wx1);
  };
  const web = [
    plateYZ(core, wx0, wx1, BEVEL, bore),
    arm(lj.z, lj.y),
    arm(uj.z, uj.y),
    arm(tj.z, tj.y),
    ...lug.y.map((y) => arm(lug.z, y, lug.size[1] / 2)),
  ];
  // Joint bosses: the links' eyes sit on top of (or, for the wishbone, under) them.
  const h = RS.jointHeight;
  const bosses = [
    alongY(uj.x, uj.z, RS.jointRadius * 1.05, uj.y - h * 1.4, uj.y),
    alongY(tj.x, tj.z, RS.jointRadius * 1.05, tj.y - h * 1.4, tj.y),
    alongY(lj.x, lj.z, RS.jointRadius * 1.05, lj.y, lj.y + h * 1.4),
  ];
  // Caliper lugs out to the caliper's inboard face.
  const [lx0, lx1] = xs(...lug.x);
  const lugs = lug.y.map((y) => {
    const g = roundedBox(Math.abs(lx1 - lx0), lug.size[1], lug.size[0], BEVEL);
    g.translate((lx0 + lx1) / 2, y, lug.z);
    return g;
  });
  // Hub: barrel and flange outboard of the housing (the disc's bell bolts to it).
  const Hb = RS.hub;
  const [bx0, bx1] = Hb.x;
  const hubG = latheOut(
    [
      [0.03, 0],
      [Hb.radius, 0],
      [Hb.radius, bx1 - bx0 - Hb.flange],
      [Hb.flangeRadius, bx1 - bx0 - Hb.flange],
      [Hb.flangeRadius, bx1 - bx0],
      [0.03, bx1 - bx0],
    ],
    s,
    bx0,
  );
  return [
    { geometry: merge([...web, ...bosses, ...lugs, housing, hubG]), material: 'castAluminium' },
  ];
}

export function discMeshes(s: Side): MeshSpec[] {
  const sx = sideSign(s);
  const hub = hubCentre(s);
  const D = RS.disc;
  const R = W.discDiameter / 2;
  const [x0, x1] = D.x;
  const plateT = (x1 - x0 - D.vaneGap) / 2;
  // Two friction plates with the ventilation gap between.
  const ringAt = (a: number, b: number) => latheOut([[D.innerRadius, 0], [R, 0], [R, b - a], [D.innerRadius, b - a], [D.innerRadius, 0]], s, a, SEGMENTS.wheel);
  const plates = [ringAt(x0, x0 + plateT), ringAt(x1 - plateT, x1)];
  // Bell: a short cylinder from the friction ring's inner edge out to the face on the hub
  // (profile anticlockwise in (r, d), like every lathe here, so the faces point outward).
  const B = D.bell;
  const [bx0, bx1] = B.x;
  const bell = latheOut(
    [
      [B.boreRadius, bx1 - bx0],
      [B.boreRadius, bx1 - bx0 - B.face],
      [B.radius - mm(4), bx1 - bx0 - B.face],
      [B.radius - mm(4), 0],
      [B.radius, 0],
      [B.radius, bx1 - bx0],
      [B.boreRadius, bx1 - bx0],
    ],
    s,
    bx0,
  );
  // Vanes between the plates, cross-drilled holes through both, bobbins joining ring and bell.
  const vaneX = sx * (x0 + x1) / 2;
  const radial = (angle: number, r: number) => new Vector3(vaneX, hub.y + r * Math.cos(angle), hub.z + r * Math.sin(angle));
  const vane = roundedBox(D.vaneGap + mm(1), R - D.innerRadius - mm(8), mm(4), 0.0005);
  const vanes = Array.from({ length: D.vanes }, (_, k) => {
    const a = (k / D.vanes) * Math.PI * 2;
    return compose(radial(a, (R + D.innerRadius) / 2), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), a));
  });
  const hole = cylinderY(D.holeRadius, -(x1 - x0) / 2 - mm(0.4), (x1 - x0) / 2 + mm(0.4), 8);
  const toX = new Quaternion().setFromUnitVectors(up, new Vector3(1, 0, 0));
  const holes = D.holeRings.flatMap((r, ring) =>
    Array.from({ length: D.holesPerRing }, (_, k) => compose(radial(((k + ring / D.holeRings.length) / D.holesPerRing) * Math.PI * 2, r), toX)),
  );
  const bobbin = cylinderY(mm(7), -mm(5), mm(5), 10);
  const bobbins = Array.from({ length: B.bolts }, (_, k) => {
    const a = (k / B.bolts) * Math.PI * 2;
    return compose(new Vector3(sx * (bx0 + mm(4)), hub.y + (D.innerRadius - mm(2)) * Math.cos(a), hub.z + (D.innerRadius - mm(2)) * Math.sin(a)), toX);
  });
  return [
    { geometry: merge([...plates, baked(vane, vanes)]), material: 'ceramic' },
    { geometry: hole, material: 'satinBlack', instances: holes },
    { geometry: merge([bell, baked(bobbin, bobbins)]), material: 'aluminium' },
  ];
}

// ─── Links, wishbone, coilover ───────────────────────────────────────────────

/** Ball-joint housing (vertical axis) with its top or bottom face at y. */
const jointHousing = (p: Vector3, below: boolean) =>
  alongY(p.x, p.z, RS.jointRadius, below ? p.y - RS.jointHeight : p.y, below ? p.y : p.y + RS.jointHeight);

/** Where the anti-roll bar's drop link meets the wishbone's rear leg (on its centreline). */
function wishboneTab(s: Side) {
  const lr = sidePoint(RS.lowerRear, s);
  const lj = sidePoint(RS.lowerJoint, s);
  const jc = lj.setY(lj.y - RS.jointHeight / 2);
  const arb = sidePoint(RS.antiRollBar.armEnd, s);
  return lr.clone().lerp(jc, (arb.z - lr.z) / (jc.z - lr.z));
}

export function lowerWishboneMeshes(s: Side): MeshSpec[] {
  const lj = sidePoint(RS.lowerJoint, s);
  const lf = sidePoint(RS.lowerFront, s);
  const lr = sidePoint(RS.lowerRear, s);
  const cb = sidePoint(RS.coiloverBottom, s);
  const arb = sidePoint(RS.antiRollBar.armEnd, s);
  const jc = lj.clone().setY(lj.y - RS.jointHeight / 2);
  const legs = [rod(lf, jc, RS.armRadius), rod(lr, jc, RS.armRadius)];
  const housing = jointHousing(lj, true);
  const bushes = [lf, lr].map((p) => alongZ(p, RS.bushRadius, RS.bushLength));
  const sleeves = [lf, lr].map((p) => alongZ(p, RS.bushRadius * 0.45, RS.bushLength + mm(6)));
  // Coilover clevis on the rear leg, and the anti-roll bar's drop-link tab.
  const onLeg = (t: number) => lr.clone().lerp(jc, t);
  const legT = (cb.z - lr.z) / (jc.z - lr.z);
  const clev = clevis(onLeg(legT), cb, RS.damper.eyeRadius * 1.7);
  const tabAt = onLeg((arb.z - lr.z) / (jc.z - lr.z));
  const tab = roundedBox(mm(26), mm(6), mm(22), BEVEL);
  tab.translate(tabAt.x, tabAt.y - RS.armRadius, tabAt.z);
  // Bush housings in the arm's steel (the rubber is inside them).
  return [{ geometry: merge([...legs, ...clev, tab, housing, ...sleeves, ...bushes]), material: 'steel' }];
}

/** Straight link: rod end on a z-axis eye at the chassis end, an eye on the upright's boss outboard. */
function straightLink(inner: Vector3, outer: Vector3): MeshSpec[] {
  const eyeOut = jointHousing(outer, false);
  const outerC = outer.clone().setY(outer.y + RS.jointHeight / 2);
  const eyeIn = alongZ(inner, RS.jointRadius * 0.75, RS.jointRadius * 1.2);
  const ball = alongZ(inner, RS.jointRadius * 0.35, RS.jointRadius * 1.5);
  const d = outerC.clone().sub(inner).normalize();
  const rodG = rod(inner.clone().addScaledVector(d, RS.jointRadius * 0.6), outerC.clone().addScaledVector(d, -RS.jointRadius * 0.8), RS.linkRadius);
  // Lock nut near the inner end (adjustable length).
  const nut = rod(inner.clone().addScaledVector(d, RS.jointRadius * 1.0), inner.clone().addScaledVector(d, RS.jointRadius * 1.0 + mm(10)), RS.linkRadius * 1.5, 6);
  return [{ geometry: merge([rodG, nut, eyeOut, eyeIn, ball]), material: 'steel' }];
}

export const upperLinkMeshes = (s: Side) => straightLink(sidePoint(RS.upperInner, s), sidePoint(RS.upperJoint, s));
export const toeLinkMeshes = (s: Side) => straightLink(sidePoint(RS.toeInner, s), sidePoint(RS.toeJoint, s));

/** Helix along +y from y = 0 to `length`. */
class Helix extends Curve<Vector3> {
  constructor(
    private readonly r: number,
    private readonly length: number,
    private readonly coils: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new Vector3()) {
    const a = t * this.coils * Math.PI * 2;
    return target.set(this.r * Math.cos(a), t * this.length, this.r * Math.sin(a));
  }
}

export function coiloverMeshes(s: Side): MeshSpec[] {
  const bottom = sidePoint(RS.coiloverBottom, s);
  const top = sidePoint(RS.coiloverTop, s);
  const C = RS.damper;
  const S = RS.spring;
  const axis = top.clone().sub(bottom);
  const length = axis.length();
  const q = new Quaternion().setFromUnitVectors(up, axis.clone().normalize());
  const pose = compose(bottom, q);
  const eyeR = C.eyeRadius;
  // Damper body from the lower eye, shaft up to the top eye; spring between two seats.
  const bodyLen = length * 0.5;
  const body = lathe([[0, eyeR], [C.radius, eyeR], [C.radius, bodyLen], [C.radius * 0.6, bodyLen + mm(6)], [0, bodyLen + mm(6)]]);
  const shaft = lathe([[0, bodyLen], [C.shaftRadius, bodyLen], [C.shaftRadius, length - eyeR], [0, length - eyeR]], SEGMENTS.small);
  const seatLow = lathe(band(C.radius * 0.9, S.radius * 1.25, eyeR + mm(40), eyeR + mm(46)));
  const springStart = eyeR + mm(46);
  const springLen = Math.min(S.length, length - springStart - eyeR - mm(14));
  const seatHigh = lathe(band(C.shaftRadius, S.radius * 1.25, springStart + springLen, springStart + springLen + mm(8)));
  const spring = tubeAlong(new Helix(S.radius, springLen, S.coils), S.wire, false, S.coils * SEGMENTS.springCoil * 2, 8);
  spring.translate(0, springStart, 0);
  const knob = lathe(band(0, C.radius * 0.55, eyeR - mm(2), eyeR + mm(8)), SEGMENTS.small);
  for (const g of [body, shaft, seatLow, seatHigh, spring, knob]) g.applyMatrix4(pose);
  // Eyes (axis along z) at both ends.
  const eyes = [bottom, top].map((p) => alongZ(p, eyeR, eyeR * 1.6));
  return [
    { geometry: merge([body, seatLow, seatHigh, knob, shaft, ...eyes]), material: 'aluminium' },
    { geometry: spring, material: 'satinBlack' },
  ];
}

// ─── Anti-roll bar ───────────────────────────────────────────────────────────

export function antiRollBarMeshes(): MeshSpec[] {
  const A = RS.antiRollBar;
  const end = (sx: number) => new Vector3(sx * A.armEnd[0], A.armEnd[1], A.armEnd[2]);
  const corner = (sx: number) => new Vector3(sx * A.halfWidth, A.y, A.z);
  const bend = (sx: number) => new Vector3(sx * (A.halfWidth - 0.04), A.y, A.z);
  const curve = new CatmullRomCurve3(
    [end(-1), end(-1).lerp(corner(-1), 0.5), corner(-1), bend(-1), bend(1), corner(1), end(1).lerp(corner(1), 0.5), end(1)],
    false,
    'centripetal',
  );
  const bar = tubeAlong(curve, A.radius, false, 96, 12);
  // Bushes in clamps on the subframe, and a drop link from each arm up to its wishbone.
  const bushes = [-1, 1].map((sx) => {
    const g = cylinderY(A.radius * 1.9, -mm(16), mm(16), SEGMENTS.small);
    g.rotateZ(Math.PI / 2);
    g.translate(sx * A.bushX, A.y, A.z);
    return g;
  });
  const clamps = [-1, 1].flatMap((sx) => {
    const rail = new Vector3(sx * RS.lowerRail[0], RS.lowerRail[1], RS.lowerRailEnd);
    const at = new Vector3(sx * A.bushX, A.y, A.z);
    return [rod(at, rail, mm(6), 10), lathe(band(A.radius * 1.9, A.radius * 2.4, -mm(12), mm(12)), SEGMENTS.small).rotateZ(Math.PI / 2).translate(at.x, at.y, at.z)];
  });
  // Drop links: from each arm's end up to the tab under the wishbone's rear leg.
  const drops = (['l', 'r'] as Side[]).map((s) => {
    const a = sidePoint(A.armEnd, s);
    const top = wishboneTab(s);
    return rod(a, top.setY(top.y - RS.armRadius - mm(3)), mm(5), 10);
  });
  return [{ geometry: merge([bar, ...bushes, ...clamps, ...drops]), material: 'satinBlack' }];
}

// ─── Fuel tank and pump ──────────────────────────────────────────────────────

const FT = DIMS.fuelTank;

/**
 * Tank section in shape space (−z, y), anticlockwise, with rounded corners, grown by `d`
 * (the straps). (−z keeps the first coordinate positive, which roundCorners expects.)
 */
function tankSection(d = 0): P2[] {
  const [[yb, zbf], [, zbr], [yt, ztr], [, ztf]] = FT.section;
  const pts: P2[] = [
    [-zbf - d, yb - d],
    [-zbr + d, yb - d],
    [-ztr + d, yt + d],
    [-ztf - d, yt + d],
  ];
  return roundCorners([...pts, pts[0], pts[1]], FT.corner + d, 6).slice(1, -1);
}

/** Extrusion across x of a shape-space (−z, y) outline. */
function prismYZ(outline: readonly P2[], x0: number, x1: number, bevel: number) {
  const g = extrude(polygonShape(outline), x1 - x0, bevel);
  g.applyMatrix4(new Matrix4().set(0, 0, 1, x0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}

export function fuelTankMeshes(): MeshSpec[] {
  const tank = prismYZ(tankSection(), -FT.halfWidth, FT.halfWidth, mm(18));
  const straps = FT.strapX.map((x) => prismYZ(tankSection(FT.strap.thickness), x - FT.strap.width / 2, x + FT.strap.width / 2, mm(1)));
  // Tabs from the straps up to the tub's upper rear structure.
  const top = FT.section[2][0];
  const tabs = FT.strapX.map((x) => {
    const g = roundedBox(FT.strap.width, mm(40), mm(8), mm(1.5));
    g.translate(x, top + mm(20), FT.section[2][1] + mm(30));
    return g;
  });
  const F = FT.filler;
  const neck = alongY(F.x, F.z, F.radius, top - mm(10), top + F.height * 0.8, SEGMENTS.small * 2);
  const cap = alongY(F.x, F.z, F.radius * 1.3, top + F.height * 0.8, top + F.height, SEGMENTS.small * 2);
  return [
    // Painted straps, black like the tank.
    { geometry: merge([tank, cap, ...straps, ...tabs, neck]), material: 'satinBlack' },
  ];
}

/**
 * Fuel pump outlets (car coordinates): vertical quick-connect nipples, right then left, so
 * the lines (riding the engine) pull straight off them as the powertrain lifts.
 */
export function fuelPumpOutlets() {
  const P = FT.pump;
  const top = FT.section[2][0] + P.height;
  return [-1, 1].map((k) => ({ at: new Vector3(P.x + k * mm(16), top + mm(18), P.z), dir: new Vector3(0, 1, 0) }));
}

/**
 * Rigid feed line from a pump outlet to a fuel rail's inlet, in engine coordinates (it
 * rides the rail): quick-connect sleeves at both ends, the pump end open once lifted off.
 */
export function fuelLineMeshes(s: Side, inlet: { at: Vector3; dir: Vector3 }): MeshSpec[] {
  const o = new Vector3(...DIMS.engine.origin);
  const L = DIMS.fuelLine;
  const outlet = fuelPumpOutlets()[s === 'l' ? 1 : 0];
  const a = outlet.at.clone().sub(o);
  const b = inlet.at;
  const via = L.via.map(([x, y, z]) => new Vector3(sideSign(s) * mm(16) + x, y, z).sub(o));
  const curve = new CatmullRomCurve3(
    [a, a.clone().addScaledVector(outlet.dir, mm(30)), ...via, b.clone().addScaledVector(inlet.dir, mm(30)), b],
    false,
    'centripetal',
  );
  const line = tubeAlong(curve, L.radius, false, 64, 10);
  const sleeve = (p: Vector3, dir: Vector3, back: number) => {
    const g = cylinderY(L.radius * 1.7, -back, mm(14), SEGMENTS.small);
    g.applyMatrix4(compose(p, new Quaternion().setFromUnitVectors(up, dir)));
    return g;
  };
  return [
    { geometry: merge([line, sleeve(a, outlet.dir, mm(10)), sleeve(b, inlet.dir, mm(6))]), material: 'darkSteel' },
  ];
}

export function fuelPumpMeshes(): MeshSpec[] {
  const P = FT.pump;
  const top = FT.section[2][0];
  const flange = alongY(P.x, P.z, P.radius, top - mm(2), top + mm(8), SEGMENTS.cylinder);
  const body = alongY(P.x, P.z, P.radius * 0.72, top + mm(8), top + P.height, SEGMENTS.cylinder);
  const nipples = fuelPumpOutlets().map(({ at, dir }) => rod(at.clone().addScaledVector(dir, -mm(26)), at, mm(4), 12));
  const connector = roundedBox(mm(30), mm(14), mm(22), mm(2));
  connector.translate(P.x - mm(30), top + P.height + mm(4), P.z + mm(10));
  const bolts = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2;
    return compose(new Vector3(P.x + (P.radius - mm(7)) * Math.cos(a), top + mm(8), P.z + (P.radius - mm(7)) * Math.sin(a)), new Quaternion());
  });
  return [
    { geometry: merge([flange, body, connector, ...nipples, baked(smallBolt(), bolts)]), material: 'aluminium' },
  ];
}
