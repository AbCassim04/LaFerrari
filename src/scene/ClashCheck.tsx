import { useEffect } from 'react';
import {
  Box3,
  Line3,
  Vector3,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshBasicMaterial,
  type InstancedMesh,
  type Material,
  type Mesh,
} from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { explodeTimeline } from '../explode/buildTimeline';
import { PARTS, PARTS_BY_ID } from '../parts/registry';
import type { PartDef } from '../parts/types';
import { useAppStore } from '../state/store';
import { partObjects, syncDynamicParts } from './partObjects';

/** Assembled-pose intersections with the body model. */
const CLASH_MATERIAL = new MeshBasicMaterial({ color: '#ff2020' });
/** Parts still overlapping each other at full explode. */
const OVERLAP_MATERIAL = new MeshBasicMaterial({ color: '#ff9a1f' });

type Bvh = typeof MeshBVH;

/** One mesh (or one instance of an instanced mesh) with its world pose. */
interface Item {
  partId: string;
  mesh: Mesh;
  world: Matrix4;
  box: Box3;
  bvh: MeshBVH;
}

/**
 * Dev check (key C), on real triangles:
 *   1. Assembled pose: every procedural part against the body model (red).
 *   2. Full explode: every pair of parts that should have separated (orange).
 * Skipped: pairs a part lists in `contacts`, and parts that move together (a part riding
 * its parent unmoved, or two such riders of the same parent). Results go to the console
 * and the dev panel.
 */
export function ClashCheck() {
  const on = useAppStore((s) => s.showClashes);

  useEffect(() => {
    const setReport = useAppStore.getState().setClashReport;
    if (!on) {
      setReport(null);
      return;
    }
    let cancelled = false;
    const restore: [Mesh, Material | Material[]][] = [];
    const paint = (mesh: Mesh, m: Material) => {
      if (!restore.some(([r]) => r === mesh)) restore.push([mesh, mesh.material]);
      if (mesh.material !== CLASH_MATERIAL) mesh.material = m;
    };

    import('three-mesh-bvh').then(({ MeshBVH }) => {
      if (cancelled) return;
      const t0 = performance.now();
      const tl = explodeTimeline.current;
      const progress = tl?.progress() ?? 0;

      tl?.progress(0);
      syncDynamicParts();
      const assembled = collect(MeshBVH);
      const clashes = new Map<string, Map<string, Vector3>>();
      const model = assembled.filter((i) => isModel(i.partId));
      for (const a of assembled) {
        if (isModel(a.partId)) continue;
        for (const b of model) {
          if (allowed(a.partId, b.partId) || clashes.get(a.partId)?.has(b.partId) || !a.box.intersectsBox(b.box)) continue;
          const at = contact(a, b);
          if (!at) continue;
          add(clashes, a.partId, b.partId, at);
          paint(a.mesh, CLASH_MATERIAL);
        }
      }

      const overlaps = new Map<string, Map<string, Vector3>>();
      if (tl) {
        if (CLASH_AT === null) tl.progress(1);
        else tl.time(CLASH_AT);
        syncDynamicParts();
        const exploded = collect(MeshBVH);
        for (let i = 0; i < exploded.length; i++) {
          const a = exploded[i];
          for (let j = i + 1; j < exploded.length; j++) {
            const b = exploded[j];
            if (a.partId === b.partId || (isModel(a.partId) && isModel(b.partId))) continue;
            if (movesWith(a.partId, b.partId) || allowed(a.partId, b.partId)) continue;
            // Mid-explode (clashAt) many parts still touch by design: only check the focus parts.
            if (CLASH_AT !== null && FOCUS.length && !FOCUS.some((f) => a.partId.includes(f) || b.partId.includes(f))) continue;
            const [x, y] = a.partId < b.partId ? [a, b] : [b, a];
            if (overlaps.get(x.partId)?.has(y.partId) || !a.box.intersectsBox(b.box)) continue;
            const at = contact(a, b);
            if (!at) continue;
            add(overlaps, x.partId, y.partId, at);
            for (const it of [a, b]) if (!isModel(it.partId)) paint(it.mesh, OVERLAP_MATERIAL);
          }
        }
        tl.progress(progress);
        syncDynamicParts();
      }

      // Dev, info only (?clashes=all): our parts against each other when assembled, except
      // a part and its ancestors and listed contacts. `clashFocus=a,b` limits it to parts
      // whose id contains one of the strings. Many neighbours touch by design.
      const between = new Map<string, Map<string, Vector3>>();
      if (ALL_PAIRS) {
        tl?.progress(0);
        syncDynamicParts();
        const ours = collect(MeshBVH).filter((i) => !isModel(i.partId));
        const focus = (id: string) => !FOCUS.length || FOCUS.some((f) => id.includes(f));
        for (let i = 0; i < ours.length; i++) {
          const a = ours[i];
          for (let j = i + 1; j < ours.length; j++) {
            const b = ours[j];
            if (a.partId === b.partId || !(focus(a.partId) || focus(b.partId))) continue;
            if (related(a.partId, b.partId) || allowed(a.partId, b.partId)) continue;
            const [x, y] = a.partId < b.partId ? [a, b] : [b, a];
            if (between.get(x.partId)?.has(y.partId) || !a.box.intersectsBox(b.box)) continue;
            const at = contact(a, b);
            if (at) add(between, x.partId, y.partId, at);
          }
        }
        tl?.progress(progress);
        syncDynamicParts();
      }

      const lines = (m: Map<string, Map<string, Vector3>>) =>
        [...m].flatMap(([id, others]) => [...others].map(([other, box]) => `  ${id} × ${other} at ${where(box)}`));
      const report = [
        `assembled vs body: ${clashes.size ? '\n' + lines(clashes).join('\n') : 'none'}`,
        `${CLASH_AT === null ? 'exploded' : `at t=${CLASH_AT} s`} overlaps: ${tl ? (overlaps.size ? '\n' + lines(overlaps).join('\n') : 'none') : 'timeline not ready'}`,
        ...(ALL_PAIRS ? [`assembled, ours (info): ${between.size ? '\n' + lines(between).join('\n') : 'none'}`] : []),
      ].join('\n');
      console.info(`[clash] (${Math.round(performance.now() - t0)} ms)\n${report}`);
      setReport(report);
    });

    return () => {
      cancelled = true;
      restore.forEach(([mesh, m]) => (mesh.material = m));
    };
  }, [on]);

  useEffect(() => {
    Object.assign(window, { __slice: slice });
  }, []);

  return null;
}

interface SliceOptions {
  /** Slice normal and its position (car coordinates). */
  axis: 'x' | 'y' | 'z';
  at: number;
  /** Ranges of the other two axes, in x, y, z order. */
  u: [number, number];
  v: [number, number];
  step?: number;
  /** Timeline time to pose (default: assembled). */
  t?: number;
  /** Part-id substrings to include / leave out. */
  only?: string[];
  hide?: string[];
}

/**
 * Dev (`window.__slice`): an ASCII occupancy map of a slice through every part (ours and
 * the body model's) in a given pose, one letter per part, for laying out new parts.
 */
async function slice(o: SliceOptions) {
  const { MeshBVH } = await import('three-mesh-bvh');
  const step = o.step ?? 0.02;
  const tl = explodeTimeline.current;
  const progress = tl?.progress() ?? 0;
  tl?.time(o.t ?? 0);
  syncDynamicParts();
  const keep = (id: string) => (!o.only?.length || o.only.some((s) => id.includes(s))) && !o.hide?.some((s) => id.includes(s));
  const items = collect(MeshBVH).filter((i) => keep(i.partId));
  tl?.progress(progress);
  syncDynamicParts();
  const letters = new Map<string, string>();
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=@';
  const letter = (id: string) => {
    if (!letters.has(id)) letters.set(id, ALPHABET[letters.size % ALPHABET.length]);
    return letters.get(id)!;
  };
  const cell = new Box3();
  const inverse = new Matrix4();
  const nu = Math.round((o.u[1] - o.u[0]) / step);
  const nv = Math.round((o.v[1] - o.v[0]) / step);
  const rows: string[] = [];
  for (let j = nv - 1; j >= 0; j--) {
    const v = o.v[0] + j * step;
    let row = '';
    for (let i = 0; i < nu; i++) {
      const u = o.u[0] + i * step;
      const lo = o.axis === 'z' ? [u, v, o.at - step / 2] : o.axis === 'x' ? [o.at - step / 2, v, u] : [u, o.at - step / 2, v];
      const hi = o.axis === 'z' ? [u + step, v + step, o.at + step / 2] : o.axis === 'x' ? [o.at + step / 2, v + step, u + step] : [u + step, o.at + step / 2, v + step];
      cell.min.fromArray(lo);
      cell.max.fromArray(hi);
      const hit = items.find((it) => {
        if (!it.box.intersectsBox(cell)) return false;
        // The cell is in world space; the BVH wants the transform from it into the mesh.
        return it.bvh.intersectsBox(cell, inverse.copy(it.world).invert());
      });
      row += hit ? letter(hit.partId) : '.';
    }
    rows.push(`${v.toFixed(2).padStart(6)} ${row}`);
  }
  const [un, vn] = o.axis === 'z' ? ['x', 'y'] : o.axis === 'x' ? ['z', 'y'] : ['x', 'z'];
  return [
    `slice ${o.axis} = ${o.at} at t=${o.t ?? 0}: ${un} ${o.u[0]}…${o.u[1]} →, ${vn} ${o.v[0]}…${o.v[1]} ↑, step ${step}`,
    ...rows,
    [...letters].map(([id, l]) => `${l}=${id}`).join(' '),
  ].join('\n');
}

const params = new URLSearchParams(location.search);
const ALL_PAIRS = params.get('clashes') === 'all';
const FOCUS = (params.get('clashFocus') ?? '').split(',').filter(Boolean);
/** Dev: run the overlap pass at this timeline time (s) instead of full explode. */
const CLASH_AT = params.has('clashAt') ? Number(params.get('clashAt')) : null;

const isModel = (id: string) => PARTS_BY_ID.get(id)?.source === 'model';

/** True if one part is the other's ancestor. */
function related(a: string, b: string) {
  const up = (id: string, target: string) => {
    for (let d = PARTS_BY_ID.get(id); d?.parent; d = PARTS_BY_ID.get(d.parent)) if (d.parent === target) return true;
    return false;
  };
  return up(a, b) || up(b, a);
}

function allowed(a: string, b: string) {
  return !!(PARTS_BY_ID.get(a)?.contacts?.includes(b) || PARTS_BY_ID.get(b)?.contacts?.includes(a));
}

const still = (d: PartDef) => !d.explodeRotation && d.explodeOffset.every((v) => v === 0);

/** The nearest part, from this one up, that moves on its own; riders share it with their carrier. */
function movingRoot(id: string) {
  let d = PARTS_BY_ID.get(id)!;
  while (d.parent && still(d)) d = PARTS_BY_ID.get(d.parent)!;
  return d.id;
}

const movesWith = (a: string, b: string) => movingRoot(a) === movingRoot(b);

/** Records the first contact found for each pair. */
function add(m: Map<string, Map<string, Vector3>>, a: string, b: string, at: Vector3) {
  const others = m.get(a) ?? new Map<string, Vector3>();
  if (!others.has(b)) others.set(b, at);
  m.set(a, others);
}

/** A contact point in car coordinates. */
const where = (p: Vector3) => `(${p.toArray().map((v) => v.toFixed(3)).join(', ')})`;

const bvhCache = new WeakMap<BufferGeometry, MeshBVH>();

/** BVH over a float copy (model meshes are quantised; procedural geometry stays untouched). */
function bvhOf(geometry: BufferGeometry, Bvh: Bvh) {
  // Geometry rebuilt every frame (HV cables) is never cached.
  let bvh = geometry.userData.dynamic ? undefined : bvhCache.get(geometry);
  if (!bvh) {
    const src = geometry.getAttribute('position');
    const pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      pos[i * 3] = src.getX(i);
      pos[i * 3 + 1] = src.getY(i);
      pos[i * 3 + 2] = src.getZ(i);
    }
    const copy = new BufferGeometry();
    copy.setAttribute('position', new BufferAttribute(pos, 3));
    if (geometry.index) copy.setIndex(geometry.index.clone());
    bvh = new Bvh(copy);
    // Lets intersectsGeometry() run BVH against BVH. (Cast: drei bundles its own three-mesh-bvh typings.)
    (copy as { boundsTree?: unknown }).boundsTree = bvh;
    bvhCache.set(geometry, bvh);
  }
  return bvh;
}

/** Every mesh and instance of every mounted part, in the current pose. */
function collect(Bvh: Bvh) {
  const items: Item[] = [];
  const instance = new Matrix4();
  for (const def of PARTS) {
    const o = partObjects.get(def.id);
    if (!o) continue;
    o.content.updateWorldMatrix(true, true);
    o.content.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const bvh = bvhOf(mesh.geometry, Bvh);
      const local = bvh.geometry.boundingBox ?? (bvh.geometry.computeBoundingBox(), bvh.geometry.boundingBox!);
      const inst = mesh as InstancedMesh;
      const count = inst.isInstancedMesh ? inst.count : 1;
      for (let k = 0; k < count; k++) {
        const world = mesh.matrixWorld.clone();
        if (inst.isInstancedMesh) world.multiply((inst.getMatrixAt(k, instance), instance));
        items.push({ partId: def.id, mesh, world, box: local.clone().applyMatrix4(world), bvh });
      }
    });
  }
  return items;
}

const scratch = new Matrix4();
const seg = new Line3();
/** A point where the two items' triangles intersect (world), or null if they don't. */
function contact(a: Item, b: Item): Vector3 | null {
  scratch.copy(a.world).invert().multiply(b.world);
  let hit: Vector3 | null = null;
  a.bvh.bvhcast(b.bvh, scratch, {
    intersectsTriangles(t1, t2) {
      if (!t1.intersectsTriangle(t2, seg)) return false;
      hit = seg.getCenter(new Vector3()).applyMatrix4(a.world);
      return true;
    },
  });
  return hit;
}
