import { BufferAttribute, CatmullRomCurve3, Color, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { DIMS } from '../../../config/dims';
import { SEGMENTS } from '../../../config/detail';
import {
  cylinderY,
  cylinderZ,
  lathe,
  loft,
  merge,
  roundedBox,
  sweep,
  tube,
  tubeAlong,
  type P2,
} from '../../../geometry/build';
import type { MeshSpec } from '../../../scene/MeshSet';
import { collectorMouth, exhaustPort, primaries } from '../exhaustLayout';
import { bankOutboard, bankPoint, bankQuat, compose, CYLINDERS, headDeckA, headZ, sideSign, type Side } from '../layout';
import { band, boltHead } from './core';

/** Intake, fuel, exhaust and electronics (engine coordinates). */

const E = DIMS.engine;
const up = new Vector3(0, 1, 0);

/** Superellipse: 1 at the centre falling to 0 at |u| = 1. */
const sEllipse = (u: number, p: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(u)), p)), 1 / p);

/** Pose a geometry modelled along +y so that +y follows `dir`, at `at`. */
const along = (at: Vector3, dir: Vector3) => compose(at, new Quaternion().setFromUnitVectors(up, dir.clone().normalize()));

const smallBolt = () => boltHead(E.block.bolt.radius * 0.7, E.block.bolt.height * 0.8);

/** `n` bolt heads on a circle of radius r round `centre`, in the plane normal to q's +y. */
function flangeBolts(centre: Vector3, r: number, n: number, q: Quaternion) {
  const u = new Vector3(1, 0, 0).applyQuaternion(q);
  const v = new Vector3(0, 0, 1).applyQuaternion(q);
  return Array.from({ length: n }, (_, k) => {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    return compose(centre.clone().addScaledVector(u, r * Math.cos(a)).addScaledVector(v, r * Math.sin(a)), q);
  });
}

// ─── Plenum cover ────────────────────────────────────────────────────────────

const P = E.plenum;
const plenumZ = { front: E.frontZ - P.frontGap, rear: P.rearZ };

/** Crown height above the base at (x, station factor) including flutes and the centre groove. */
function crown(x: number, w: number, h: number) {
  if (w <= 0) return 0;
  const shoulder = sEllipse(x / w, P.sectionPower);
  let y = h * (P.skirt + (1 - P.skirt) * shoulder);
  const scale = w / P.halfWidth;
  const g = P.centreGroove;
  if (Math.abs(x) < (g.width * scale) / 2) y -= g.depth * scale * Math.cos((Math.PI * x) / (g.width * scale)) ** 2;
  const f = P.flutes;
  for (let m = 0; m < f.perSide; m++) {
    const c = (g.width / 2 + f.pitch * (m + 0.6)) * scale;
    for (const cx of [c, -c]) {
      const d = x - cx;
      if (Math.abs(d) < (f.width * scale) / 2) y -= f.depth * scale * Math.cos((Math.PI * d) / (f.width * scale)) ** 2;
    }
  }
  return y;
}

export function plenumMeshes(): MeshSpec[] {
  const stations = SEGMENTS.loftStations;
  const across = SEGMENTS.loftSection;
  const len = plenumZ.front - plenumZ.rear;
  const H = P.topY - P.baseY;
  const top: Vector3[][] = [];
  const bottom: Vector3[][] = [];
  const seam: Vector3[] = [];
  for (let i = 0; i <= stations; i++) {
    // Front to rear (keeps the faces outward); cosine spacing packs stations into the rounded ends.
    const u = Math.cos((Math.PI * i) / stations);
    const z = plenumZ.rear + ((u + 1) / 2) * len;
    const w = P.halfWidth * sEllipse(u, P.endPower);
    const h = H * Math.pow(sEllipse(u, P.endPower), 0.35);
    const ring: Vector3[] = [];
    const base: Vector3[] = [];
    for (let j = 0; j <= across; j++) {
      // Side wall first, then over the crown; cosine spacing in x keeps the shoulders smooth.
      const x = w * Math.cos((Math.PI * j) / across);
      ring.push(new Vector3(x, P.baseY + crown(x, w, h), z));
      base.push(new Vector3(-x, P.baseY, z));
    }
    // Close the side walls down to the base at both edges.
    top.push([new Vector3(w, P.baseY, z), ...ring, new Vector3(-w, P.baseY, z)]);
    bottom.push(base);
    if (Math.abs(u) < 0.97) seam.push(new Vector3(0, P.baseY + crown(0, w, h) + P.seamRadius * 0.4, z));
  }
  const planUv = (p: Vector3): [number, number] => [p.x, p.z];
  const shell = merge([loft(top, false, planUv), loft(bottom, false, planUv)]);
  const seamTube = tube(seam, P.seamRadius);
  return [
    { geometry: shell, material: 'carbonGloss' },
    { geometry: seamTube, material: 'redAccent' },
  ];
}

// ─── Runners, throttle bodies, intake tubes, airboxes, fuel rails ────────────

export function runnerMeshes(s: Side): MeshSpec[] {
  const R = E.runner;
  const h = R.topY - R.bottomY;
  const profile: P2[] = [
    [0, 0],
    [R.flangeRadius, 0],
    [R.flangeRadius, R.flangeThickness],
    [R.radius, R.flangeThickness],
    [R.radius, h - R.bellHeight],
    [R.radius + (R.bellRadius - R.radius) * 0.35, h - R.bellHeight * 0.35],
    [R.bellRadius, h],
    [R.bellRadius - R.flangeThickness / 2, h],
    [0, h - R.flangeThickness],
  ];
  const poses = E.boreZ[s].map((z) => new Matrix4().makeTranslation(sideSign(s) * R.x, R.bottomY, z));
  return [{ geometry: lathe(profile, SEGMENTS.small * 2), material: 'castAluminium', instances: poses }];
}

export function throttleBodyMeshes(s: Side): MeshSpec[] {
  const T = E.throttleBody;
  const x = sideSign(s) * T.x;
  const z1 = T.frontZ - T.length;
  const body = cylinderZ(T.radius, z1, T.frontZ, x, T.y);
  const flange = cylinderZ(T.flange.radius, T.frontZ - T.flange.thickness, T.frontZ, x, T.y);
  const rear = cylinderZ(T.radius * 1.08, z1 - T.flange.thickness, z1, x, T.y);
  const [aw, ah, ad] = T.actuator;
  const actuator = roundedBox(aw, ah, ad, E.bevel * 2);
  actuator.translate(x + sideSign(s) * (T.radius * 0.3), T.y + T.radius + ah / 2 - E.bevel, (T.frontZ + z1) / 2);
  const fq = new Quaternion().setFromUnitVectors(up, new Vector3(0, 0, -1));
  const bolts = flangeBolts(new Vector3(x, T.y, T.frontZ - T.flange.thickness), T.flange.radius - E.bevel * 3, 4, fq);
  return [
    { geometry: merge([body, flange, rear]), material: 'castAluminium' },
    { geometry: actuator, material: 'satinBlack' },
    { geometry: smallBolt(), material: 'darkSteel', instances: bolts },
  ];
}

/** Intake tube path for a side (mirrored in x for the right). */
function intakePath(s: Side) {
  const sx = sideSign(s);
  return new CatmullRomCurve3(E.intakeTube.path.map(([x, y, z]) => new Vector3(sx * x, y, z)), false, 'centripetal');
}

export function intakeTubeMeshes(s: Side): MeshSpec[] {
  const T = E.intakeTube;
  const curve = intakePath(s);
  const len = curve.getLength();
  const plain = (T.clamp.width * 2) / len; // smooth cuffs at each end for the clamps
  const radius = (t: number) => {
    if (t < plain || t > 1 - plain) return T.radius;
    const sArc = (t - plain) * len;
    return T.radius + T.ribDepth * (0.5 + 0.5 * Math.cos((2 * Math.PI * sArc) / T.ribPitch));
  };
  const bellows = sweep(curve, radius, SEGMENTS.bellows, SEGMENTS.cylinder / 2);
  const clamp = lathe(band(T.radius, T.radius + T.clamp.thickness, -T.clamp.width / 2, T.clamp.width / 2), SEGMENTS.cylinder / 2);
  const ends = [plain / 2, 1 - plain / 2].map((t) => along(curve.getPointAt(t), curve.getTangentAt(t)));
  return [
    { geometry: bellows, material: 'rubber' },
    { geometry: clamp, material: 'steel', instances: ends },
  ];
}

export function airboxMeshes(s: Side): MeshSpec[] {
  const A = E.airbox;
  const sx = sideSign(s);
  const [x0, x1] = A.x;
  const [y0, y1] = A.y;
  const [z0, z1] = A.z;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const box = roundedBox(w, h, d, A.cornerRadius);
  box.translate(sx * (x0 + w / 2), y0 + h / 2, z0 + d / 2);
  const lid = roundedBox(w - 2 * A.lid.inset, A.lid.height, d - 2 * A.lid.inset, A.lid.height / 2);
  lid.translate(sx * (x0 + w / 2), y1 + A.lid.height / 2 - E.bevel, z0 + d / 2);
  // Snout out of the outboard face with a rolled bell mouth (modelled along +y, turned outboard).
  const N = A.snout;
  const snout = lathe([
    [N.radius - N.bell, N.length],
    [N.radius - N.bell, -A.cornerRadius],
    [N.radius, -A.cornerRadius],
    [N.radius, N.length - N.bell],
    [N.radius + N.bell, N.length],
    [N.radius + N.bell / 2, N.length + N.bell / 2],
  ]);
  const at = new Vector3(sx * x1, N.y, N.z);
  snout.applyMatrix4(along(at, new Vector3(sx, 0, 0)));
  // Lid screws round the rim, and two satin brackets from the box's floor to the casing side.
  const screws: Matrix4[] = [];
  const rimY = y1 + A.lid.height - E.bevel;
  for (const fx of [0.15, 0.5, 0.85]) {
    for (const fz of [A.lid.inset * 1.5, d - A.lid.inset * 1.5]) screws.push(compose(new Vector3(sx * (x0 + w * fx), rimY, z0 + fz), new Quaternion()));
  }
  const B2 = A.bracket;
  const brackets = B2.z.map((z) => {
    const g = roundedBox(B2.size[0], B2.size[1], B2.size[2], E.bevel);
    g.translate(sx * (x0 - B2.size[0] / 2 + B2.overlap), y0 + B2.size[1] / 2 - E.bevel, z);
    return g;
  });
  return [
    { geometry: merge([box, lid, snout]), material: 'carbonGloss' },
    { geometry: smallBolt(), material: 'darkSteel', instances: screws },
    { geometry: merge(brackets), material: 'satinBlack' },
  ];
}

/** Front end of a fuel rail (engine coordinates). */
const fuelRailFront = (s: Side) => bankPoint(s, headDeckA + E.fuelRail.a, E.fuelRail.b, headZ(s)[1] + 0.02);

/** End of a fuel rail's inlet tube (engine coordinates), where the feed line arrives, and the way the line leaves it. */
export function fuelRailInlet(s: Side) {
  return { at: fuelRailFront(s).add(new Vector3(0, 0.05, 0.025)), dir: new Vector3(0, 1, 0.17).normalize() };
}

export function fuelRailMeshes(s: Side): MeshSpec[] {
  const F = E.fuelRail;
  const a = headDeckA + F.a;
  const [zr] = headZ(s);
  const p0 = fuelRailFront(s);
  const p1 = bankPoint(s, a, F.b, zr);
  const rail = cylinderZ(F.radius, p1.z, p0.z, p0.x, p0.y, SEGMENTS.small * 2);
  const inlet = tube([p0, p0.clone().add(new Vector3(0, 0.02, 0.02)), fuelRailInlet(s).at], F.radius * 0.6);
  const injector = cylinderY(F.injectorRadius, 0, F.injectorLength, SEGMENTS.small);
  const into = bankOutboard(s);
  const poses = CYLINDERS.map((i) => along(bankPoint(s, a, F.b, E.boreZ[s][i]), into));
  return [
    { geometry: merge([rail, inlet]), material: 'steel' },
    { geometry: injector, material: 'satinBlack', instances: poses },
  ];
}

// ─── Exhaust ─────────────────────────────────────────────────────────────────

const X = E.exhaust;

/**
 * Heat oxide along a primary from its port (t = 0): blue/purple where it runs hottest,
 * through bronze and gold to straw, then plain steel. sRGB stops.
 */
const HEAT_TINT: [number, string][] = [
  [0, '#4a4e86'],
  [0.06, '#5f4f80'],
  [0.13, '#83626f'],
  [0.21, '#a8875a'],
  [0.31, '#bfae88'],
  [0.45, '#b2ada5'],
  [1, '#a9a39a'],
];

/** Vertex colours from the tube's along-coordinate (uv.x, 0 at the port). */
function heatTint(g: BufferGeometry) {
  const uv = g.getAttribute('uv');
  const colours = new Float32Array(uv.count * 3);
  const c = new Color();
  const a = new Color();
  const b = new Color();
  for (let i = 0; i < uv.count; i++) {
    const t = uv.getX(i);
    const k = HEAT_TINT.findIndex(([at]) => at >= t);
    const [t1, c1] = HEAT_TINT[Math.max(1, k)];
    const [t0, c0] = HEAT_TINT[Math.max(1, k) - 1];
    c.copy(a.set(c0)).lerp(b.set(c1), (t - t0) / (t1 - t0 || 1));
    colours.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  return g;
}

export function headerMeshes(s: Side): MeshSpec[] {
  const tubes = primaries(s).map((p) => heatTint(tubeAlong(p.curve, X.primaryRadius, false, SEGMENTS.primary)));
  const mouth = collectorMouth(s);
  const c = X.collector;
  const big = c.ringRadius + X.primaryRadius + E.bevel;
  const cone = lathe([[big - E.bevel, 0], [big, E.bevel], [c.outletRadius, c.length], [c.outletRadius, c.length + X.catalyst.gap]]);
  cone.rotateX(-Math.PI / 2); // lathe +y → −z
  cone.translate(mouth.x, mouth.y, mouth.z + E.bevel);
  const [fw, fh, fd] = X.flange;
  const flanges: Matrix4[] = [];
  const gaskets: Matrix4[] = [];
  const bolts: Matrix4[] = [];
  for (const i of CYLINDERS) {
    const { p, dir } = exhaustPort(s, i);
    const q = new Quaternion().setFromUnitVectors(up, dir);
    const gt = E.head.gasketThickness;
    gaskets.push(compose(p.clone().addScaledVector(dir, gt / 2), q));
    flanges.push(compose(p.clone().addScaledVector(dir, gt + fd / 2), q));
    for (const side of [1, -1]) {
      const off = new Vector3(0, 0, side * (fw / 2 - E.head.bolt.radius));
      bolts.push(compose(p.clone().addScaledVector(dir, gt + fd).add(off), q));
    }
  }
  // Flange plate modelled with its thickness along +y (the port axis).
  const flange = roundedBox(fh, fd, fw, E.bevel);
  const gasket = roundedBox(fh, E.head.gasketThickness, fw, E.head.gasketThickness / 2);
  // Oxygen sensors on the collector cone, pointing up and out.
  const o2 = cylinderY(X.o2Sensor.radius, 0, X.o2Sensor.length, SEGMENTS.small);
  const o2Poses = [0.35, 0.75].map((f) => {
    const at = new Vector3(mouth.x, mouth.y + c.outletRadius + (big - c.outletRadius) * (1 - f), mouth.z - c.length * f);
    return along(at, new Vector3(sideSign(s) * 0.4, 1, 0));
  });
  return [
    { geometry: merge(tubes), material: 'headerTint' },
    { geometry: cone, material: 'headerSteel' },
    { geometry: flange, material: 'headerSteel', instances: flanges },
    { geometry: gasket, material: 'gasket', instances: gaskets },
    { geometry: boltHead(E.block.bolt.radius * 0.8, E.block.bolt.height), material: 'darkSteel', instances: bolts },
    { geometry: o2, material: 'satinBlack', instances: o2Poses },
  ];
}

/** Catalyst span along z for a bank: just behind the collector. */
export function catalystZ(s: Side): [number, number] {
  const front = collectorMouth(s).z - X.collector.length - X.catalyst.gap;
  return [front - X.catalyst.length, front];
}

export function catalystMeshes(s: Side): MeshSpec[] {
  const C = X.catalyst;
  const mouth = collectorMouth(s);
  const [zr, zf] = catalystZ(s);
  const r = C.radius;
  const can = lathe([
    [X.pipeRadius, 0],
    [X.pipeRadius, C.gap * 0.4],
    [r * 0.82, C.gap],
    [r, C.gap + r * 0.3],
    [r, C.length - r * 0.3],
    [r * 0.82, C.length],
    [X.pipeRadius, C.length + C.gap * 0.6],
    [X.pipeRadius, C.length + C.gap],
  ]);
  can.rotateX(-Math.PI / 2);
  can.translate(mouth.x, mouth.y, zf + C.gap);
  const ribs = [0.33, 0.66].map((f) => {
    const g = lathe(band(r, r + E.bevel, -E.bevel * 2, E.bevel * 2));
    g.rotateX(Math.PI / 2);
    g.translate(mouth.x, mouth.y, zf - (zf - zr) * f);
    return g;
  });
  // Flanged joints at both ends: four bolts round each neck.
  const q = new Quaternion().setFromUnitVectors(up, new Vector3(0, 0, -1));
  const fr = X.pipeFlange.radius - E.bevel * 2;
  const bolts = [zf + C.gap * 0.5, zr + E.bevel].flatMap((z) => flangeBolts(new Vector3(mouth.x, mouth.y, z), fr, 4, q));
  const flanges = [zf + C.gap * 0.5, zr + X.pipeFlange.thickness].map((z) => {
    const g = lathe(band(X.pipeRadius, X.pipeFlange.radius, -X.pipeFlange.thickness, 0), SEGMENTS.cylinder / 2);
    g.rotateX(-Math.PI / 2);
    g.translate(mouth.x, mouth.y, z);
    return g;
  });
  return [
    { geometry: merge([can, ...ribs, ...flanges]), material: 'steel' },
    { geometry: smallBolt(), material: 'darkSteel', instances: bolts },
  ];
}

const S = X.silencer;

/** Silencer inlet: on its inboard face, mid-length. */
function silencerInlet(s: Side) {
  return new Vector3(sideSign(s) * S.x[0], (S.y[0] + S.y[1]) / 2 - X.pipeRadius * 0.3, (S.z[0] + S.z[1]) / 2 + X.pipeRadius * 0.4);
}

export function exhaustPipeMeshes(s: Side): MeshSpec[] {
  const sx = sideSign(s);
  const mouth = collectorMouth(s);
  const [zr] = catalystZ(s);
  const inlet = silencerInlet(s);
  // Starts flush against the catalyst's outlet neck (a flanged joint), ends on the silencer's face.
  const start = new Vector3(mouth.x, mouth.y, zr);
  const curve = new CatmullRomCurve3(
    [
      start,
      start.clone().setZ(zr - X.pipeFlange.radius),
      ...X.pipeVia.map(([x, y, z]) => new Vector3(sx * x, y, z)),
      inlet.clone().setX(inlet.x - sx * X.pipeRadius * 1.5),
      inlet,
    ],
    false,
    'centripetal',
  );
  const pipe = tubeAlong(curve, X.pipeRadius, false, SEGMENTS.tube);
  const F = X.pipeFlange;
  const flange = lathe(band(X.pipeRadius, F.radius, 0, F.thickness), SEGMENTS.cylinder / 2);
  const flanges = [along(curve.getPointAt(0), curve.getTangentAt(0)), along(curve.getPointAt(1), curve.getTangentAt(1).negate())];
  const clamp = lathe(band(X.pipeRadius, X.pipeRadius + E.intakeTube.clamp.thickness, -E.intakeTube.clamp.width / 2, E.intakeTube.clamp.width / 2), SEGMENTS.cylinder / 2);
  const clamps = [0.3, 0.7].map((t) => along(curve.getPointAt(t), curve.getTangentAt(t)));
  const ends = [0, 1].map((t) => ({ at: curve.getPointAt(t), dir: curve.getTangentAt(t).multiplyScalar(t ? 1 : -1) }));
  const bolts = ends.flatMap(({ at, dir }) =>
    flangeBolts(at.clone().addScaledVector(dir, -F.thickness), F.radius - E.bevel * 2, 4, new Quaternion().setFromUnitVectors(up, dir.clone().normalize())),
  );
  return [
    { geometry: pipe, material: 'steel' },
    { geometry: flange, material: 'steel', instances: flanges },
    { geometry: clamp, material: 'darkSteel', instances: clamps },
    { geometry: smallBolt(), material: 'darkSteel', instances: bolts },
  ];
}

export function silencerMeshes(s: Side): MeshSpec[] {
  const sx = sideSign(s);
  const w = S.x[1] - S.x[0];
  const h = S.y[1] - S.y[0];
  const d = S.z[1] - S.z[0];
  const cx = sx * (S.x[0] + w / 2);
  const cy = (S.y[0] + S.y[1]) / 2;
  const cz = (S.z[0] + S.z[1]) / 2;
  const box = roundedBox(w, h, d, S.corner);
  box.translate(cx, cy, cz);
  // Seam band around the middle, like a pressed two-shell can.
  const seam = roundedBox(w + E.bevel * 2, h + E.bevel * 2, E.bevel * 3, S.corner);
  seam.translate(cx, cy, cz);
  const bracket = roundedBox(w * 0.12, E.bevel * 2, d * 0.5, E.bevel / 2);
  const brackets = [0.25, 0.75].map((f) => compose(new Vector3(sx * (S.x[0] + w * f), S.y[1] + E.bevel, cz), new Quaternion()));
  return [
    { geometry: merge([box, seam]), material: 'steel' },
    { geometry: bracket, material: 'satinBlack', instances: brackets },
  ];
}

export function tipMeshes(s: Side): MeshSpec[] {
  const O = DIMS.exhaustOpenings;
  const T = X.tip;
  const y = O.y - E.crankHeight;
  const exit = O.exitZ + T.lip;
  const front = S.z[0] + T.length * 0.15;
  const len = front - exit;
  // Hollow tip with a rolled lip, modelled along +y (exit at y = len).
  const shell = lathe([
    [T.radius - T.lip, len - T.lip],
    [T.radius - T.lip, 0],
    [T.radius, 0],
    [T.radius, len - T.lip / 2],
    [T.radius - T.lip, len],
  ]);
  const soot = lathe([[0, len * 0.4], [T.radius - T.lip, len * 0.4], [T.radius - T.lip, len * 0.42], [0, len * 0.42]]);
  const backward = new Vector3(0, 0, -1);
  const poses = O.x.map((x) => along(new Vector3(sideSign(s) * x, y, front), backward));
  return [
    { geometry: shell, material: 'tipSteel', instances: poses },
    { geometry: soot, material: 'satinBlack', instances: poses },
  ];
}

// ─── Electronics ─────────────────────────────────────────────────────────────

/** Pose for a box against the bay side wall: centre (left-side x), mirrored, yawed to the wall. */
function onBayWall(centre: readonly number[], s: Side) {
  const sx = sideSign(s);
  return compose(new Vector3(sx * Math.abs(centre[0]), centre[1], centre[2]), new Quaternion().setFromAxisAngle(up, sx * E.bayWallYaw));
}

export function ecuMeshes(s: Side): MeshSpec[] {
  const U = E.ecu;
  const sx = sideSign(s);
  const [w, h, d] = U.size;
  // Modelled at the origin with the finned face inboard (toward the engine).
  const box = roundedBox(w, h, d, E.bevel * 2);
  const fins = Array.from({ length: U.fins }, (_, k) => {
    const g = roundedBox(w * 0.35, E.bevel * 1.2, d * 0.85, E.bevel / 2);
    g.translate(-sx * (w / 2), -h * 0.4 + ((k + 0.5) * h * 0.8) / U.fins, 0);
    return g;
  });
  const plug = roundedBox(w * 0.7, h * 0.18, d * 0.35, E.bevel);
  plug.translate(-sx * w * 0.1, h / 2 + h * 0.07, d * 0.2);
  const pose = onBayWall(U.centre, s);
  // Two tabs bolting it to the bay wall.
  const tabs = [-1, 1].map((k) => {
    const g = roundedBox(U.tab[0], U.tab[1], U.tab[2], E.bevel / 2);
    g.translate(sx * (w / 2 + U.tab[0] / 2 - E.bevel), 0, k * (d / 2 - U.tab[2]));
    return g;
  });
  // Harness from the plug, over towards the engine (its loom joins the cam-cover loom).
  const plugTop = new Vector3(-sx * w * 0.1, h / 2 + h * 0.16, d * 0.2).applyMatrix4(pose);
  const harness = tube(
    [plugTop, ...U.harness.map(([x, y, z]) => new Vector3(sx * x, y, z))],
    U.harnessRadius,
  );
  return [
    { geometry: merge([box, ...fins]).applyMatrix4(pose), material: 'castAluminium' },
    { geometry: plug.applyMatrix4(pose), material: 'satinBlack' },
    { geometry: merge(tabs).applyMatrix4(pose), material: 'satinBlack' },
    { geometry: harness, material: 'loom' },
  ];
}

export function fuseBoxMeshes(): MeshSpec[] {
  const F = E.fuseBox;
  const [w, h, d] = F.size;
  const box = roundedBox(w, h, d, E.bevel * 2);
  const lid = roundedBox(w * 0.4, h * 0.9, d * 0.9, E.bevel);
  lid.translate(w / 2, 0, 0); // inboard face of the right-hand box
  return [{ geometry: merge([box, lid]).applyMatrix4(onBayWall(F.centre, 'r')), material: 'satinBlack' }];
}

/** Ignition loom along the top of each cam cover, inboard of the coil packs, with a drop to each coil. */
export function loomMeshes(s: Side): MeshSpec[] {
  const L = E.loom;
  const coverTop = headDeckA + E.head.height + E.camCover.height + E.camCover.seatHeight;
  const a = coverTop + L.radius;
  const [zr, zf] = headZ(s);
  const pts: Vector3[] = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const z = zf - 0.03 - ((zf - zr - 0.06) * k) / n;
    pts.push(bankPoint(s, a + (k % 2 ? 0.002 : 0), L.b, z));
  }
  const main = tube(pts, L.radius);
  const drops = E.boreZ[s].map((z) =>
    tube([bankPoint(s, a, L.b, z + 0.01), bankPoint(s, a + 0.012, (L.b + E.coilPack.width) / 2, z + 0.02), bankPoint(s, coverTop + E.coilPack.height * 0.6, E.coilPack.width * 0.2, z + E.coilPack.length / 2)], L.radius * 0.45),
  );
  const [cw, ch, cd] = L.clip;
  const clip = roundedBox(cw, ch, cd, ch / 3);
  const clips = Array.from({ length: L.clips }, (_, k) => {
    const z = zf - 0.03 - ((zf - zr - 0.06) * (k + 0.5)) / L.clips;
    return compose(bankPoint(s, a - L.radius * 0.5, L.b, z), bankQuat(s));
  });
  return [
    { geometry: merge([main, ...drops]), material: 'loom' },
    { geometry: clip, material: 'satinBlack', instances: clips },
  ];
}

