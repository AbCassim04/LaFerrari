import { Vector3 } from 'three';
import { DIMS, EXPLODE, type Vec3 } from '../../config/dims';
import { CORNER_DELAY, FUEL_DELAY } from '../../explode/timing';
import { fmtMm } from '../../lib/format';
import { specBuild } from '../../scene/MeshSet';
import { cablesBuild, type CableRoute, type CableStyle } from '../drivetrain/HvCable';
import { fuelRailInlet } from '../engine/geometry/intakeExhaust';
import { SIDES, sideName, sideSign, type Side } from '../engine/layout';
import type { PartDef } from '../types';
import {
  antiRollBarMeshes,
  bumperBeamMeshes,
  coiloverMeshes,
  discMeshes,
  fuelPumpMeshes,
  fuelLineMeshes,
  fuelTankMeshes,
  lowerWishboneMeshes,
  sidePoint,
  subframeMeshes,
  toeLinkMeshes,
  upperLinkMeshes,
  uprightMeshes,
} from './geometry';

/**
 * Milestone 2d chassis parts, fixed to the car (car coordinates): fuel system behind the
 * seats, rear subframe and bumper beam, rear suspension and brakes. The radiators and
 * coolant tank are in parts/cooling.
 */

const RS = DIMS.rearSuspension;
const RC = EXPLODE.rearCorner;
const ZERO: Vec3 = [0, 0, 0];
const ORIGIN = DIMS.engine.origin;
const named = (s: Side, name: string) => `${name} (${sideName(s)})`;
const out = (s: Side, d: number): Vec3 => [sideSign(s) * d, 0, 0];
const len = (a: Vec3, b: Vec3) => fmtMm(new Vector3(...a).distanceTo(new Vector3(...b)), 0);

const fixed = (p: Omit<PartDef, 'position'>): PartDef => ({ position: ZERO, ...p });

// ─── Fuel system ─────────────────────────────────────────────────────────────

const FT = DIMS.fuelTank;
/** Tank volume from its section (shoelace) and width; the rounded corners take off a little. */
const tankLitres = (() => {
  const pts = FT.section;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [y0, z0] = pts[i];
    const [y1, z1] = pts[(i + 1) % pts.length];
    area += z0 * y1 - z1 * y0;
  }
  return Math.abs(area / 2) * FT.halfWidth * 2 * 1000 * 0.97;
})();

const fuelParts: PartDef[] = [
  fixed({
    id: 'fuel-tank',
    name: 'Fuel tank',
    group: 'chassis',
    description:
      'Fuel cell in the slot between the seat backs and the engine, inside the rear of the carbon tub. Its front face follows the reclined seats; steel straps hang it from the tub, and the HV battery cable runs underneath.',
    specs: { Capacity: `≈${Math.round(tankLitres / 5) * 5} L (est)`, Width: fmtMm(FT.halfWidth * 2, 0), Straps: String(FT.strapX.length) },
    build: specBuild('FuelTank', fuelTankMeshes),
    material: 'satinBlack',
    stage: 5,
    explodeOffset: EXPLODE.fuelTank,
    delay: FUEL_DELAY.tank,
    contacts: ['carbon-tub'],
  }),
  fixed({
    id: 'fuel-pump',
    name: 'Fuel pump',
    group: 'chassis',
    parent: 'fuel-tank',
    description:
      'In-tank pump module, sealed into the top of the tank. It lifts fuel to the engine, where engine-driven pumps raise it to injection pressure for the fuel rails.',
    specs: { Flange: `Ø${fmtMm(FT.pump.radius * 2, 0)}`, Outlets: '2 quick connectors' },
    build: specBuild('FuelPump', fuelPumpMeshes),
    material: 'aluminium',
    stage: 5,
    explodeOffset: [0, 0.12, 0],
    delay: FUEL_DELAY.pump,
    contacts: ['fuel-tank'],
  }),
  // Ride the rails: they lift off the pump's quick connectors with the powertrain.
  ...SIDES.map(
    (s): PartDef => ({
      id: `fuel-line-${s}`,
      name: named(s, 'Fuel line'),
      group: 'chassis',
      parent: `fuel-rail-${s}`,
      description:
        'Feed line from the tank’s pump over the front of the engine to this bank’s fuel rail. Quick connectors let it unclip from the pump when the engine comes out.',
      specs: { Bore: `Ø${fmtMm(DIMS.fuelLine.radius * 2, 0)}`, Ends: 'Quick connectors' },
      build: specBuild(`FuelLine_${s}`, () => fuelLineMeshes(s, fuelRailInlet(s))),
      material: 'darkSteel',
      position: ORIGIN,
      stage: 4,
      explodeOffset: ZERO,
      contacts: ['fuel-pump', `fuel-rail-${s}`],
    }),
  ),
];

// ─── Rear subframe and bumper beam ──────────────────────────────────────────

const structureParts: PartDef[] = [
  fixed({
    id: 'rear-subframe',
    name: 'Rear subframe',
    group: 'chassis',
    description:
      'Welded tubular frame either side of the gearbox, outboard of the exhaust: bolted to the tub at the front and to the rear crash structure at the back. Every rear suspension link, the coilovers and the anti-roll bar pick up on it.',
    specs: { Tubes: `Ø${fmtMm(RS.railRadius * 2, 0)}`, Material: 'Aluminium alloy', 'Pickups per side': '5' },
    build: specBuild('RearSubframe', subframeMeshes),
    material: 'aluminium',
    stage: 2,
    explodeOffset: ZERO,
    contacts: ['carbon-tub'],
  }),
  fixed({
    id: 'rear-bumper-beam',
    name: 'Rear bumper beam',
    group: 'chassis',
    description:
      'Box-section beam behind the e-motor on two crash cans. In a rear impact the cans crumple first, absorbing energy before it reaches the structure.',
    specs: { Width: fmtMm(DIMS.bumperBeam.halfWidth * 2, 0), 'Crash cans': '2', Bolts: String(DIMS.bumperBeam.bolts) },
    build: specBuild('RearBumperBeam', bumperBeamMeshes),
    material: 'aluminium',
    stage: 2,
    explodeOffset: EXPLODE.bumperBeam,
    delay: CORNER_DELAY.bumperBeam,
    contacts: ['carbon-tub'],
  }),
];

// ─── Rear suspension and brakes ──────────────────────────────────────────────

function cornerParts(s: Side): PartDef[] {
  const wheel = `wheel-r${s}`;
  const caliper = `caliper-r${s}`;
  const id = (name: string) => `${name}-${s}`;
  return [
    fixed({
      id: id('rear-upright'),
      name: named(s, 'Rear upright'),
      group: 'suspension',
      description:
        'Cast hub carrier: the wheel bearing and hub turn inside it and the driveshaft’s stub axle passes through. The three links attach at its arms, and the brake caliper bolts to its front lugs.',
      specs: { Material: 'Cast aluminium', 'Link joints': '3', Hub: `Ø${fmtMm(RS.hub.flangeRadius * 2, 0)} flange` },
      build: specBuild(`RearUpright_${s}`, () => uprightMeshes(s)),
      material: 'castAluminium',
      stage: 2,
      explodeOffset: out(s, RC.upright),
      delay: CORNER_DELAY.upright,
      contacts: [caliper, id('rear-brake-disc'), id('rear-lower-wishbone'), id('rear-upper-link'), id('rear-toe-link')],
    }),
    fixed({
      id: id('rear-brake-disc'),
      name: named(s, 'Rear brake disc'),
      group: 'suspension',
      description:
        'Ventilated, cross-drilled carbon-ceramic disc on an aluminium bell. Carbon-ceramic keeps working when very hot and weighs about half as much as an iron disc of the same size.',
      specs: { Diameter: fmtMm(DIMS.wheel.rear.discDiameter, 0), Thickness: fmtMm(RS.disc.x[1] - RS.disc.x[0], 0), Material: 'Carbon-ceramic' },
      build: specBuild(`RearDisc_${s}`, () => discMeshes(s)),
      material: 'ceramic',
      stage: 2,
      // Stays in its caliper (which moves the same distance).
      explodeOffset: out(s, RC.disc),
      delay: CORNER_DELAY.disc,
      contacts: [caliper, wheel],
    }),
    fixed({
      id: id('rear-lower-wishbone'),
      name: named(s, 'Rear lower wishbone'),
      group: 'suspension',
      description:
        'A-shaped arm carrying the bottom of the upright, pivoting on rubber bushes in two subframe brackets. It also takes the coilover’s lower eye and the anti-roll bar’s drop link.',
      specs: { 'Pivot spread': fmtMm(RS.lowerFront[2] - RS.lowerRear[2], 0), Bushes: '2', 'Ball joint': '1' },
      build: specBuild(`RearLowerWishbone_${s}`, () => lowerWishboneMeshes(s)),
      material: 'steel',
      stage: 2,
      explodeOffset: out(s, RC.lowerWishbone),
      delay: CORNER_DELAY.links,
      // Its legs cross the wheelhouse liner into the wheel.
      contacts: ['rear-subframe', id('rear-coilover'), 'rear-anti-roll-bar', 'carbon-tub'],
    }),
    fixed({
      id: id('rear-upper-link'),
      name: named(s, 'Rear upper link'),
      group: 'suspension',
      description:
        'Adjustable link from the top of the upright to the subframe. With the lower wishbone it sets the wheel’s camber and how it changes as the suspension moves.',
      specs: { Length: len(RS.upperInner, RS.upperJoint), Ends: 'Rod end + ball joint' },
      build: specBuild(`RearUpperLink_${s}`, () => upperLinkMeshes(s)),
      material: 'steel',
      stage: 2,
      explodeOffset: out(s, RC.upperLink),
      delay: CORNER_DELAY.links,
      contacts: ['rear-subframe', 'carbon-tub'],
    }),
    fixed({
      id: id('rear-toe-link'),
      name: named(s, 'Rear toe link'),
      group: 'suspension',
      description:
        'Holds the upright’s rear arm and so sets the wheel’s toe angle: whether it points slightly in or out. Its length is adjusted at the threaded rod end.',
      specs: { Length: len(RS.toeInner, RS.toeJoint), Ends: 'Rod end + ball joint' },
      build: specBuild(`RearToeLink_${s}`, () => toeLinkMeshes(s)),
      material: 'steel',
      stage: 2,
      explodeOffset: out(s, RC.toeLink),
      delay: CORNER_DELAY.links,
      contacts: ['rear-subframe', 'carbon-tub'],
    }),
    fixed({
      id: id('rear-coilover'),
      name: named(s, 'Rear coilover'),
      group: 'suspension',
      description:
        'Spring and damper in one unit, from the lower wishbone up to the subframe. The spring carries the car; the adaptive damper controls how fast the wheel moves, firming up in milliseconds.',
      specs: { Spring: `Ø${fmtMm(RS.spring.radius * 2, 0)}, ${RS.spring.coils} coils`, Damper: 'Adaptive (magnetorheological)', Length: len(RS.coiloverBottom, RS.coiloverTop) },
      build: specBuild(`RearCoilover_${s}`, () => coiloverMeshes(s)),
      material: 'aluminium',
      stage: 2,
      explodeOffset: out(s, RC.coilover),
      delay: CORNER_DELAY.coilover,
      contacts: ['rear-subframe', 'carbon-tub'],
    }),
  ];
}

const BRAKE_LINE: CableStyle = {
  strands: 1,
  strandRadius: RS.brakeLine.radius,
  offset: 0,
  twist: 0,
  material: 'steel',
  clipMaterial: 'satinBlack',
  clipWidth: 0.008,
  clips: () => [],
};

const brakeLineRoutes: CableRoute[] = SIDES.map((s) => {
  const B = RS.brakeLine;
  const sx = sideSign(s);
  return {
    id: `brake-lines-rear:${s}`,
    style: BRAKE_LINE,
    from: { part: 'rear-subframe', origin: ZERO, at: sidePoint(B.from, s), dir: new Vector3(sx, 0.4, 0).normalize() },
    to: { part: `caliper-r${s}`, origin: ZERO, at: sidePoint(B.to, s), dir: new Vector3(-sx, 0, 0) },
    via: B.via.map((p) => sidePoint(p, s)),
    slack: new Vector3(sx * 0.05, 0.12, 0.06),
  };
});

const suspensionParts: PartDef[] = [
  ...SIDES.flatMap(cornerParts),
  fixed({
    id: 'rear-anti-roll-bar',
    name: 'Rear anti-roll bar',
    group: 'suspension',
    description:
      'Torsion bar across the car under the gearbox, linked to both lower wishbones. In a corner it twists and pushes the inside wheel down, keeping the car flatter.',
    specs: { Bar: `Ø${fmtMm(RS.antiRollBar.radius * 2, 0)}`, 'Drop links': '2' },
    build: specBuild('RearAntiRollBar', antiRollBarMeshes),
    material: 'satinBlack',
    stage: 2,
    // Stays clamped to the subframe: the floor is below it, diffuser strakes behind, the
    // catalysts ahead, and the subframe's wishbone brackets above its arms.
    explodeOffset: ZERO,
    contacts: ['rear-subframe'],
  }),
  fixed({
    id: 'brake-lines-rear',
    name: 'Rear brake lines',
    group: 'suspension',
    description: 'Braided hoses from the chassis hard lines to the rear calipers, flexible so the wheels can move with the suspension.',
    specs: { Lines: '2', Bore: `Ø${fmtMm(RS.brakeLine.radius * 2, 0)}` },
    build: cablesBuild('BrakeLinesRear', brakeLineRoutes),
    material: 'steel',
    stage: 2,
    explodeOffset: ZERO,
    contacts: ['rear-subframe', 'caliper-rl', 'caliper-rr', 'carbon-tub'],
  }),
];

export const chassisParts: PartDef[] = [...fuelParts, ...structureParts, ...suspensionParts];
