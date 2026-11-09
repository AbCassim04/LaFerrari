import { Vector3 } from 'three';
import { DIMS, EXPLODE, type Vec3 } from '../../config/dims';
import { HYBRID_DELAY } from '../../explode/timing';
import { fmtMm } from '../../lib/format';
import { specBuild } from '../../scene/MeshSet';
import { SIDES, sideName, sideSign, type Side } from '../engine/layout';
import type { PartDef } from '../types';
import {
  batteryConnector,
  batteryMeshes,
  bellhousingMeshes,
  casingMeshes,
  clutchMeshes,
  diffMeshes,
  driveshaftMeshes,
  eMotorMeshes,
  eMotorTerminal,
  flywheelMeshes,
  gearClusterMeshes,
  inverterConnector,
  inverterMeshes,
} from './geometry';
import { cableBuild, type CableEnd, type CableRoute } from './HvCable';

/**
 * Milestone 2c: the 7-speed DCT transaxle, clutch, hybrid system and HV cables. The
 * transaxle parts ride the powertrain (engine coordinates); the battery, driveshafts and
 * cables are fixed to the car (car coordinates).
 */

const E = DIMS.engine;
const T = DIMS.transaxle;
const X = EXPLODE.transaxle;
const ORIGIN = E.origin;
const ZERO: Vec3 = [0, 0, 0];
const named = (s: Side, name: string) => `${name} (${sideName(s)})`;
/** Engine coordinates → car coordinates. */
const car = (v: Vector3) => v.clone().add(new Vector3(...ORIGIN));

export const transaxleAssembly: PartDef = {
  id: 'transaxle',
  name: 'Transaxle',
  group: 'transmission',
  parent: 'powertrain',
  description:
    'Gearbox, differential and main e-motor in one unit bolted to the back of the engine. In the teardown it slides off the engine as a whole.',
  specs: { Gearbox: '7-speed dual-clutch', Layout: 'Transverse-shaft transaxle, diff on the rear axle line' },
  position: ORIGIN,
  stage: 5,
  explodeOffset: [0, 0, -X.back],
  delay: HYBRID_DELAY.transaxle,
};

const rides = (p: Omit<PartDef, 'position' | 'stage' | 'explodeOffset'> & { explodeOffset?: Vec3; delay?: number }): PartDef => ({
  explodeOffset: ZERO,
  ...p,
  position: ORIGIN,
  stage: 5,
});

const transaxleParts: PartDef[] = [
  rides({
    id: 'flywheel',
    name: 'Flywheel',
    group: 'transmission',
    parent: 'powertrain',
    description: 'Light steel flywheel on the end of the crankshaft, with the starter ring gear round its rim. It carries the dual clutch.',
    specs: { Diameter: `Ø${fmtMm(T.flywheel.radius * 2, 0)}`, Bolts: String(T.flywheel.bolts) },
    build: specBuild('Flywheel', flywheelMeshes),
    material: 'darkSteel',
    explodeOffset: [0, 0, -X.flywheel],
    delay: HYBRID_DELAY.flywheel,
  }),
  rides({
    id: 'dual-clutch',
    name: 'Dual clutch',
    group: 'transmission',
    parent: 'powertrain',
    description:
      'Two wet multi-plate clutches nested in one drum: one drives the odd gears, the other the even ones. The next gear is already engaged, so a shift is just one clutch handing over to the other.',
    specs: { Type: 'Wet, multi-plate', Diameter: `Ø${fmtMm(T.clutch.radius * 2, 0)}` },
    build: specBuild('DualClutch', clutchMeshes),
    material: 'steel',
    explodeOffset: [0, 0, -X.clutch],
    delay: HYBRID_DELAY.clutch,
  }),
  rides({
    id: 'bellhousing',
    name: 'Bellhousing',
    group: 'transmission',
    parent: 'transaxle',
    description: 'Cast housing that bolts the gearbox to the back of the engine block and encloses the flywheel and clutch.',
    specs: { Bolts: String(T.bellhousing.bolts), Material: 'Cast aluminium' },
    build: specBuild('Bellhousing', bellhousingMeshes),
    material: 'castAluminium',
  }),
  rides({
    id: 'dct-casing',
    name: 'Gearbox casing',
    group: 'transmission',
    parent: 'transaxle',
    description:
      'Cast casing of the 7-speed dual-clutch gearbox. The lattice of ribs stiffens the thin walls, and the rear suspension and e-motor bolt to it.',
    specs: { Gears: '7 forward', Length: fmtMm(T.bellhousing.rearZ - T.casing.rearZ, 0), 'Seam bolts': String(T.casing.seamRings.length * T.casing.seamBolts) },
    build: specBuild('DctCasing', casingMeshes),
    material: 'castAluminium',
  }),
  rides({
    id: 'gear-clusters',
    name: 'Gear clusters',
    group: 'transmission',
    parent: 'transaxle',
    description: 'Input shafts and two layshafts carrying the gear pairs. Hidden inside the casing.',
    specs: { 'Gear pairs': '7' },
    build: specBuild('GearClusters', gearClusterMeshes),
    material: 'steel',
  }),
  rides({
    id: 'rear-diff',
    name: 'Electronic differential',
    group: 'transmission',
    parent: 'transaxle',
    description:
      'Electronically controlled limited-slip differential on the rear axle line. It splits torque between the rear wheels, varying how much each one gets through corners.',
    specs: { Type: 'E-diff (electronic limited slip)' },
    build: specBuild('RearDiff', diffMeshes),
    material: 'castAluminium',
  }),
  rides({
    id: 'main-emotor',
    name: 'Main e-motor',
    group: 'hybrid',
    parent: 'transaxle',
    description:
      'The main electric motor, on the back of the gearbox. It adds torque under acceleration, fills the gaps during shifts and recovers energy under braking.',
    specs: { Diameter: `Ø${fmtMm(T.eMotor.radius * 2, 0)}`, Length: fmtMm(T.eMotor.length, 0), 'Peak power': '120 kW (est)' },
    build: specBuild('MainEMotor', eMotorMeshes),
    material: 'aluminium',
    explodeOffset: [0, 0, -X.eMotor],
    delay: HYBRID_DELAY.eMotor,
  }),
  ...SIDES.map((s) =>
    rides({
      id: `inverter-${s}`,
      name: named(s, 'Inverter'),
      group: 'hybrid',
      // Lifts straight off the powertrain; the casing then slides back beneath it.
      parent: 'powertrain',
      description:
        'Power electronics converting the battery’s direct current into three-phase alternating current for the e-motors, and back again when they recover energy.',
      specs: { Lid: 'X-braced', Bolts: String(T.inverter.bolts) },
      build: specBuild(`Inverter_${s}`, () => inverterMeshes(s)),
      material: 'castAluminium',
      explodeOffset: [0, X.inverter, 0],
      delay: HYBRID_DELAY.inverters,
    }),
  ),
];

const driveshafts: PartDef[] = SIDES.map((s) => ({
  id: `driveshaft-${s}`,
  name: named(s, 'Driveshaft'),
  group: 'transmission',
  description: 'Carries drive from the differential to the rear wheel, with a constant-velocity joint at each end so the wheel can move with the suspension.',
  specs: { 'Shaft diameter': `Ø${fmtMm(DIMS.driveshaft.shaftRadius * 2, 0)}`, Joints: '2 CV joints, rubber boots' },
  build: specBuild(`Driveshaft_${s}`, () => driveshaftMeshes(s)),
  material: 'darkSteel',
  position: ZERO,
  stage: 2,
  explodeOffset: [sideSign(s) * EXPLODE.driveshaft, 0, 0],
  // Passes through the model's underbody shell (wheelhouse liner) into the hub.
  contacts: ['carbon-tub', `wheel-${s === 'l' ? 'rl' : 'rr'}`],
}));

export const batteryPack: PartDef = {
  id: 'battery-pack',
  name: 'HV battery',
  group: 'hybrid',
  description:
    'Lithium-ion battery in a thin tray under the cabin floor, as low as possible in the car. It stores the energy the e-motors recover and gives it back under acceleration.',
  specs: { Modules: String(DIMS.battery.modules.cols * DIMS.battery.modules.rows), Thickness: `${fmtMm(DIMS.battery.depth, 0)}–${fmtMm(DIMS.battery.step.depth, 0)}`, Capacity: '≈2.3 kWh (est)' },
  build: specBuild('BatteryPack', batteryMeshes),
  material: 'carbon',
  position: ZERO,
  stage: 5,
  explodeOffset: [EXPLODE.battery.slideX, -EXPLODE.battery.drop, 0],
  delay: HYBRID_DELAY.battery,
};

// ─── HV cables ────────────────────────────────────────────────────────────────

const end = (part: string, origin: Vec3, c: { at: Vector3; dir: Vector3 }, engineCoords: boolean): CableEnd => ({
  part,
  origin,
  at: engineCoords ? car(c.at) : c.at,
  dir: c.dir,
});
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Aux motor's HV connector, on top of the motor (engine coordinates). */
function auxConnector() {
  const A = E.auxMotor;
  const zf = E.blockFrontZ + A.frontGap;
  return { at: new Vector3(A.centre[0], A.centre[1] + A.radius + A.connector[1], zf - A.length / 2), dir: new Vector3(0, 1, 0) };
}

const ROUTES: (CableRoute & { name: string; description: string; contacts: string[] })[] = [
  {
    id: 'hv-cable-battery',
    name: 'HV cable: battery to inverters',
    description:
      'High-voltage DC bundle from the battery under the floor, under the fuel tank behind the seats and along the left of the engine to the inverters.',
    from: end('battery-pack', ZERO, batteryConnector(), false),
    to: end('inverter-l', ORIGIN, inverterConnector('l', 'frontInner'), true),
    // Clipped to the floor under the fuel tank and out past its end (the tank slides back
    // over it in stage 5), then up the bay's front corner and under the aux cable where
    // both turn in to the inverter.
    pinned: [0, 1, 2, 3],
    via: [v(0.04, 0.133, -0.24), v(0.16, 0.135, -0.315), v(0.42, 0.135, -0.35), v(0.5, 0.16, -0.38), v(0.47, 0.3, -0.4), v(0.42, 0.4, -0.44), v(0.4, 0.46, -0.5), v(0.4, 0.47, -0.8), v(0.38, 0.49, -1.0), v(0.3, 0.52, -1.12), v(0.12, 0.56, -1.14)],
    slack: v(0.5, 0.2, -0.1),
    slackPeak: 0.6,
    contacts: ['battery-pack', 'inverter-l', 'carbon-tub'],
  },
  {
    id: 'hv-cable-aux',
    name: 'HV cable: inverter to aux e-motor',
    description: 'High-voltage bundle from the left inverter, along the left of the engine beside the battery cable, to the auxiliary e-motor at the front of the block.',
    from: end('aux-emotor', ORIGIN, auxConnector(), true),
    to: end('inverter-l', ORIGIN, inverterConnector('l', 'frontOuter'), true),
    via: [v(0.25, 0.36, -0.43), v(0.31, 0.44, -0.42), v(0.355, 0.5, -0.54), v(0.355, 0.51, -0.85), v(0.335, 0.54, -1.02), v(0.26, 0.6, -1.1)],
    // Up and out near the inverter end, over the lifted intake tube and airbox.
    slack: v(0.45, 0.3, -0.12),
    slackPeak: 0.75,
    contacts: ['aux-emotor', 'inverter-l'],
  },
  {
    id: 'hv-cable-emotor',
    name: 'HV cable: inverter to main e-motor',
    description: 'Short high-voltage bundle from the right inverter, past the oil tank, to the main e-motor’s terminal box.',
    from: end('inverter-r', ORIGIN, inverterConnector('r', 'rear'), true),
    to: end('main-emotor', ORIGIN, eMotorTerminal(), true),
    via: [v(-0.135, 0.61, -1.62), v(-0.13, 0.6, -1.78)],
    slack: v(-0.1, 0, 0),
    contacts: ['inverter-r', 'main-emotor'],
  },
];

const cables: PartDef[] = ROUTES.map((r) => ({
  id: r.id,
  name: r.name,
  group: 'hybrid',
  description: `${r.description} Orange marks high voltage; each strand is one phase or pole.`,
  specs: { Strands: '3', Colour: 'HV orange' },
  build: cableBuild(r),
  material: 'hvOrange',
  position: ZERO,
  stage: 5,
  explodeOffset: ZERO,
  contacts: r.contacts,
}));

export const drivetrainParts: PartDef[] = [transaxleAssembly, ...transaxleParts, ...driveshafts, batteryPack, ...cables];
