/**
 * Segmentation rules for the body model: which registry part each piece of geometry
 * belongs to. Used by prep-body.mjs.
 *
 * The source names are only loose hints. Pieces are merged by material across regions
 * (one "ANC_RearFender" mesh covers both haunches; one glass primitive holds every
 * window), so rules may `split`: they are then applied per connected piece, using its
 * centroid/bbox in car coordinates (+X left, +Y up, +Z forward, metres).
 *
 * Rules run in order; the first whose `test` matches wins. `part` (whole mesh) or
 * `split` (per piece) return a part id, `null` to drop the geometry, or `undefined` to
 * defer to classifyFallback.
 */

const side = (c) => (c.x >= 0 ? 'l' : 'r');

/** Region bounds (car coordinates, metres). */
const Z = {
  doorRear: -0.32,
  doorFront: 1.2,
  /** Behind this the glass belongs to the engine cover, not the cabin. */
  engineGlassFront: -0.45,
  /** Ahead of this, painted panels belong to the nose. */
  noseRear: 1.35,
  /** Behind this, painted panels belong to the rear clam. */
  rearClamFront: -0.3,
  diffuserFront: -1.5,
};
const Y = { diffuserTop: 0.35 };
const X = { doorInboard: 0.55 };

/**
 * The model's stand-in engine bay: plenum, airboxes, cables, ECUs and deck shelves
 * modelled as top surfaces only, plus the exhaust tips. These go to the hidden
 * 'model-engine-bay' node; our procedural V12 and exhaust replace them.
 *
 * A piece is dressing when its centroid lies in the bay core and its bbox stays within
 * the bay outline (so the side walls, whose centroids sit at |x| ≥ 0.6, are kept).
 */
const BAY_CORE = { x: [-0.55, 0.55], y: [0.15, 0.88], z: [-1.95, -0.25] };
const BAY_OUTLINE = { x: [-0.72, 0.72], y: [0.1, 0.92], z: [-2.0, -0.2] };
const EXHAUST_TIPS = { absX: [0.55, 0.85], y: [0.24, 0.42], z: [-2.12, -1.8] };
/** The flat black plate the model uses as a fake engine-bay floor (hides the void). */
const BAY_FLOOR = { x: [-0.75, 0.75], y: [0.35, 0.5], z: [-2.0, -0.2], maxThickness: 0.05 };
const within = (lo, hi, [a, b]) => lo >= a && hi <= b;
const inBox = (b, r) => within(b.min.x, b.max.x, r.x) && within(b.min.y, b.max.y, r.y) && within(b.min.z, b.max.z, r.z);
const isBayDressing = ({ box: b, centroid: c }) =>
  (within(c.x, c.x, BAY_CORE.x) && within(c.y, c.y, BAY_CORE.y) && within(c.z, c.z, BAY_CORE.z) && inBox(b, BAY_OUTLINE)) ||
  ((within(b.min.x, b.max.x, EXHAUST_TIPS.absX) || within(-b.max.x, -b.min.x, EXHAUST_TIPS.absX)) &&
    within(b.min.y, b.max.y, EXHAUST_TIPS.y) &&
    within(b.min.z, b.max.z, EXHAUST_TIPS.z)) ||
  (b.max.y - b.min.y < BAY_FLOOR.maxThickness && inBox(b, BAY_FLOOR));

/** Black side rails and louvres framing the engine-cover glass (named ANC_RearFender_*). */
const COVER_FRAME = { x: [-0.45, 0.45], y: [0.8, 1.04], z: [-1.6, -0.55] };
/** Carbon crossmember at the roof's trailing edge, housing the third brake light. */
const ROOF_TRAILING_EDGE = { x: [-0.46, 0.46], y: [0.9, 1.04], z: [-0.8, -0.55] };

/** Hidden node holding the model's engine-bay dressing (kept as a dev reference). */
export const MODEL_ENGINE_BAY = 'model-engine-bay';

/**
 * The rear brake discs are modelled inside the rear wheel meshes (two small pieces just
 * inboard of the spokes). They go to a hidden node: our procedural discs replace them
 * (milestone 2d). The front discs stay in the wheels until 2e builds theirs.
 */
export const MODEL_REAR_DISCS = 'model-rear-discs';
const REAR_DISC = { absX: [0.77, 0.83], y: [0.15, 0.57], z: [-1.54, -1.11] };
const isRearDisc = ({ box: b }) =>
  (within(b.min.x, b.max.x, REAR_DISC.absX) || within(-b.max.x, -b.min.x, REAR_DISC.absX)) &&
  within(b.min.y, b.max.y, REAR_DISC.y) &&
  within(b.min.z, b.max.z, REAR_DISC.z);

/** Model nodes that are never rendered (dev references only). */
export const HIDDEN_NODES = [MODEL_ENGINE_BAY, MODEL_REAR_DISCS];

export const RULES = [
  {
    id: 'engine-plate',
    // Decorative plate standing in for the engine under the glass.
    test: (c) => /SM_Engine/.test(c.name) && c.material === 'uv1Details_Engine1',
    part: () => MODEL_ENGINE_BAY,
  },
  {
    id: 'wheel',
    test: (c) => /3DWheel (Front|Rear) (L|R)/.test(c.path),
    split: (piece, c) => {
      const [, fr, lr] = /3DWheel (Front|Rear) (L|R)/.exec(c.path);
      if (fr === 'Rear' && isRearDisc(piece)) return MODEL_REAR_DISCS;
      return `wheel-${fr[0].toLowerCase()}${lr.toLowerCase()}`;
    },
  },
  {
    id: 'caliper',
    test: (c) => /Calliper (Front|Rear) (L|R)/.test(c.path),
    part: (c) => {
      const [, fr, lr] = /Calliper (Front|Rear) (L|R)/.exec(c.path);
      return `caliper-${fr[0].toLowerCase()}${lr.toLowerCase()}`;
    },
  },
  {
    id: 'glass',
    test: (c) => c.material === 'uv1MAT_Glass1',
    split: ({ centroid: p }) => {
      if (p.z < Z.engineGlassFront) return 'engine-cover';
      if (Math.abs(p.x) > X.doorInboard && p.z > Z.doorRear && p.z < Z.doorFront) return `door-${side(p)}`;
      return 'canopy';
    },
  },
  {
    id: 'lamp-lens',
    test: (c) => c.material === 'glass_lishgt' || c.material === 'red_glass',
    split: ({ centroid: p }) => (p.z > 0 ? 'nose' : 'rear-clam'),
  },
  { id: 'hood', test: (c) => /SM_Hood/.test(c.name), part: () => 'front-clam' },
  { id: 'front-kit', test: (c) => /SM_FrontKit/.test(c.name), part: () => 'nose' },
  { id: 'interior', test: (c) => /SM_Interior/.test(c.name), part: () => 'carbon-tub' },
  {
    id: 'door',
    // SM_Base pieces are the left door's first fragment per material (they mirror ANC_Door_R_*).
    test: (c) => /ANC_(Door|Glass)_[LR]|SM_Base/.test(c.name),
    split: ({ centroid: p }, c) => {
      const named = /_R_/.test(c.name) ? 'r' : 'l';
      return side(p) === named ? `door-${named}` : undefined;
    },
  },
  {
    id: 'side-intake',
    test: (c) => /SM_Engine/.test(c.name) && c.material === 'uv1Details_Grid03',
    split: ({ centroid: p }) => `side-intake-${side(p)}`,
  },
  {
    id: 'brake-light',
    // Third brake light, in the roof's trailing-edge crossmember.
    test: (c) => /SM_Engine/.test(c.name) && c.material === 'uv1MAT_Light1',
    part: () => 'canopy',
  },
  {
    id: 'engine-dressing',
    // Carbon plenum/airbox covers and trim; anything outside the bay stays with the tub.
    test: (c) => /SM_Engine/.test(c.name),
    split: (piece) => (isBayDressing(piece) ? MODEL_ENGINE_BAY : 'carbon-tub'),
  },
  { id: 'roof', test: (c) => /SM_RearKit/.test(c.name) && c.material === 'uv1MAT_Car_Paint_Black1', part: () => 'canopy' },
  {
    id: 'underbody',
    // One connected floor pan spanning the whole car, despite the RearKit name.
    test: (c) => /SM_RearKit/.test(c.name) && c.material === 'uv1MAT_Details_Chassis_0001_002',
    part: () => 'carbon-tub',
  },
  {
    id: 'rear-kit',
    test: (c) => /SM_RearKit/.test(c.name),
    split: ({ centroid: p }) => {
      if (p.z < Z.diffuserFront && p.y < Y.diffuserTop) return 'undertray-diffuser';
      return p.z < Z.rearClamFront ? 'rear-clam' : undefined;
    },
  },
  {
    id: 'rear-wing',
    test: (c) => /ANC_RearWing/.test(c.name),
    split: ({ centroid: p }) => (p.y < Y.diffuserTop ? 'undertray-diffuser' : 'rear-wing'),
  },
  {
    id: 'rear-fender',
    // Mostly the haunches and tail, but it also carries the cover frame and the roof's trailing edge.
    test: (c) => /ANC_RearFender/.test(c.name),
    split: (piece, c) => {
      const painted = /Carpaint_Red/.test(c.material);
      if (!painted && /Carbon/.test(c.material) && inBox(piece.box, ROOF_TRAILING_EDGE)) return 'canopy';
      if (!painted && inBox(piece.box, COVER_FRAME)) return 'engine-cover';
      return 'rear-clam';
    },
  },
];

/**
 * Pieces no rule claimed: bay dressing is hidden, painted panels join the nearest clam,
 * the rest stays with the tub.
 */
export function classifyFallback(piece, c) {
  if (isBayDressing(piece)) return MODEL_ENGINE_BAY;
  const p = piece.centroid;
  const painted = /Carpaint_Red/.test(c.material);
  if (painted && p.z < Z.rearClamFront) return 'rear-clam';
  if (painted && p.z > Z.noseRear) return 'nose';
  return 'carbon-tub';
}
