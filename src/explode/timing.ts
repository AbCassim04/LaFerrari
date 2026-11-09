import type { Stage } from '../parts/types';

/** Start time (s) of each explode stage. Stages overlap slightly so the motion flows. */
export const STAGE_START: Record<Stage, number> = { 1: 0, 2: 0.75, 3: 1.45, 4: 2.25, 5: 4.2 };

/** Duration (s) of each part's move per stage; the teardown's moves are quicker. The last ends at ~5.2 s. */
export const STAGE_DURATION: Record<Stage, number> = { 1: 1, 2: 1, 3: 1, 4: 0.8, 5: 0.8 };

export const EASE = 'power2.inOut';

/**
 * Stage-1 order (s after the stage starts): the engine cover is the reveal and goes
 * first with the doors, then the roof, the other panels, and finally the rear clam
 * and wing, which must be clear before the powertrain rises in stage 3.
 */
export const BODY_DELAY = {
  engineCover: 0,
  doors: 0,
  canopy: 0.2,
  panels: 0.3,
  rearClam: 0.4,
  rearWing: 0.45,
} as const;

/**
 * Stage-4 teardown, outside to inside (s after the stage starts). Each step waits until
 * the parts covering it have started moving away.
 */
export const TEARDOWN = {
  plenum: 0,
  intake: 0.15,
  runners: 0.3,
  frontCovers: 0.3,
  camCovers: 0.45,
  coilPacks: 0.55,
  camshafts: 0.6,
  sparkPlugs: 0.6,
  heads: 0.75,
  headers: 0.9,
  sump: 1.05,
  ancillaries: 1.05,
  pistons: 1.2,
  crank: 1.35,
} as const;

/**
 * Stage-5 order (s after the stage starts): the transaxle slides off the engine and the
 * battery slides out together, then the clutch and flywheel follow out of the
 * bellhousing, and the e-motor and inverters come off the casing.
 */
export const HYBRID_DELAY = {
  transaxle: 0,
  battery: 0,
  clutch: 0.1,
  flywheel: 0.15,
  eMotor: 0.2,
  inverters: 0.2,
} as const;

/**
 * Stage-2 rear corners and side pods (s after the stage starts). Wheel, caliper, disc,
 * upright and driveshaft start together, each travelling less than the part outboard of
 * it, and the links follow (travelling less again).
 */
export const CORNER_DELAY = {
  disc: 0,
  upright: 0,
  coilover: 0.15,
  links: 0.2,
  bumperBeam: 0.1,
  radiators: 0.15,
} as const;

/** Stage 5: the fuel tank lifts out once the battery has started sliding away beneath it. */
export const FUEL_DELAY = { tank: 0.1, pump: 0.3 } as const;

