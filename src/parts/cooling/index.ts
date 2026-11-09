import { Vector3 } from 'three';
import { DIMS, EXPLODE, type Vec3 } from '../../config/dims';
import { CORNER_DELAY, TEARDOWN } from '../../explode/timing';
import { fmtMm } from '../../lib/format';
import { specBuild } from '../../scene/MeshSet';
import { cableBuild, type CableStyle } from '../drivetrain/HvCable';
import { waterPumpInlet } from '../engine/geometry/ancillaries';
import { SIDES, sideName, sideSign } from '../engine/layout';
import type { PartDef } from '../types';
import { coolantTankMeshes, radiatorMeshes, radiatorOutlet } from './geometry';

/**
 * Cooling: side-pod radiators under the intake grilles, the expansion tank on the engine,
 * and the coolant hoses between them. The hoses re-curve every frame like the HV cables:
 * one end rides the engine, the other the radiator.
 */

const E = DIMS.engine;
const C = DIMS.coolantHose;
const ZERO: Vec3 = [0, 0, 0];

const HOSE: CableStyle = {
  strands: 1,
  strandRadius: C.radius,
  offset: 0,
  twist: 0,
  material: 'rubber',
  clipMaterial: 'steel',
  clipWidth: C.clampWidth,
  clips: () => [...C.clamps],
};

const RD = DIMS.radiator;

const radiators: PartDef[] = SIDES.map((s) => ({
  id: `radiator-${s}`,
  name: `Radiator (${sideName(s)})`,
  group: 'cooling',
  description:
    'Coolant radiator in the side pod, under the intake grille behind the door. It lies parallel to the grille, so the air rushing in passes straight through the core and carries the engine’s heat away.',
  specs: { Core: `${fmtMm(RD.core[1], 0)} × ${fmtMm(RD.core[0], 0)} × ${fmtMm(RD.core[2], 0)}`, Fins: String(RD.fins), Tilt: 'Parallel to the grille' },
  build: specBuild(`Radiator_${s}`, () => radiatorMeshes(s)),
  material: 'radiator',
  position: ZERO,
  stage: 2,
  explodeOffset: [sideSign(s) * EXPLODE.radiator[0], EXPLODE.radiator[1], EXPLODE.radiator[2]],
  delay: CORNER_DELAY.radiators,
  // Its outlet pipe reaches the bay wall, where the hose goes through.
  contacts: ['carbon-tub'],
}));

const coolantTank: PartDef = {
  id: 'coolant-tank',
  name: 'Coolant expansion tank',
  group: 'cooling',
  parent: 'powertrain',
  description:
    'Header tank on the left of the engine, above the cam cover. It takes up the coolant’s expansion as it warms, keeps the system topped up and lets trapped air escape; the cap sets the system pressure.',
  specs: { Volume: `≈${((Math.PI * DIMS.coolantTank.radius ** 2 * DIMS.coolantTank.length) * 1000).toFixed(1)} L`, Material: 'Translucent nylon' },
  build: specBuild('CoolantTank', coolantTankMeshes),
  material: 'insulator',
  position: E.origin,
  stage: 4,
  explodeOffset: EXPLODE.coolantTank,
  delay: TEARDOWN.intake,
  contacts: ['cam-cover-l'],
};

const hoses: PartDef[] = SIDES.map((s) => {
  const sx = sideSign(s);
  // The hose starts at the end of the pump's inlet stub (car coordinates).
  const inlet = waterPumpInlet(s);
  const mirror = ([x, y, z]: readonly number[]) => new Vector3(sx * x, y, z);
  const id = `coolant-hoses-${s}`;
  const radiator = radiatorOutlet(s);
  return {
    id,
    name: `Coolant hose (${sideName(s)})`,
    group: 'cooling',
    description:
      'Rubber hose carrying coolant between the radiator in the side pod and the water pump at the front of the engine, clamped at both ends. It passes through the bay wall into the pod.',
    specs: { Bore: `Ø${fmtMm(C.radius * 2, 0)}`, Clamps: String(C.clamps.length) },
    build: cableBuild({
      id,
      style: HOSE,
      from: { part: `water-pump-${s}`, origin: E.origin, at: inlet.at.clone().add(new Vector3(...E.origin)), dir: inlet.dir },
      // On the radiator's outlet spigot, at the bay wall.
      to: { part: `radiator-${s}`, origin: ZERO, at: radiator.end, dir: radiator.dir },
      via: C.via.map(mirror),
      slack: mirror(C.slack),
    }),
    material: 'rubber',
    position: ZERO,
    stage: 4,
    explodeOffset: ZERO,
    // Through the bay wall into the side pod.
    contacts: [`water-pump-${s}`, `radiator-${s}`, 'carbon-tub'],
  };
});

export const coolingParts: PartDef[] = [...radiators, coolantTank, ...hoses];
