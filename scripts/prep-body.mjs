#!/usr/bin/env node
/**
 * Prepares the licensed body model for the app. Repeatable: `npm run prep:body`.
 *
 *   assets-src/models/body.glb (original, never modified; kept out of public/ so it is
 *   never shipped)
 *     1. strip the unused skin/joints, bake every transform into the vertices
 *     2. normalise to car coordinates: metres, +Y up, +Z forward, +X = car's left,
 *        ground at y = 0, wheelbase centred on z = 0
 *     3. segment into registry parts: name/path rules first, then spatial rules applied
 *        per connected piece (the source names are unreliable; see docs/body-report.md)
 *     4. join per part + material, meshopt-compress
 *     5. measure wheels, door hinges and the free engine/transaxle bays (BVH raycasts)
 *   → public/models/body.opt.glb + docs/body-report.md
 */
import { statSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, flatten, join, meshopt, prune, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { HIDDEN_NODES, MODEL_ENGINE_BAY, MODEL_REAR_DISCS, RULES, classifyFallback } from './body-rules.mjs';

const SRC = 'assets-src/models/body.glb';
const OUT = 'public/models/body.opt.glb';
const REPORT = 'docs/body-report.md';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;

const doc = await io.read(SRC);
const root = doc.getRoot();
const log = [];
const say = (s = '') => {
  console.log(s);
  log.push(s);
};
const f3 = (v) => `(${v.map((n) => n.toFixed(4)).join(', ')})`;
const countPrims = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
const srcPrims = countPrims();

// ─── 1. Strip skin, record each mesh node's ancestry, bake transforms ────────

const skins = root.listSkins();
for (const n of root.listNodes()) n.setSkin(null);
for (const s of skins) s.dispose();
let strippedAttrs = 0;
for (const mesh of root.listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) {
      if (/^(JOINTS|WEIGHTS)_\d+$/.test(sem)) {
        p.setAttribute(sem, null);
        strippedAttrs++;
      }
    }
  }
}

const ancestry = new Map();
for (const n of root.listNodes()) {
  const names = [];
  for (let a = n; a; a = a.getParentNode()) names.unshift(a.getName());
  ancestry.set(n, names.join(' / '));
}

const rawBox = new Box3();
for (const n of root.listNodes()) {
  if (!n.getMesh()) continue;
  rawBox.union(nodeWorldBox(n));
}

// ─── 2. Normalise: measure wheels in source world space ──────────────────────

const WHEEL_RE = /3DWheel (Front|Rear) (L|R)$/;
const wheels = {};
for (const n of root.listNodes()) {
  const m = WHEEL_RE.exec(n.getName());
  if (m) wheels[`${m[1][0].toLowerCase()}${m[2].toLowerCase()}`] = subtreeWorldBox(n);
}
if (Object.keys(wheels).length !== 4) throw new Error(`expected 4 wheel nodes, found ${Object.keys(wheels)}`);

// Wheel centre from its tyre: axle runs along X, so Y/Z extents are the diameter.
const rawWheel = (b) => {
  const r = (b.max.z - b.min.z) / 2;
  return { centre: new Vector3((b.min.x + b.max.x) / 2, b.max.y - r, (b.min.z + b.max.z) / 2), r, minY: b.min.y };
};
const rw = Object.fromEntries(Object.entries(wheels).map(([k, b]) => [k, rawWheel(b)]));
const wbRaw = (rw.fl.centre.z + rw.fr.centre.z) / 2 - (rw.rl.centre.z + rw.rr.centre.z) / 2;
const scale = 10 ** Math.round(Math.log10(2.65 / Math.abs(wbRaw)));
const frontIsPlusZ = wbRaw > 0;
if (!frontIsPlusZ) throw new Error('front wheels are not at +Z; add a 180° yaw to the normalisation');
if (rw.fl.r >= rw.rl.r) throw new Error('"Front" wheels are not smaller than "Rear" ones; check naming');
if (rw.fl.centre.x <= 0) throw new Error('"L" wheels are not on +X; car would be mirrored');

const centre = new Vector3(
  (rw.fl.centre.x + rw.fr.centre.x + rw.rl.centre.x + rw.rr.centre.x) / 4,
  Math.min(...Object.values(rw).map((w) => w.minY)),
  ((rw.fl.centre.z + rw.fr.centre.z) / 2 + (rw.rl.centre.z + rw.rr.centre.z) / 2) / 2,
);
const N = new Matrix4().makeScale(scale, scale, scale).multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));

// Bake: every mesh node to scene root with its world transform folded into the vertices.
await doc.transform(flatten());
for (const n of root.listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const world = new Matrix4().fromArray(n.getWorldMatrix());
  transformMesh(mesh, N.clone().multiply(world).toArray());
  n.setMatrix(new Matrix4().identity().toArray());
}

// ─── 3. Segment into parts ───────────────────────────────────────────────────

const scene = root.listScenes()[0];
const partNodes = new Map();
const partNode = (id) => {
  if (!partNodes.has(id)) {
    const node = doc.createNode(id);
    scene.addChild(node);
    partNodes.set(id, node);
  }
  return partNodes.get(id);
};
const reportRows = [];
const FIREWALL = { centroidAheadOf: -0.35, centroidBehind: 0.1, y: [0.3, 0.9], spanX: 0.4 };
let firewallZ = Infinity;
let firewallBy = '';
// Debug: `--debug-region=part:x0,x1,y0,y1,z0,z1` lists that part's pieces whose centroid is
// inside the box; `--debug-touch=...` lists every piece whose bounding box overlaps it.
const debugArg = process.argv.find((a) => /^--debug-(region|touch)=/.test(a));
const DEBUG_REGION = debugArg
  ? (() => {
      const [part, nums] = debugArg.split('=')[1].split(':');
      const [x0, x1, y0, y1, z0, z1] = nums.split(',').map(Number);
      const box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
      const touch = debugArg.startsWith('--debug-touch=');
      return { part, inRegion: (piece) => (touch ? box.intersectsBox(piece.box) : box.containsPoint(piece.centroid)) };
    })()
  : null;
const debugPieces = [];
const dropped = [];
let unmatched = 0;

for (const node of root.listNodes().filter((n) => n.getMesh() && !partNodes.has(n.getName()))) {
  const name = node.getName();
  const path = ancestry.get(node) ?? name;
  for (const prim of node.getMesh().listPrimitives()) {
    const material = prim.getMaterial()?.getName() ?? '';
    const ctx = { name, path, material };
    const rule = RULES.find((r) => r.test(ctx));
    const pieces = splitByComponents(prim);
    const byPart = new Map();
    for (const piece of pieces) {
      let part = rule ? (rule.split ? rule.split(piece, ctx) : rule.part(ctx)) : undefined;
      let via = rule ? rule.id : 'fallback';
      if (part === undefined) {
        part = classifyFallback(piece, ctx);
        via = rule ? `${rule.id}→fallback` : 'fallback';
      }
      if (DEBUG_REGION && part === DEBUG_REGION.part && DEBUG_REGION.inRegion(piece)) {
        debugPieces.push({ name: shortName(name), material, part, tris: piece.triCount, box: piece.box });
      }
      // Firewall: rearmost cabin structure spanning both seats (the carbon rear bulkhead).
      // The model has no solid firewall panel, so this is the closest physical stand-in.
      if (part === 'carbon-tub' && piece.centroid.z > FIREWALL.centroidAheadOf && piece.centroid.z < FIREWALL.centroidBehind &&
          piece.box.max.y > FIREWALL.y[0] && piece.box.min.y < FIREWALL.y[1] &&
          piece.box.min.x < -FIREWALL.spanX && piece.box.max.x > FIREWALL.spanX) {
        if (piece.box.min.z < firewallZ) {
          firewallZ = piece.box.min.z;
          firewallBy = `${shortName(name)} [${material}] bbox ${f3(piece.box.min.toArray())}…${f3(piece.box.max.toArray())}`;
        }
      }
      const key = `${part}\u0000${via}`;
      const acc = byPart.get(key) ?? { part, via, tris: [] };
      acc.tris.push(...piece.tris);
      byPart.set(key, acc);
    }
    for (const { part, via, tris } of byPart.values()) {
      reportRows.push({ name, material, part: part ?? '(dropped)', via, tris: tris.length });
      if (via.includes('fallback')) unmatched++;
      if (part === null) {
        dropped.push(`${name} [${material}] ${tris.length} tris`);
        continue;
      }
      const sub = subPrimitive(prim, tris, part);
      const mesh = doc.createMesh(`${part}:${shortName(name)}`).addPrimitive(sub);
      partNode(part).addChild(doc.createNode(shortName(name)).setMesh(mesh));
    }
  }
  node.dispose();
}

await doc.transform(prune(), dedup());

// The engine-cover glass gets its own material so it can be tuned without touching the
// windscreen. Cloned after dedup(), which ignores names and would merge it straight back.
for (const meshNode of partNode('engine-cover').listChildren()) {
  for (const p of meshNode.getMesh().listPrimitives()) {
    const m = p.getMaterial();
    if (m && /Glass/i.test(m.getName())) p.setMaterial(m.clone().setName('EngineCoverGlass'));
  }
}

if (DEBUG_REGION) {
  const f = (v) => v.toArray().map((n) => n.toFixed(3).padStart(6)).join(' ');
  debugPieces.sort((p, q) => q.tris - p.tris);
  for (const d of debugPieces) console.log(`${d.name.padEnd(22)} ${d.material.padEnd(24)} ${String(d.tris).padStart(5)}  min ${f(d.box.min)}  max ${f(d.box.max)}`);
  process.exit(0);
}

// ─── 4. Measure (car coordinates) ────────────────────────────────────────────

const parts = [...partNodes.keys()].sort();
const partBox = (id) => subtreeWorldBox(partNodes.get(id));
const normBox = new Box3();
for (const id of parts) normBox.union(partBox(id));

const wheelM = {};
for (const k of ['fl', 'fr', 'rl', 'rr']) {
  const b = partBox(`wheel-${k}`);
  const r = (b.max.z - b.min.z) / 2;
  wheelM[k] = { centre: new Vector3((b.min.x + b.max.x) / 2, b.max.y - r, (b.min.z + b.max.z) / 2), r, width: b.max.x - b.min.x };
}
const axleF = (wheelM.fl.centre.z + wheelM.fr.centre.z) / 2;
const axleR = (wheelM.rl.centre.z + wheelM.rr.centre.z) / 2;
const trackF = wheelM.fl.centre.x - wheelM.fr.centre.x;
const trackR = wheelM.rl.centre.x - wheelM.rr.centre.x;

const hinge = (id) => {
  const b = partBox(id);
  return { box: b, pivot: new Vector3((b.min.x + b.max.x) / 2, b.max.y, b.max.z) };
};
const doorL = hinge('door-l');
const doorR = hinge('door-r');

/** The transaxle bay may not extend behind the rear crash structure region. */
const DIMS_BODY_REAR_LIMIT = -2.15;
const bvh = buildBvh(parts.filter((id) => !/^(wheel|caliper)-/.test(id) && !HIDDEN_NODES.includes(id)));
// The model has no panel below the rear bulkhead, so without the firewall limit a box
// could slide forward under the seats.
const engineBay = measureBay(bvh, { front: +1, from: axleR, to: firewallZ, minHeight: 0.55, label: 'engine bay (tall core)' });
const engineBayWide = measureBay(bvh, { front: +1, from: axleR, to: firewallZ, minHalfWidth: 0.45, label: 'engine bay (wide lower)' });
const transaxleBay = measureBay(bvh, { front: -1, from: axleR, to: DIMS_BODY_REAR_LIMIT, minHeight: 0.3, label: 'transaxle bay' });

// ─── 5. Join per part + material, compress, write ────────────────────────────

await doc.transform(join({ keepNamed: false }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(OUT, doc);

// ─── Report ──────────────────────────────────────────────────────────────────

const kb = (p) => `${(statSync(p).size / 1024 / 1024).toFixed(2)} MB`;
say(`# Body model prep report`);
say();
say(`Generated by \`npm run prep:body\` (scripts/prep-body.mjs). Do not edit by hand.`);
say();
say(`## Asset`);
say(`- Source: \`${SRC}\` — ${kb(SRC)} (untouched)`);
say(`- Output: \`${OUT}\` — ${kb(OUT)}`);
say(`- Skins removed: ${skins.length} (referenced by 0 nodes); JOINTS/WEIGHTS attributes stripped: ${strippedAttrs}`);
say(`- Draw calls (mesh primitives): ${srcPrims} → ${countPrims()}`);
say();
say(`## Normalisation`);
say(`- Raw world bbox: min ${f3(rawBox.min.toArray())} max ${f3(rawBox.max.toArray())}`);
say(`- Scale ×${scale}; translate ${f3(centre.clone().multiplyScalar(-scale).toArray())} (m, after scaling); no rotation needed`);
say(`- Checks: front wheels at +Z ✓, smaller than rears ✓, "L" wheels at +X ✓`);
say(`- Normalised bbox: min ${f3(normBox.min.toArray())} max ${f3(normBox.max.toArray())}`);
say(`  → L ${(normBox.max.z - normBox.min.z).toFixed(3)} × W ${(normBox.max.x - normBox.min.x).toFixed(3)} (incl. mirrors) × H ${normBox.max.y.toFixed(3)}`);
say();
say(`## Wheels (car coordinates)`);
say(`| wheel | centre (x, y, z) | tyre radius | width |`);
say(`| --- | --- | --- | --- |`);
for (const [k, w] of Object.entries(wheelM)) say(`| ${k} | ${f3(w.centre.toArray())} | ${w.r.toFixed(4)} | ${w.width.toFixed(3)} |`);
say(`- Axles: front z ${axleF.toFixed(4)}, rear z ${axleR.toFixed(4)} → wheelbase ${(axleF - axleR).toFixed(4)}`);
say(`- Track: front ${trackF.toFixed(4)}, rear ${trackR.toFixed(4)}`);
say();
say(`## Door hinges (from each door's bounding box: centre x, top y, front z)`);
for (const [id, d] of [['door-l', doorL], ['door-r', doorR]]) {
  say(`- ${id}: bbox min ${f3(d.box.min.toArray())} max ${f3(d.box.max.toArray())} → pivot ${f3(d.pivot.toArray())}`);
}
say();
say(`## Free volumes (against all visible model geometry except wheels and calipers)`);
say(`- Firewall (rearmost cabin structure spanning both seats): z ${firewallZ.toFixed(3)}, set by ${firewallBy}`);
for (const bay of [engineBay, engineBayWide, transaxleBay]) {
  say(`- ${bay.label}: x ±${bay.halfWidth.toFixed(3)}, y ${bay.bottom.toFixed(3)}…${bay.top.toFixed(3)}, z ${bay.zMin.toFixed(3)}…${bay.zMax.toFixed(3)}`);
  say(`  limits:\n    ${bay.notes}`);
}
say();
say(`## Hidden: ${MODEL_ENGINE_BAY}`);
say(`The model's stand-in engine bay (plenum, airboxes, cables, ECUs, decorative plate, exhaust tips),`);
say(`kept in the GLB as a dev reference but not rendered: our V12 and exhaust replace it.`);
say(`${reportRows.filter((r) => r.part === MODEL_ENGINE_BAY).reduce((n, r) => n + r.tris, 0)} triangles from ${new Set(reportRows.filter((r) => r.part === MODEL_ENGINE_BAY).map((r) => r.name)).size} source meshes.`);
say();
say(`## Hidden: ${MODEL_REAR_DISCS}`);
say(`The rear brake discs, modelled inside the rear wheel meshes; our procedural discs replace them.`);
say(`${reportRows.filter((r) => r.part === MODEL_REAR_DISCS).reduce((n, r) => n + r.tris, 0)} triangles.`);
if (dropped.length) {
  say();
  say(`## Dropped geometry`);
  for (const d of dropped) say(`- ${d}`);
}
say();
say(`## Parts`);
say(`| part | primitives | triangles | bbox min | bbox max |`);
say(`| --- | --- | --- | --- | --- |`);
for (const id of parts) {
  const b = partBox(id);
  const prims = partNodes.get(id).listChildren().reduce((s, c) => s + (c.getMesh()?.listPrimitives().length ?? 0), 0);
  const tris = reportRows.filter((r) => r.part === id).reduce((s, r) => s + r.tris, 0);
  say(`| ${id} | ${prims} | ${tris} | ${f3(b.min.toArray())} | ${f3(b.max.toArray())} |`);
}
say();
say(`## Source mesh → part (${reportRows.length} rows; ${unmatched} assigned by the spatial fallback)`);
say(`\`via\` = rule id from scripts/body-rules.mjs; "fallback" = no name rule matched (or the rule deferred).`);
say();
say(`| source node | material | part | via | tris |`);
say(`| --- | --- | --- | --- | --- |`);
for (const r of reportRows) say(`| ${shortName(r.name)} | ${r.material} | ${r.part} | ${r.via} | ${r.tris} |`);
writeFileSync(REPORT, log.join('\n') + '\n');
console.error(`\nwrote ${OUT} and ${REPORT}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortName(n) {
  return n
    .replace(/^uv\d:/, '')
    .replace(/_0000_001_SM_\w+?_0000_MAT_\w+?_(\d+)_uv\d:.*$/, '#$1')
    .replace(/_uv\d:.*$/, '');
}

function nodeWorldBox(n) {
  const box = new Box3();
  const m = new Matrix4().fromArray(n.getWorldMatrix());
  for (const p of n.getMesh().listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const v = new Vector3();
    const el = [];
    for (let i = 0; i < pos.getCount(); i++) box.expandByPoint(v.fromArray(pos.getElement(i, el)).applyMatrix4(m));
  }
  return box;
}

function subtreeWorldBox(n) {
  const box = new Box3();
  n.traverse((c) => {
    if (c.getMesh()) box.union(nodeWorldBox(c));
  });
  return box;
}

/**
 * Connected pieces of a primitive. Vertices are welded by position first so UV seams
 * don't split a panel into fragments.
 */
function splitByComponents(prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const nv = pos.getCount();
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const el = [];
  const seen = new Map();
  for (let i = 0; i < nv; i++) {
    pos.getElement(i, el);
    const key = `${Math.round(el[0] * 1e4)},${Math.round(el[1] * 1e4)},${Math.round(el[2] * 1e4)}`;
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i);
    else union(i, j);
  }
  const triCount = idx ? idx.getCount() / 3 : nv / 3;
  const vi = (t, k) => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    union(vi(t, 0), vi(t, 1));
    union(vi(t, 0), vi(t, 2));
  }
  const comps = new Map();
  const v = new Vector3();
  for (let t = 0; t < triCount; t++) {
    const c = find(vi(t, 0));
    let comp = comps.get(c);
    if (!comp) comps.set(c, (comp = { tris: [], box: new Box3(), sum: new Vector3(), n: 0 }));
    comp.tris.push(t);
    for (let k = 0; k < 3; k++) {
      v.fromArray(pos.getElement(vi(t, k), el));
      comp.box.expandByPoint(v);
      comp.sum.add(v);
      comp.n++;
    }
  }
  return [...comps.values()].map((c) => ({
    tris: c.tris,
    box: c.box,
    centroid: c.sum.divideScalar(c.n),
    triCount: c.tris.length,
  }));
}

/** New primitive with only the given triangles (attributes compacted). */
function subPrimitive(prim, tris, part) {
  const idx = prim.getIndices();
  const all = idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
  const sub = prim.clone();
  if (tris.length === all) return sub;
  const src = idx ? idx.getArray() : null;
  const out = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) out[i * 3 + k] = src ? src[t * 3 + k] : t * 3 + k;
  });
  const acc = doc.createAccessor(`${part}-indices`).setType('SCALAR').setArray(out);
  if (idx) acc.setBuffer(idx.getBuffer());
  else acc.setBuffer(root.listBuffers()[0]);
  sub.setIndices(acc);
  compactPrimitive(sub);
  return sub;
}

function buildBvh(ids) {
  const positions = [];
  const labels = [];
  const v = new Vector3();
  const el = [];
  for (const id of ids) {
    partNodes.get(id).traverse((n) => {
      const mesh = n.getMesh();
      if (!mesh) return;
      const label = `${id}/${n.getName()}`;
      const m = new Matrix4().fromArray(n.getWorldMatrix());
      for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute('POSITION');
        const idx = p.getIndices();
        const count = idx ? idx.getCount() : pos.getCount();
        for (let i = 0; i < count; i++) {
          v.fromArray(pos.getElement(idx ? idx.getScalar(i) : i, el)).applyMatrix4(m);
          positions.push(v.x, v.y, v.z);
        }
        for (let t = 0; t < count / 3; t++) labels.push(label);
      }
    });
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  // Indirect keeps the triangle order, so hit.faceIndex maps back to its label.
  geom.boundsTree = new MeshBVH(geom, { indirect: true });
  const mesh = new Mesh(geom, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.raycast = acceleratedRaycast;
  mesh.userData.labels = labels;
  return mesh;
}

/** Distance to the first surface along a ray (Infinity if none); records what was hit. */
function cast(mesh, origin, dir, hits) {
  const rc = new Raycaster(origin, dir);
  rc.firstHitOnly = true;
  const hit = rc.intersectObject(mesh)[0];
  if (!hit) return Infinity;
  hits?.push({ d: hit.distance, label: mesh.userData.labels[hit.faceIndex], point: hit.point });
  return hit.distance;
}

/** The surface that set a limit: the closest hit, with how many rays it stopped. */
function limiter(hits) {
  if (!hits.length) return 'nothing';
  hits.sort((a, b) => a.d - b.d);
  const best = hits[0];
  const n = hits.filter((h) => h.label === best.label).length;
  return `${best.label} at (${best.point.toArray().map((v) => v.toFixed(3)).join(', ')}), stops ${n}/${hits.length} rays`;
}

/**
 * Largest empty box, symmetric about x = 0, with one face on the rear-axle plane:
 * `front: +1` grows forward (engine bay), `-1` rearward (transaxle bay). The region is
 * voxelised (VOXEL m); a voxel is occupied if any visible model triangle passes through
 * it. Every candidate (half width, bottom, top) is pushed as far as it will go along z,
 * using a 3D prefix sum for constant-time emptiness tests, and the largest volume wins.
 */
function measureBay(mesh, { front, from, to, minHeight = 0, minHalfWidth = 0, label }) {
  const VOXEL = 0.02;
  // Below the engine-cover glass; between the axle plane and `to`.
  const R = { x: [-0.8, 0.8], y: [0.05, 0.95], z: front > 0 ? [from, to] : [to, from] };
  const n = { x: Math.round((R.x[1] - R.x[0]) / VOXEL), y: Math.round((R.y[1] - R.y[0]) / VOXEL), z: Math.round((R.z[1] - R.z[0]) / VOXEL) };
  const bvh = mesh.geometry.boundsTree;
  const identity = new Matrix4();
  // Summed-volume table with a zero border: S[(x+1),(y+1),(z+1)].
  const sx = n.x + 1, sy = n.y + 1, sz = n.z + 1;
  const S = new Int32Array(sx * sy * sz);
  const at = (x, y, z) => (x * sy + y) * sz + z;
  const box = new Box3();
  for (let x = 0; x < n.x; x++) {
    for (let y = 0; y < n.y; y++) {
      for (let z = 0; z < n.z; z++) {
        box.min.set(R.x[0] + x * VOXEL, R.y[0] + y * VOXEL, R.z[0] + z * VOXEL);
        box.max.set(box.min.x + VOXEL, box.min.y + VOXEL, box.min.z + VOXEL);
        const occ = bvh.intersectsBox(box, identity) ? 1 : 0;
        S[at(x + 1, y + 1, z + 1)] =
          occ + S[at(x, y + 1, z + 1)] + S[at(x + 1, y, z + 1)] + S[at(x + 1, y + 1, z)] -
          S[at(x, y, z + 1)] - S[at(x, y + 1, z)] - S[at(x + 1, y, z)] + S[at(x, y, z)];
      }
    }
  }
  // Occupied voxels in [x0,x1) × [y0,y1) × [z0,z1).
  const count = (x0, x1, y0, y1, z0, z1) =>
    S[at(x1, y1, z1)] - S[at(x0, y1, z1)] - S[at(x1, y0, z1)] - S[at(x1, y1, z0)] +
    S[at(x0, y0, z1)] + S[at(x0, y1, z0)] + S[at(x1, y0, z0)] - S[at(x0, y0, z0)];
  const cx = n.x / 2;
  if (process.env.DEBUG_BAY) {
    const want = process.env.DEBUG_BAY.split(',').map(Number).filter((v) => v >= R.z[0] && v < R.z[1]);
    for (const zv of want) {
      const z = Math.floor((zv - R.z[0]) / VOXEL);
      const rows = [];
      for (let y = n.y - 1; y >= 0; y--) {
        let row = '';
        for (let x = 0; x < n.x; x++) row += count(x, x + 1, y, y + 1, z, z + 1) ? '#' : '.';
        rows.push(`${(R.y[0] + y * VOXEL).toFixed(2)} ${row}`);
      }
      console.log(`${label} slice z=${(R.z[0] + z * VOXEL).toFixed(3)} (x ${R.x[0]}…${R.x[1]})\n${rows.join('\n')}`);
    }
  }
  let best = null;
  for (let w = 1; w <= cx; w++) {
    for (let y0 = 0; y0 < n.y; y0++) {
      for (let y1 = y0 + 1; y1 <= n.y; y1++) {
        // Length along z, measured from the axle plane outwards.
        let len = 0;
        while (len < n.z) {
          const [z0, z1] = front > 0 ? [len, len + 1] : [n.z - len - 1, n.z - len];
          if (count(cx - w, cx + w, y0, y1, z0, z1)) break;
          len++;
        }
        if (!len) break; // taller boxes with this bottom only get blocked sooner
        if ((y1 - y0) * VOXEL < minHeight || w * VOXEL < minHalfWidth) continue;
        const vol = 2 * w * (y1 - y0) * len;
        if (!best || vol > best.vol) best = { vol, w, y0, y1, len };
      }
    }
  }
  const halfWidth = best.w * VOXEL;
  const bottom = R.y[0] + best.y0 * VOXEL;
  const top = R.y[0] + best.y1 * VOXEL;
  const farZ = from + front * best.len * VOXEL;
  const [zMin, zMax] = front > 0 ? [from, farZ] : [farZ, from];
  // Name what bounds each face: rays from just inside the box, through each face.
  const mid = new Vector3(0, (bottom + top) / 2, (zMin + zMax) / 2);
  const probe = (origin, dir) => {
    const hits = [];
    cast(mesh, origin, dir, hits);
    return limiter(hits);
  };
  const notes = [
    `${front > 0 ? 'front' : 'rear'}: ${probe(new Vector3(0, mid.y, from), new Vector3(0, 0, front))}`,
    `top: ${probe(mid, new Vector3(0, 1, 0))}`,
    `bottom: ${probe(mid, new Vector3(0, -1, 0))}`,
    `side (+x): ${probe(mid, new Vector3(1, 0, 0))}`,
    `search: voxel ${VOXEL} m, height ≥ ${minHeight} m, half width ≥ ${minHalfWidth} m, z limited to ${to.toFixed(3)}; volume ${(best.vol * VOXEL ** 3 * 1000).toFixed(0)} L`,
  ].join('\n    ');
  return { label, halfWidth, bottom, top, zMin, zMax, notes };
}
