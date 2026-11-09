/**
 * Every dimension in the project lives here. Part files read from DIMS / EXPLODE
 * and never hard-code sizes or positions, so proportions can be retuned in one place.
 *
 * Units: metres and radians. Car coordinates: origin on the ground under the centre
 * of the wheelbase, +Z forward, +Y up, +X toward the car's LEFT.
 *
 * Inputs are tagged (ref) = real reference figure, (est) = estimate to refine.
 * Everything under "Derived" is computed from the inputs; edit the inputs instead.
 */

export type Vec3 = readonly [number, number, number];

export interface TyreSize {
  widthMm: number;
  aspectPct: number;
  rimIn: number;
}

interface BayInput {
  halfWidth: number;
  y: [number, number];
  z: [number, number];
}

export interface Box {
  centre: Vec3;
  size: Vec3;
}

const mm = (v: number) => v / 1000;
const inch = (v: number) => v * 0.0254;
const deg = (v: number) => (v * Math.PI) / 180;

/** Axis-aligned box from its bounds. */
function box(x: [number, number], y: [number, number], z: [number, number]): Box {
  return {
    centre: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2],
    size: [Math.abs(x[1] - x[0]), Math.abs(y[1] - y[0]), Math.abs(z[1] - z[0])],
  };
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** (ref) Real-car figures; the body model measures slightly differently (see `model`). */
const overall = { length: 4.702, width: 1.992, height: 1.116 };
const groundClearance = 0.104; // (ref)

/**
 * (model) Measured from the licensed body model by `npm run prep:body`; see
 * docs/body-report.md. Re-run and update these if the model changes (BodyModel also
 * warns in dev when the wheels drift from DIMS). Where the model differed from the
 * reference by < 3 cm, the model's value is adopted so our parts meet its wheels.
 */
const model = {
  /** Adopted; reference 2.650 (Δ +5 mm). */
  wheelbase: 2.655,
  /** Adopted, at tyre centreline; reference 1.680 / 1.610 (Δ +13 / +12 mm). */
  track: { front: 1.6931, rear: 1.6224 },
  /** Wheel-centre heights with the tyre contact patch on y = 0. */
  wheelCentreY: { front: 0.3241, rear: 0.3602 },
  /** Body extents (half width includes the mirrors). */
  extents: { frontZ: 2.5276, rearZ: -2.1962, halfWidth: 1.0573, height: 1.1053 },
  /** Left door hinge: door bbox centre x, top y, front z. The right door mirrors it. */
  doorHinge: [0.5872, 1.105, 1.1797] as Vec3,
  /** Engine-cover hinge: centre of its front (top) edge, from its bbox. */
  engineCoverHinge: [0, 1.0391, -0.5615] as Vec3,
  /**
   * Free space for the powertrain, as boxes with no model geometry inside (2 cm voxels).
   * Bounded by the firewall (rearmost cabin structure spanning both seats, z −0.338),
   * the engine-cover glass above, the floor pan below and the bay side walls. The bay
   * narrows at the top front (roof-intake ducts), hence a tall core plus a wide lower box.
   */
  firewallZ: -0.338,
  engineBay: { halfWidth: 0.34, y: [0.13, 0.75], z: [-1.328, -0.348] } as BayInput,
  engineBayWide: { halfWidth: 0.48, y: [0.13, 0.59], z: [-1.328, -0.588] } as BayInput,
  /** Behind the rear-axle plane, under the rear deck and above the diffuser. */
  transaxleBay: { halfWidth: 0.5, y: [0.21, 0.65], z: [-1.768, -1.328] } as BayInput,
  /** Exhaust openings in the rear bodywork: tip centres (x, both sides), height, exit face, diameter. */
  exhaustOpenings: { x: [0.643, 0.752], y: 0.324, exitZ: -2.07, diameter: 0.122 },
};
const { wheelbase, track } = model;

const tyreSize = {
  front: { widthMm: 265, aspectPct: 30, rimIn: 19 }, // (ref)
  rear: { widthMm: 345, aspectPct: 30, rimIn: 20 }, // (ref)
} satisfies Record<'front' | 'rear', TyreSize>;

const rimWidthIn = { front: 9.5, rear: 13 }; // (est)
const tyreShoulderRadius = mm(22); // (est) tread-to-sidewall fillet

const brakeDiscDiameter = { front: mm(398), rear: mm(380) }; // (ref)

/**
 * The V12 at true scale: everything below is sized from bore, stroke, spacing and bank
 * angle plus estimated proportions, never shrunk to fit the bay (the clash check proves
 * the fit). Engine coordinates: x and z are car axes, y is measured from the crank
 * centreline. Bank-local coordinates: `a` runs up the bore axis from the crank centreline
 * (or from the deck where noted), `b` across the bank, positive outboard (exhaust side).
 */
const engine = {
  cylinders: 12, // (ref)
  bankAngle: deg(65), // (ref)
  bore: mm(94), // (ref)
  stroke: mm(75.2), // (ref)
  cylinderSpacing: mm(104), // (ref) bore centre to bore centre within a bank
  rodLength: mm(140), // (est) centre to centre
  /** (est) Rods share each crankpin side by side, so the right bank sits one rod width behind the left. */
  bankStagger: mm(22),
  crankHeight: 0.275, // (est) crank centreline above ground
  /** (est) Front face of the timing cover. The timing end faces the cabin, 22 mm clear of the firewall. */
  frontZ: -0.36,
  /** Six-throw crank laid out like an inline six; cylinders 1–6 counted from the timing end. */
  throwAngles: [0, 240, 120, 120, 240, 0].map(deg),
  /** Firing order within each bank (inline-six order); throws match it 120° apart. */
  bankFiringOrder: [1, 5, 3, 6, 2, 4],
  /** (est) Crank angle of the assembled pose, so pistons and valves sit at varied, real phases. */
  crankPhase: deg(20),
};

/** (est) Detail sizes of the engine's parts; see the coordinate note above `engine`. */
const engineParts = {
  piston: {
    compressionHeight: mm(29), // wrist-pin centre to crown
    height: mm(54), // crown to skirt bottom
    crownDome: mm(2),
    ringClearance: mm(0.2), // piston to bore; rings stand this far proud of the lands
    skirtWall: mm(4),
    chamfer: mm(0.8),
    /** Ring grooves: distance of each ring's centre below the crown, and ring height. */
    rings: [
      { depth: mm(5.5), height: mm(1.2) },
      { depth: mm(9.5), height: mm(1.2) },
      { depth: mm(14), height: mm(2.5) },
    ],
    pin: { radius: mm(10.5), length: mm(62) },
  },
  rod: {
    bigEndRadius: mm(35),
    smallEndRadius: mm(14),
    clearance: mm(1), // side clearance between the two rods on a crankpin
    boltRadius: mm(5),
    boltHeight: mm(5),
    /** Cap-bolt heads sit this fraction of the big-end radius below the crankpin. */
    boltDrop: 0.95,
  },
  crank: {
    mainJournalRadius: mm(30),
    pinRadius: mm(24),
    webThickness: mm(16),
    webPinRadius: mm(33),
    webHubRadius: mm(40),
    counterweightRadius: mm(80),
    counterweightHalfAngle: deg(62),
    snoutRadius: mm(22),
    flangeRadius: mm(46),
    flangeThickness: mm(12),
    shellThickness: mm(1.5),
  },
  block: {
    /** Timing-cover face to the block's front face: the depth of the timing case. */
    timingCaseDepth: mm(45),
    /** Block end face to the nearest bore centre. */
    endWall: mm(64),
    /** Half width of each cylinder barrel across its bank. */
    deckHalfWidth: mm(70),
    /** Bores open into the crankcase this far up the bank axis (`a`). */
    barrelBottom: mm(80),
    skirtHalfWidth: mm(155),
    /** Crankcase floor (y), with the main caps below it and the pan rail around them. */
    bottomY: -mm(70),
    panRail: { y: -mm(85), halfWidth: mm(165), width: mm(14) },
    rib: { width: mm(12), depth: mm(7) },
    /** Horizontal rib along each skirt (height above the crank) and cast bosses on the skirt. */
    skirtRibY: mm(20),
    boss: { radius: mm(16), depth: mm(9), y: -mm(28), z: [-0.58, -0.84] as const },
    liner: { thickness: mm(3.5), proud: mm(0.6) },
    mainCap: { width: mm(30), halfWidth: mm(112), depth: mm(10) }, // bolt heads finish flush with the pan rail
    /** Main-cap bolts: x offsets of the four per cap. */
    capBoltX: [mm(45), mm(88)],
    bolt: { radius: mm(7.5), height: mm(5) },
  },
  head: {
    gasketThickness: mm(1.5),
    /** Casting height from its deck face (`a` from the deck). */
    height: mm(110),
    halfWidth: mm(118),
    topHalfWidth: mm(108),
    /** Height up to which the side walls are vertical before they taper in. */
    wallHeight: mm(70),
    exhaustPort: { a: mm(42), width: mm(40), height: mm(32), depth: mm(14) },
    intakePort: { a: mm(60), width: mm(44), height: mm(34), depth: mm(16) },
    /** Top plate of the casting, pierced by the plug wells. */
    topDeck: mm(12),
    bolt: { radius: mm(7), height: mm(9), inset: mm(14) },
    plugWell: { radius: mm(15), wall: mm(3), top: mm(190) },
  },
  valve: {
    /** Each valve leans this far from the bore axis (intake inboard, exhaust outboard). */
    angle: deg(11),
    pairSpacing: mm(36),
    seatOffset: mm(20),
    intakeHeadDiameter: mm(36),
    exhaustHeadDiameter: mm(30),
    stemDiameter: mm(6),
    faceThickness: mm(2),
    tulipHeight: mm(10),
    length: mm(135),
    spring: { radius: mm(11.5), wire: mm(1.8), coils: 6, length: mm(32) },
    retainer: { radius: mm(13), height: mm(4) },
    /** Valve events in crank degrees after firing TDC, and half the opening duration. */
    intakePeak: deg(470),
    exhaustPeak: deg(250),
    halfDuration: deg(120),
  },
  camshaft: {
    shaftRadius: mm(12),
    journalRadius: mm(16.5),
    journalWidth: mm(16),
    baseRadius: mm(17.5),
    lift: mm(11),
    lobeWidth: mm(14),
    tower: { halfWidth: mm(18), thickness: mm(16), capHeight: mm(14) },
    sprocket: { radius: mm(37), thickness: mm(8), teeth: 30 },
  },
  camCover: {
    height: mm(90),
    baseHalfWidth: mm(104), // sits inside the head's top face
    topHalfWidth: mm(82),
    cornerRadius: mm(26),
    edgeRadius: mm(6),
    flange: { halfWidth: mm(116), height: mm(8) },
    /** Raised seats for the coil packs over each plug well. */
    seatRadius: mm(22),
    seatHeight: mm(3),
    boltsPerSide: 10,
    boltEndInset: mm(20),
    bolt: { radius: mm(5), height: mm(6) },
  },
  coilPack: {
    length: mm(54),
    width: mm(30),
    height: mm(30),
    yaw: deg(20),
    bootRadius: mm(11),
    connector: [mm(16), mm(12), mm(18)] as Vec3,
  },
  /** Spark plug, measured up its axis from the head's deck face (`tip` is in the chamber). */
  sparkPlug: {
    tip: mm(6),
    top: mm(100),
    threadRadius: mm(7),
    hexStart: mm(20),
    hexHeight: mm(12),
    hexRadius: mm(9),
    insulatorRadius: mm(5.5),
    insulatorTaper: mm(10),
    terminalRadius: mm(3),
    terminalHeight: mm(6),
  },
  timing: {
    coverThickness: mm(12),
    /** Cover outline clearance around the sprockets it encloses. */
    coverMargin: mm(20),
    coverBolts: 16,
    coverBevel: mm(5),
    /** The flat plate stops this far short of the cover face; the chain housings bulge forward to it. */
    bulge: mm(12),
    bulgeMargin: mm(10),
    rimWidth: mm(9),
    rimHeight: mm(4),
    /** Bosses around the water pumps and aux motor, tied back to the cover by webs. */
    bossMargin: mm(10),
    bossDepth: mm(20),
    webWidth: mm(16),
    /** Cover bolts sit this far in from the cover's edge. */
    boltInset: mm(9),
    /** Chain planes, measured forward from the block's front face. */
    chainOffset: { l: mm(13), r: mm(25) },
    crankSprocketRadius: mm(28),
    sprocketThickness: mm(8),
    /** 3/8" pitch; each link drawn as a rounded plate filling most of its pitch. */
    chain: { pitch: mm(9.525), width: mm(9), height: mm(8.5), linkFill: 0.92 },
  },
  sump: {
    depth: mm(45),
    halfWidth: mm(150),
    cornerRadius: mm(35),
    flange: { halfWidth: mm(165), thickness: mm(6) },
    boltsPerSide: 9,
    /** Scavenge pick-ups along the right side, as z positions of their sump outlets. */
    pickupZ: [-0.52, -0.76, -1.0],
    outletRadius: mm(10),
    outletLength: mm(14),
    outletY: -mm(110), // engine y of the outlets
    pickupRadius: mm(7),
    /** The scavenge lines run this far below the pump's underside. */
    pickupDrop: mm(12),
    endBoltX: [-mm(100), 0, mm(100)],
  },
  /** Dry-sump scavenge pump, low on the right beside the sump (engine coordinates). */
  oilPump: {
    radius: mm(34),
    length: mm(160),
    centre: [-mm(205), -mm(72), -0.53] as Vec3,
    capLip: mm(4),
    capThickness: mm(8),
    driveRadius: mm(12),
    driveLength: mm(30),
  },
  /** Vertical spin-on filter, low on the left near the bellhousing. */
  oilFilter: { radius: mm(38), length: mm(100), top: -mm(30), x: mm(200), z: -0.98, round: mm(8), seal: mm(8), adapterHeight: mm(18) },
  oilCooler: {
    size: [mm(45), mm(100), mm(140)] as Vec3,
    centre: [-mm(178), -mm(10), -0.91] as Vec3,
    fins: 12,
    finDepth: mm(8),
    finThickness: mm(2),
    portRadius: mm(9),
    portLength: mm(18),
  },
  /** Dry-sump tank, on top of the gearbox between the airboxes (car z). */
  oilTank: {
    radius: mm(75),
    length: mm(300),
    y: mm(385),
    z: -1.62,
    fins: 9,
    finRadius: mm(83),
    finThickness: mm(3),
    neckRadius: mm(18),
    neckHeight: mm(25),
    capHeight: mm(12),
    /** Straps round the tank, at this fraction of its half-length either side of centre. */
    strap: { at: 0.55, width: mm(16), thickness: mm(3) },
  },
  waterPump: {
    radius: mm(45),
    length: mm(38),
    /** Centre (x, y) on the block's front face, outboard of the timing cover. */
    centre: [mm(200), mm(60)] as const,
    faceScale: 0.75,
    faceThickness: mm(8),
    inlet: { radius: mm(17), length: mm(55) },
  },
  /** Auxiliary e-motor, low on the left at the timing end; its front sits in the timing case. */
  auxMotor: {
    radius: mm(50),
    length: mm(150),
    centre: [mm(205), -mm(75)] as const,
    frontGap: mm(20),
    capThickness: mm(10),
    capScale: 0.92,
    fins: 8,
    finHeight: mm(4),
    finThickness: mm(3),
    connector: [mm(36), mm(22), mm(44)] as Vec3,
  },
  mount: {
    bracket: [mm(60), mm(70), mm(80)] as Vec3,
    bushRadius: mm(30),
    bushLength: mm(60),
    /** Fraction of the bush radius it sits outboard of the bracket's end. */
    bushOverlap: 0.6,
    y: mm(10),
    z: -0.7,
  },
  /** Bevel on cast and machined edges. */
  bevel: mm(2.5),

  // ─── 2b: intake, fuel, exhaust, electronics (engine coordinates) ──────────
  /** Carbon plenum cover: a long lofted "pillow" over the V, overhanging the coil packs. */
  plenum: {
    rearZ: -1.05,
    frontGap: mm(20), // behind the timing-cover face
    halfWidth: mm(235),
    baseY: mm(400), // underside, clear of the coil packs
    topY: mm(545),
    /** Superellipse exponents: plan-view ends (higher = squarer) and cross-section shoulders. */
    endPower: 3.2,
    sectionPower: 2.4,
    /** Height of the side wall below the curved crown, as a fraction of the height. */
    skirt: 0.28,
    flutes: { perSide: 3, depth: mm(4), width: mm(26), pitch: mm(44) },
    centreGroove: { depth: mm(7), width: mm(30) },
    seamRadius: mm(2.6),
    lipHeight: mm(6),
  },
  /** Intake runners: one vertical trumpet per cylinder, rising from the port into the plenum. */
  runner: { x: mm(36), bottomY: mm(300), topY: mm(440), radius: mm(19), bellRadius: mm(27), bellHeight: mm(22), flangeRadius: mm(27), flangeThickness: mm(6) },
  throttleBody: {
    x: mm(155),
    y: mm(470),
    /** Front face (against the plenum's rear end) and body length along −z. */
    frontZ: -1.04,
    length: mm(75),
    radius: mm(42),
    flange: { radius: mm(52), thickness: mm(8) },
    actuator: [mm(48), mm(44), mm(56)] as Vec3,
  },
  /** Ribbed intake tubes from each throttle body back and out to its airbox. */
  intakeTube: {
    radius: mm(45),
    ribDepth: mm(5),
    ribPitch: mm(17),
    /** Path (x, y, z) from the throttle body's rear face to the airbox mouth. */
    path: [
      [mm(155), mm(470), -1.115],
      [mm(185), mm(462), -1.2],
      [mm(240), mm(420), -1.31],
      [mm(262), mm(385), -1.4],
    ] as readonly Vec3[],
    clamp: { width: mm(14), thickness: mm(4) },
  },
  /** Carbon airboxes beside the gearbox, each fed from its rear-deck scoop. */
  airbox: {
    x: [mm(170), mm(370)] as const,
    y: [mm(225), mm(420)] as const,
    z: [-1.78, -1.42] as const,
    cornerRadius: mm(35),
    /** Intake snout out of the outboard face, toward the side scoop (clear of the tub's ducting). */
    snout: { z: -1.55, y: mm(325), length: mm(85), radius: mm(48), bell: mm(8) },
    lid: { inset: mm(10), height: mm(8) },
    /** Satin brackets under the inboard edge, reaching to the gearbox casing's side. */
    bracket: { size: [mm(40), mm(6), mm(30)] as Vec3, overlap: mm(15), z: [-1.5, -1.7] as readonly number[] },
  },
  /** Direct-injection fuel rails along the V side of each head, injectors into the head. */
  fuelRail: { b: -mm(132), a: mm(30), radius: mm(8), injectorRadius: mm(6), injectorLength: mm(28) },
  exhaust: {
    primaryRadius: mm(17),
    /** Straight run out of each port before the primary bends. */
    portLead: mm(35),
    /** Rearward lanes for the front two pairs of primaries (x, y), and each pair's twist. */
    laneA: [mm(405), -mm(35)] as const,
    laneB: [mm(405), mm(80)] as const,
    pairSpacing: mm(43),
    twistA: deg(360),
    twistB: deg(180),
    /** Inboard path the two rear primaries drop down, before swinging into the collector. */
    dropX: mm(290),
    /** Collector mouth: centre (x, y), how far behind the bank's last port, ring of the six tubes. */
    collector: { centre: [mm(360), -mm(70)] as const, behindLastPort: mm(95), ringRadius: mm(46), length: mm(70), outletRadius: mm(40) },
    /** Convergence from the lanes onto the collector ring starts this far ahead of the mouth. */
    converge: mm(150),
    flange: [mm(44), mm(36), mm(8)] as Vec3,
    catalyst: { radius: mm(58), length: mm(190), gap: mm(25) },
    pipeRadius: mm(36),
    /** Pipe route (left side) from the catalyst: kept inboard of the tub's rear wall, then out into the silencer's inboard face. */
    pipeVia: [[mm(420), -mm(35), -1.55], [mm(500), mm(25), -1.72]] as readonly Vec3[],
    pipeFlange: { radius: mm(50), thickness: mm(8) },
    silencer: { x: [mm(585), mm(800)] as const, y: [-mm(5), mm(135)] as const, z: [-1.92, -1.74] as const, corner: mm(30) },
    tip: { radius: mm(54), lip: mm(4), length: mm(150) },
    o2Sensor: { radius: mm(9), length: mm(40) },
  },
  /**
   * Engine ECUs against the bay side walls (left-side centre; mirrored), and the fuse/relay
   * box ahead of the right ECU. `yaw` follows the walls, which close in toward the rear.
   */
  ecu: {
    size: [mm(36), mm(150), mm(180)] as Vec3,
    centre: [mm(563), mm(195), -0.7] as Vec3,
    fins: 8,
    tab: [mm(14), mm(40), mm(22)] as Vec3,
    /** Harness route (left side; engine coordinates) from the plug toward the cam cover's outer edge. */
    harness: [[mm(480), mm(298), -0.69], [mm(390), mm(296), -0.67], [mm(305), mm(300), -0.64]] as readonly Vec3[],
    harnessRadius: mm(8),
  },
  fuseBox: { size: [mm(36), mm(110), mm(100)] as Vec3, centre: [-mm(612), mm(190), -0.53] as Vec3 },
  bayWallYaw: deg(15.6),
  /** Ignition loom along each cam cover's top, inboard of the coil packs (`b` across the bank). */
  loom: { b: -mm(55), radius: mm(7), clips: 12, clip: [mm(16), mm(8), mm(10)] as Vec3 },
};

/**
 * 2c: transaxle, clutch and hybrid parts that ride the powertrain, in engine coordinates
 * (x, z car axes; y from the crank axis, which is also the gearbox input axis).
 * (est) proportions from the layout figures and reference photos; the DCT is a
 * 7-speed with the differential on the rear axle line and the main e-motor at the back.
 */
const transaxleInput = {
  flywheel: { radius: mm(115), thickness: mm(24), gap: mm(5), bolts: 8, boltCircle: mm(42), teeth: 110, toothDepth: mm(4) },
  clutch: { radius: mm(106), length: mm(84), gap: mm(6), ribs: 9, hubRadius: mm(38), plateRadius: mm(112) },
  /** Bellhousing: from the block's rear face back to the casing, round the flywheel and clutch. */
  bellhousing: { rearZ: -1.22, halfWidth: mm(200), topHalfWidth: mm(170), bottom: -mm(125), top: mm(185), radius: mm(55), flange: mm(10), bolts: 16 },
  /** DCT casing section at its front (rear section scaled in `casingRear`), with the lattice. */
  casing: {
    rearZ: -1.78, // the tub's rear structure is at z −1.97, behind the e-motor
    halfWidth: mm(190),
    topHalfWidth: mm(150),
    bottom: -mm(95),
    top: mm(305),
    radius: mm(60),
    /** Rear section: narrower and centred on the e-motor axis. */
    rear: { halfWidth: mm(160), topHalfWidth: mm(140), bottom: -mm(60), top: mm(290) },
    /** Rib rings (z) with seam bolts round them; X ribs on the sides and top between rings. */
    rings: [-1.24, -1.44, -1.61, -1.765] as readonly number[],
    seamRings: [0, 2, 3] as readonly number[],
    ringWidth: mm(12),
    ringHeight: mm(7),
    xRib: mm(4.5),
    seamBolts: 20,
  },
  /** Differential bosses on each side, on the rear axle line; driveshaft output flanges. */
  diff: { radius: mm(95), y: mm(75), outX: mm(225), coverBolts: 10, coverBoltCircle: mm(78), flangeRadius: mm(48), flangeLength: mm(16) },
  gears: { shaftRadius: mm(20), layshaftX: mm(85), layshaftY: -mm(10), thickness: mm(18) },
  eMotor: { radius: mm(120), length: mm(155), boss: mm(10), y: mm(165), flange: mm(12), capInset: mm(8), bolts: 12, boltCircle: mm(98), ribs: 5, terminal: [mm(80), mm(40), mm(60)] as Vec3 },
  /** Inverters on the casing top (left-side box; mirrored), X-braced lids. */
  inverter: { x: [mm(20), mm(160)] as const, bottom: mm(318), height: mm(62), z: [-1.46, -1.24] as const, lid: mm(6), brace: mm(10), bolts: 8, foot: mm(20) },
};

/**
 * 2c in car coordinates: battery tray, driveshafts and HV cables. Battery per the
 * approved plan: on the underbody under the cabin floor, 20 mm deep at the back stepping
 * to 42 mm at the front where the floor rises.
 */
const hybridInput = {
  battery: {
    halfWidth: 0.45,
    z: [-0.1, 0.55] as const,
    bottomY: 0.11,
    /** 18 mm at the back (the plan's 20 mm left no room under the floor at y 0.131), 42 mm at the front. */
    depth: mm(18),
    step: { z: 0.36, depth: mm(42) },
    flange: mm(12),
    bolts: 28,
    /** Modules: 2 rows × 4, barely raised on the lid (the cabin floor is only a few mm above). */
    modules: { cols: 4, rows: 2, height: mm(1.2), margin: mm(30), gap: mm(14) },
    boltHeight: mm(1.2),
    connector: [mm(90), mm(30), mm(50)] as Vec3,
  },
  driveshaft: { shaftRadius: mm(15), cvRadius: mm(46), cvLength: mm(60), bootRadius: mm(40), bootLength: mm(95), bootRibs: 6, stubRadius: mm(24), outerX: 0.7, innerCvGap: mm(4) },
  /**
   * HV bundles. `slackGrowth`: how much end separation (m) brings in the full explode slack;
   * each cable's own slack (how far its middle bows out) is set with its route.
   */
  hvCable: { strandRadius: mm(7), bundleOffset: mm(8.5), twist: 0.6, clip: [mm(28), mm(10), mm(22)] as Vec3, clipSpacing: 0.25, slackGrowth: 0.6 },
  /**
   * Coolant hoses (left; mirrored) from each water pump's inlet, low and ahead of the
   * header primaries, out through the bay wall to the side-pod radiator area (the
   * radiators themselves are 2d). Car coordinates.
   */
  coolantHose: {
    radius: mm(19),
    clampWidth: mm(12),
    clamps: [0.03, 0.35, 0.65, 0.97] as readonly number[],
    radiatorEnd: [0.62, 0.26, -0.53] as Vec3,
    via: [[0.345, 0.215, -0.395], [0.43, 0.215, -0.425], [0.52, 0.235, -0.48]] as readonly Vec3[],
    slack: [0.2, 0.1, 0.1] as Vec3,
  },
};

/**
 * 2d in car coordinates, left side (mirrored for the right): side-pod radiators, coolant
 * expansion tank, fuel system, rear subframe and bumper beam, rear suspension and
 * brakes. Laid out against slices of the body model and our parts (dev
 * `window.__slice`, scripts/dev/model-slices.mjs): the subframe rails run outboard of
 * the exhaust and inboard of the wheelhouse liner (x ≈ 0.61); the suspension crosses the
 * liner and the bay side walls into the wheel, as the approved plan allows.
 */
const chassisInput = {
  /**
   * Radiators lie under the side-intake grilles, parallel to them (the grilles face up,
   * out and slightly forward, rising toward the rear). `along`: the core's long axis,
   * rising rearward; `normal`: out of the core toward the grille.
   */
  radiator: {
    centre: [0.787, 0.437, -0.616] as Vec3,
    along: [0.109, 0.571, -0.815] as Vec3,
    normal: [0.54, 0.65, 0.53] as Vec3,
    /** Core across × along, and thickness. */
    core: [mm(190), mm(300), mm(34)] as Vec3,
    /** End tanks at both ends of the core (along), and the outlet from the front tank. */
    tank: { length: mm(26), radius: mm(24) },
    fins: 30,
    /** Outlet from the underside of the front tank, near its inboard end, down to the hose at the bay wall. */
    outlet: { radius: mm(17), inboard: mm(55), via: [[0.676, 0.305, -0.5]] as readonly Vec3[] },
  },
  /**
   * Expansion tank along z outboard of the plenum cover's left wall, above the cam cover
   * (rides the engine); short legs at `legX` (just outboard of the coil packs) down to the
   * cam cover's outer shoulder at `footY`. Inboard of the tub ledge at x 0.32 and behind
   * the roof-intake duct, so it lifts clear of both.
   */
  coolantTank: { centre: [0.282, 0.7, -0.73] as Vec3, radius: mm(34), length: mm(140), capRadius: mm(19), capHeight: mm(13), legX: mm(263), footY: mm(598) },
  /**
   * Fuel tank in the slot behind the seats (the model has no bulkhead panel there): a
   * prism whose front face follows the reclined seat backs, strapped to the tub, clear of
   * the floor so the HV battery cable runs underneath it.
   */
  fuelTank: {
    halfWidth: mm(440),
    /** Section (y, z): bottom-front, bottom-rear, top-rear, top-front. */
    section: [[0.17, -0.06], [0.17, -0.29], [0.52, -0.29], [0.52, -0.185]] as readonly (readonly [number, number])[],
    corner: mm(30),
    strapX: [-mm(250), mm(250)] as readonly number[],
    strap: { width: mm(30), thickness: mm(3) },
    /** Pump flange on the top, filler neck at the right end. */
    pump: { x: mm(110), z: -0.235, radius: mm(52), height: mm(26) },
    filler: { x: -mm(360), z: -0.23, radius: mm(30), height: mm(70) },
  },
  /** Feed lines over the front of the engine (car coordinates, left; ± 16 mm apart in x). */
  fuelLine: { radius: mm(5), via: [[0.06, 0.65, -0.3]] as readonly Vec3[] },
  rearSuspension: {
    /** Subframe rails (x, y), from the front post to the rear post (z). */
    upperRail: [mm(550), mm(585)] as const,
    lowerRail: [mm(520), mm(225)] as const,
    railZ: [-0.98, -1.64] as const,
    /** The lower rail stops short so the rear post rakes forward over the exhaust pipe climbing to the silencer. */
    lowerRailEnd: -1.58,
    railRadius: mm(20),
    /** Extra post between the rails, ahead of the driveshaft. */
    midPostZ: -1.15,
    /** Pickup points (left side). LJ/UJ/TJ: ball joints on the upright; LF/LR/UI/TI: chassis pivots. */
    lowerJoint: [mm(690), mm(180), -1.33] as Vec3,
    lowerFront: [mm(560), mm(205), -1.14] as Vec3,
    lowerRear: [mm(560), mm(205), -1.5] as Vec3,
    upperJoint: [mm(700), mm(545), -1.36] as Vec3,
    upperInner: [mm(585), mm(560), -1.36] as Vec3,
    toeJoint: [mm(690), mm(310), -1.51] as Vec3,
    toeInner: [mm(565), mm(300), -1.54] as Vec3,
    /** Coilover: lower eye on the wishbone's rear leg, top eye under the upper rail. */
    coiloverBottom: [mm(621), mm(226), -1.42] as Vec3,
    coiloverTop: [mm(560), mm(552), -1.46] as Vec3,
    armRadius: mm(14),
    linkRadius: mm(11),
    jointRadius: mm(22),
    jointHeight: mm(20),
    bushRadius: mm(20),
    bushLength: mm(36),
    clevisPlate: mm(5),
    /** The spring runs from the lower seat almost to the top eye (its length is capped by the unit's). */
    spring: { radius: mm(42), wire: mm(6), coils: 7, length: mm(260) },
    damper: { radius: mm(23), shaftRadius: mm(8), eyeRadius: mm(16) },
    /** Upright: bearing housing (x span, radius) round the hub axis, cast web thickness. */
    housing: { x: [mm(672), mm(775)] as const, radius: mm(62), bore: mm(30) },
    web: { x: [mm(686), mm(722)] as const, armRadius: mm(22) },
    /** Caliper lugs reaching the model caliper's inboard face. */
    caliperLugs: { x: [mm(696), mm(726)] as const, z: -1.215, y: [mm(270), mm(480)] as readonly number[], size: [mm(36), mm(30)] as const },
    hub: { radius: mm(45), flangeRadius: mm(75), x: [mm(775), mm(811)] as const, flange: mm(11), studs: 5, studCircle: mm(52) },
    /** Carbon-ceramic disc: faces (x), friction ring radii, vanes, cross-drilling, bell. */
    disc: {
      x: [mm(782), mm(812)] as const,
      innerRadius: mm(118),
      vaneGap: mm(12),
      vanes: 36,
      holeRadius: mm(3.5),
      holeRings: [mm(140), mm(155), mm(170)] as readonly number[],
      holesPerRing: 24,
      bell: { radius: mm(112), x: [mm(797), mm(817)] as const, face: mm(6), boreRadius: mm(36), bolts: 10, boltCircle: mm(92) },
    },
    /** Anti-roll bar under the gearbox casing (y), arms forward to drop links on the wishbones. */
    antiRollBar: { y: mm(174), z: -1.66, halfWidth: mm(500), radius: mm(10), armEnd: [mm(580), mm(172), -1.475] as Vec3, bushX: mm(420) },
    /** Brake hose from a chassis fitting on the lower rail to the caliper's inboard face. */
    brakeLine: { radius: mm(3.5), from: [mm(540), mm(255), -1.08] as Vec3, to: [mm(726), mm(470), -1.165] as Vec3, via: [[0.6, 0.34, -1.1], [0.68, 0.44, -1.13]] as readonly Vec3[] },
  },
  /** Box-section bumper beam behind the e-motor, on crash cans off the model's rear frame. */
  bumperBeam: { halfWidth: mm(540), y: [mm(405), mm(505)] as const, z: [-2.05, -1.99] as const, crashCanX: mm(470), crashCanZ: -1.92, bolts: 8 },
};

// ─── Derived ─────// ─── Derived ─────────────────────────────────────────────────────────────────

const axle = { frontZ: wheelbase / 2, rearZ: -wheelbase / 2 };

export interface WheelDims {
  tyre: TyreSize;
  sectionWidth: number;
  sidewall: number;
  rimRadius: number;
  rimWidth: number;
  shoulderRadius: number;
  /** Tyre outer radius from the tyre size. */
  radius: number;
  diameter: number;
  centreY: number;
  /** Lateral distance from centreline to tyre centre (half track). */
  centreX: number;
  axleZ: number;
  discDiameter: number;
}

function wheel(t: TyreSize, trackWidth: number, centreY: number, rimIn: number, axleZ: number, disc: number): WheelDims {
  const sidewall = mm((t.widthMm * t.aspectPct) / 100);
  const rimRadius = inch(t.rimIn) / 2;
  const radius = rimRadius + sidewall;
  return {
    tyre: t,
    sectionWidth: mm(t.widthMm),
    sidewall,
    rimRadius,
    rimWidth: inch(rimIn),
    shoulderRadius: tyreShoulderRadius,
    radius,
    diameter: radius * 2,
    centreY,
    centreX: trackWidth / 2,
    axleZ,
    discDiameter: disc,
  };
}

const body = {
  frontZ: model.extents.frontZ,
  rearZ: model.extents.rearZ,
  halfWidth: overall.width / 2,
  height: model.extents.height,
};

function bayBox(b: BayInput): Box {
  return box([-b.halfWidth, b.halfWidth], b.y, b.z);
}

/** Engine layout derived from the inputs: bore positions, deck, block faces, extents. */
function engineLayout() {
  const { piston, block, head, camCover, timing } = engineParts;
  const crankRadius = engine.stroke / 2;
  /** Crank centreline to the block deck, along a bank axis (piston crown flush at TDC). */
  const deckHeight = crankRadius + engine.rodLength + piston.compressionHeight;
  const blockFrontZ = engine.frontZ - block.timingCaseDepth;
  const firstBore = { l: blockFrontZ - block.endWall, r: blockFrontZ - block.endWall - engine.bankStagger };
  const perBank = engine.cylinders / 2;
  const boreZ = {
    l: Array.from({ length: perBank }, (_, i) => firstBore.l - i * engine.cylinderSpacing),
    r: Array.from({ length: perBank }, (_, i) => firstBore.r - i * engine.cylinderSpacing),
  };
  const blockRearZ = boreZ.r[perBank - 1] - block.endWall;
  /** Crank throws sit midway between their left and right bores. */
  const throwZ = boreZ.l.map((z) => z - engine.bankStagger / 2);
  const halfBank = engine.bankAngle / 2;
  /** Cam-cover top, along the bank axis from the crank centreline. */
  const coverTop = deckHeight + head.gasketThickness + head.height + camCover.height;
  const cover = { a: coverTop, b: camCover.topHalfWidth };
  /** Widest point across the heads: the cam-cover top's outboard edge. */
  const halfWidthAcrossCovers = cover.a * Math.sin(halfBank) + cover.b * Math.cos(halfBank);
  return {
    crankRadius,
    deckHeight,
    blockFrontZ,
    blockRearZ,
    blockLength: blockFrontZ - blockRearZ,
    boreZ,
    throwZ,
    /** Chain planes (car z) of each bank's timing chain. */
    chainZ: { l: blockFrontZ + timing.chainOffset.l, r: blockFrontZ + timing.chainOffset.r },
    halfBank,
    coverTop,
    widthAcrossCovers: 2 * halfWidthAcrossCovers,
    /** Cam-cover top's inboard edge, the highest point of the heads, above the crank. */
    coverTopY: cover.a * Math.cos(halfBank) + cover.b * Math.sin(halfBank),
    sumpBottomY: block.panRail.y - engineParts.sump.depth,
  };
}
const engineGeom = engineLayout();

export const DIMS = {
  overall,
  wheelbase,
  track,
  groundClearance,
  overhang: { front: body.frontZ - axle.frontZ, rear: axle.rearZ - body.rearZ },
  exhaustOpenings: model.exhaustOpenings,
  bays: {
    firewallZ: model.firewallZ,
    engine: bayBox(model.engineBay),
    engineWide: bayBox(model.engineBayWide),
    transaxle: bayBox(model.transaxleBay),
  },
  axle,
  body: {
    ...body,
    centreZ: (body.frontZ + body.rearZ) / 2,
    doorHinge: { l: model.doorHinge, r: [-model.doorHinge[0], model.doorHinge[1], model.doorHinge[2]] as Vec3 },
    engineCoverHinge: model.engineCoverHinge,
  },
  wheel: {
    front: wheel(tyreSize.front, track.front, model.wheelCentreY.front, rimWidthIn.front, axle.frontZ, brakeDiscDiameter.front),
    rear: wheel(tyreSize.rear, track.rear, model.wheelCentreY.rear, rimWidthIn.rear, axle.rearZ, brakeDiscDiameter.rear),
  },
  engine: {
    ...engine,
    ...engineGeom,
    ...engineParts,
    /** Engine coordinates' origin in car coordinates: on the crank centreline at z = 0. */
    origin: [0, engine.crankHeight, 0] as Vec3,
    /** Timing-cover face to the block's rear (bellhousing) face. */
    length: engine.frontZ - engineGeom.blockRearZ,
    /** Swept volume in cc, from bore and stroke (checks against the 6262 cc reference). */
    displacementCc: (Math.PI / 4) * engine.bore ** 2 * engine.stroke * engine.cylinders * 1e6,
  },
  transaxle: transaxleInput,
  ...hybridInput,
  ...chassisInput,
} as const;

const batteryClearOfBody = 0.25; // gap between exploded battery and the body side

/** How far parts travel when exploded (metres / radians, car axes). */
export const EXPLODE = {
  door: { pitch: deg(70), roll: deg(18) },
  /** The reveal: lifts first and highest, opening about its front hinge like the real lid. */
  engineCoverLift: 2.4,
  engineCoverTilt: deg(35),
  /** Clears the swung-up doors (their tips reach ~2.5 m). */
  canopy: [0, 1.8, 0.15] as Vec3,
  frontClam: [0, 0.8, 0.5] as Vec3,
  nose: [0, 0, 1.1] as Vec3,
  /** Up and back, clear of the space the powertrain rises through. */
  rearClam: [0, 0.9, -2.0] as Vec3,
  /** Above the moved rear clam. */
  rearWing: [0, 1.9, -2.0] as Vec3,
  sideIntakeOut: 0.5,
  diffuserBack: 0.6,
  wheelOut: 0.75,
  /** Calipers follow the wheels part of the way (they live on the uprights). */
  caliperOut: 0.45,
  powertrainLift: 1.2,
  /**
   * Stage-4 teardown. Bank parts travel along their bank axis; the comments give what
   * each distance has to clear (all relative to the part they ride on).
   */
  engine: {
    camCover: 0.25, // clears the cams after they lift
    coilPacks: 0.14, // boots clear of the cover top
    sparkPlugs: 0.1, // up between the lifted cams
    camshafts: 0.12, // lobes clear of the springs and towers
    head: 0.47, // above the gasket
    gasket: 0.4, // above the risen pistons' crowns
    pistons: 0.36, // skirts above the risen rods' small ends
    rods: 0.3, // big ends (and cap bolts) clear of the deck
    crankDrop: 0.25,
    /** Clears the dropped crank, but keeps the scavenge pump above the bay's top-front ducts. */
    sumpDrop: 0.29,
    timingCover: 0.22, // forward, toward the cabin
    timingChains: 0.1, // forward, out of the sprockets' way as the heads lift
    waterPump: 0.15, // forward, outboard of the timing cover
    auxMotor: [0.02, -0.2, 0.15] as Vec3, // down and forward, under the coolant hose (beside the dropped sump)
    mount: 0.15, // outboard
    oilFilter: 0.12, // outboard
    oilCooler: [-0.1, -0.12, 0] as Vec3, // down and out, under the swung headers
    oilTank: 0.3, // up off the gearbox
    // 2b
    plenum: 0.55, // first and highest: the lid of the engine
    runners: 0.3, // up out of the V, below the lifted plenum
    throttleBody: [0, 0.35, -0.1] as Vec3,
    intakeTube: { out: 0.15, lift: 0.4 },
    airbox: { out: 0.2, lift: 0.45 },
    fuelRail: 0.22, // straight up, under the lifted runners
    headerSwing: deg(25), // about the line of exhaust ports
    catalyst: 0.25, // outboard
    exhaustPipe: { out: 0.3, back: 0.05 }, // back a little, off the catalyst's outlet flange
    silencer: { out: 0.35, back: 0.1 },
    ecu: 0.2, // outboard
    fuseBox: 0.2, // outboard
  },
  /** Stage 5, the hybrid system apart. */
  transaxle: {
    back: 0.4, // the casing (bellhousing, gears, diff ride) slides off the engine
    flywheel: 0.12, // back, off the crank flange
    clutch: 0.24, // back, between the flywheel and the bellhousing
    eMotor: 0.35, // further back than the casing
    inverter: 0.3, // straight up off the powertrain, under the lifted intake and clear of the oil tank
  },
  /** Stage 2: out of the gearbox before the powertrain lifts. */
  driveshaft: 0.35,
  /**
   * Stage 2, rear corners (out = away from the centreline). The disc stays in its caliper
   * (both 0.45: a straight-line move can't take a disc out through the caliper's bridge).
   * The upright starts with them and travels between the disc and the driveshaft (0.35),
   * so every gap only grows; the links slide straight out of their clevises.
   */
  rearCorner: { upright: 0.42, disc: 0.45, lowerWishbone: 0.15, upperLink: 0.15, toeLink: 0.2, coilover: 0.25 },
  /** Back, rising a little over the diffuser's raised rear edge. */
  bumperBeam: [0, 0.04, -0.5] as Vec3,
  /** Stage 2: up out of the side pod and outboard. */
  radiator: [0.3, 0.45, 0] as Vec3,
  /** Out and up, ahead of the left cam cover lifting along its bank. */
  coolantTank: [0.3, 0.2, 0] as Vec3,
  /**
   * Stage 5: back into the empty engine bay (the powertrain has lifted out in stage 3).
   * It can't lift straight up: the roll structure behind the seats covers its ends.
   */
  fuelTank: [0, 0.04, -0.5] as Vec3,
  battery: {
    /** Sits down onto the ground while sliding out past the car's left side. */
    drop: hybridInput.battery.bottomY,
    slideX: body.halfWidth + hybridInput.battery.halfWidth + batteryClearOfBody,
  },
} as const;
