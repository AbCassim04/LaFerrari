import { CatmullRomCurve3, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { DIMS } from '../../config/dims';
import { SEGMENTS } from '../../config/detail';
import { cylinderY, lathe, merge, roundedBox, tubeAlong } from '../../geometry/build';
import type { MeshSpec } from '../../scene/MeshSet';
import { band } from '../engine/geometry/core';
import { compose, sideSign, type Side } from '../engine/layout';

const RD = DIMS.radiator;
const mm = (v: number) => v / 1000;

/**
 * The radiator's frame on side `s`: `n` out of the core toward the grille, `c` along the
 * core (forward and down), `a` across it, and `inboard` the across direction toward the
 * car's centreline. `basis` takes local (across, normal, along) to car coordinates.
 */
export function radiatorFrame(s: Side) {
  const sx = sideSign(s);
  const n = new Vector3(sx * RD.normal[0], RD.normal[1], RD.normal[2]).normalize();
  const rise = new Vector3(sx * RD.along[0], RD.along[1], RD.along[2]);
  const b = rise.addScaledVector(n, -rise.dot(n)).normalize();
  const a = b.clone().cross(n).normalize();
  const c = a.clone().cross(n);
  const centre = new Vector3(sx * RD.centre[0], RD.centre[1], RD.centre[2]);
  const basis = new Matrix4().makeBasis(a, n, c).setPosition(centre);
  const inboard = a.x * sx > 0 ? a.clone().negate() : a.clone();
  return { a, n, c, centre, basis, inboard };
}

/** Outlet spigot on the front tank, where the coolant hose starts, and the outlet's route. */
export function radiatorOutlet(s: Side) {
  const sx = sideSign(s);
  const { c, n, centre, inboard } = radiatorFrame(s);
  const along = RD.core[1];
  const tankAt = centre.clone().addScaledVector(c, along / 2 + RD.tank.length / 2);
  const start = tankAt.addScaledVector(inboard, RD.outlet.inboard).addScaledVector(n, -RD.tank.radius * 0.6);
  const end = new Vector3(sx * DIMS.coolantHose.radiatorEnd[0], DIMS.coolantHose.radiatorEnd[1], DIMS.coolantHose.radiatorEnd[2]);
  const via = RD.outlet.via.map(([x, y, z]) => new Vector3(sx * x, y, z));
  return { start, via, end, dir: new Vector3(-sx, 0, 0.2).normalize() };
}

export function radiatorMeshes(s: Side): MeshSpec[] {
  const { basis } = radiatorFrame(s);
  const [across, along, thick] = RD.core;
  const place = (g: BufferGeometry) => g.applyMatrix4(basis);
  // Core, fins across it (they stand a little proud of both faces), end tanks, side frames.
  const core = place(roundedBox(across, thick, along, mm(3)));
  const fin = roundedBox(across - mm(4), thick + mm(3), mm(1.2), 0.0003);
  const fins = Array.from({ length: RD.fins }, (_, k) =>
    basis.clone().multiply(new Matrix4().makeTranslation(0, 0, ((k + 0.5) / RD.fins - 0.5) * (along - mm(10)))),
  );
  const tanks = [-1, 1].map((k) => {
    const g = lathe(band(0, RD.tank.radius, -across / 2 - mm(6), across / 2 + mm(6)), SEGMENTS.small * 2);
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0, k * (along / 2 + RD.tank.length / 2));
    return place(g);
  });
  const frames = [-1, 1].map((k) => {
    const g = roundedBox(mm(8), thick + mm(10), along + RD.tank.length * 2, mm(2));
    g.translate(k * (across / 2 + mm(4)), 0, 0);
    return place(g);
  });
  // Outlet from the front tank down to the hose spigot.
  const { start, via, end, dir } = radiatorOutlet(s);
  const curve = new CatmullRomCurve3([start, ...via, end.clone().addScaledVector(dir, -mm(4))], false, 'centripetal');
  const outlet = tubeAlong(curve, RD.outlet.radius, false, 48, 12);
  const bead = cylinderY(RD.outlet.radius * 1.25, -mm(4), mm(4), SEGMENTS.small);
  bead.applyMatrix4(compose(end.clone().addScaledVector(dir, -mm(12)), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir)));
  return [
    { geometry: core, material: 'radiator' },
    { geometry: merge([...tanks, outlet, bead, ...frames, ...fins.map((m) => fin.clone().applyMatrix4(m))]), material: 'aluminium' },
  ];
}

/** Expansion tank (engine coordinates: it rides the engine). */
export function coolantTankMeshes(): MeshSpec[] {
  const T = DIMS.coolantTank;
  const o = DIMS.engine.origin;
  const [x, y, z] = [T.centre[0] - o[0], T.centre[1] - o[1], T.centre[2] - o[2]];
  const r = T.radius;
  const half = T.length / 2;
  const body = lathe([
    [0, -half],
    [r * 0.7, -half],
    [r, -half + r * 0.35],
    [r, half - r * 0.35],
    [r * 0.7, half],
    [0, half],
  ]);
  body.rotateX(Math.PI / 2);
  body.translate(x, y, z);
  // Filler neck and pressure cap on top, toward the front end.
  const capAt = new Vector3(x, y + r, z + half * 0.45);
  const neck = cylinderY(T.capRadius * 0.8, -mm(4), mm(8), SEGMENTS.small * 2);
  neck.translate(capAt.x, capAt.y, capAt.z);
  const cap = cylinderY(T.capRadius, mm(8), mm(8) + T.capHeight, SEGMENTS.small * 2);
  cap.translate(capAt.x, capAt.y, capAt.z);
  // Two straps round the tank, each with a short leg down to a foot on the cam cover's
  // outer shoulder.
  const footY = T.footY - o[1];
  const legX = T.legX - o[0];
  const legTop = y - Math.sqrt(r * r - (legX - x) ** 2) + mm(2);
  const straps = [-1, 1].flatMap((k) => {
    const zk = z + k * half * 0.5;
    const band_ = lathe(band(r - mm(1), r + mm(2), -mm(9), mm(9)));
    band_.rotateX(Math.PI / 2);
    band_.translate(x, y, zk);
    const leg = roundedBox(mm(5), legTop - footY, mm(18), mm(1.5));
    leg.translate(legX, (legTop + footY) / 2, zk);
    const foot = roundedBox(mm(20), mm(5), mm(18), mm(1.5));
    foot.translate(legX, footY + mm(2.5), zk);
    return [band_, leg, foot];
  });
  // Outlet spigot at the rear end (the hose to the pump is left out).
  const spigot = cylinderY(mm(8), 0, mm(20), SEGMENTS.small);
  spigot.rotateX(-Math.PI / 2);
  spigot.translate(x, y - r * 0.4, z - half + mm(2));
  return [
    { geometry: merge([body, neck, ...straps, spigot]), material: 'insulator' },
    { geometry: cap, material: 'satinBlack' },
  ];
}
