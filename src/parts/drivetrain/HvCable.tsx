import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, MathUtils, Matrix4, Vector3, type InstancedMesh } from 'three';
import { DIMS, type Vec3 } from '../../config/dims';
import { SEGMENTS } from '../../config/detail';
import { lathe } from '../../geometry/build';
import { getMaterial, type MaterialKey } from '../../materials/materials';
import { dynamicParts, partObjects } from '../../scene/partObjects';
import { band } from '../engine/geometry/core';

/** One end of a cable: a point on a part (car coordinates, assembled) and the way the cable leaves it. */
export interface CableEnd {
  part: string;
  /** The part's `position` (car coordinates), so the point can be expressed in its frame. */
  origin: Vec3;
  at: Vector3;
  dir: Vector3;
}

/** How a cable or hose is built: strands round the centreline, material, clamps. */
export interface CableStyle {
  strands: number;
  strandRadius: number;
  /** Distance of each strand from the centreline (0 for a single hose). */
  offset: number;
  /** Turns per metre of the strands round each other. */
  twist: number;
  material: MaterialKey;
  clipMaterial: MaterialKey;
  clipWidth: number;
  /** Where the clips or clamps sit along the cable (0…1), given its length. */
  clips: (length: number) => number[];
}

const H = DIMS.hvCable;

/** Three orange strands twisted round each other, black clips every `clipSpacing`. */
export const HV_STYLE: CableStyle = {
  strands: 3,
  strandRadius: H.strandRadius,
  offset: H.bundleOffset,
  twist: H.twist,
  material: 'hvOrange',
  clipMaterial: 'satinBlack',
  clipWidth: H.clip[1],
  clips: (length) => {
    const n = Math.max(1, Math.floor(length / H.clipSpacing));
    return Array.from({ length: n }, (_, c) => (c + 0.5) / n);
  },
};

export interface CableRoute {
  id: string;
  style?: CableStyle;
  from: CableEnd;
  to: CableEnd;
  /** Assembled route between the ends (car coordinates). */
  via: readonly Vector3[];
  /**
   * How far the middle of the cable bows out (car axes) once its ends have separated by
   * `slackGrowth` more than when assembled: keeps it outside the exploded parts.
   */
  slack: Vector3;
  /** Where along the cable (0…1) the slack peaks; default the middle. */
  slackPeak?: number;
  /**
   * Indices into `via` of points clipped to the chassis: they stay put, each stretch
   * between them re-curves only with its own ends, and the slack applies after the last.
   */
  pinned?: readonly number[];
}

const T = SEGMENTS.cable;
const R = SEGMENTS.cableRadial;
/** Straight run out of each connector before the cable may bend. */
const LEAD = 0.05;

/**
 * Build for a cable or hose (by default an HV bundle: 3 orange strands twisted round each
 * other, with clips) that re-curves every frame between its two ends. Each assembled waypoint is carried along
 * by a blend of the two ends' displacements (by its position along the route), so the
 * assembled route is exact and the cable follows its ends smoothly as they separate.
 * Pinned waypoints stay put and split the blend into stretches between them.
 */
export function cableBuild(route: CableRoute) {
  function Build() {
    const clipsRef = useRef<InstancedMesh>(null);
    const state = useMemo(() => createCable(route), []);

    useLayoutEffect(() => {
      const update = () => state.update(clipsRef.current);
      dynamicParts.set(route.id, update);
      update();
      return () => {
        dynamicParts.delete(route.id);
      };
    }, [state]);

    useFrame(() => state.update(clipsRef.current));

    return (
      <>
        <mesh geometry={state.geometry} material={getMaterial(state.style.material)} />
        {state.clipAt.length > 0 && (
          <instancedMesh ref={clipsRef} args={[state.clipGeometry, getMaterial(state.style.clipMaterial), state.clipAt.length]} />
        )}
      </>
    );
  }
  Build.displayName = `HvCable(${route.id})`;
  return Build;
}

/** One part made of several cables (e.g. a line to each side), each re-curving on its own. */
export function cablesBuild(name: string, routes: readonly CableRoute[]) {
  const builds = routes.map(cableBuild);
  function Build() {
    return (
      <>
        {builds.map((B, i) => (
          <B key={i} />
        ))}
      </>
    );
  }
  Build.displayName = name;
  return Build;
}

function createCable(route: CableRoute) {
  const { from, to } = route;
  const style = route.style ?? HV_STYLE;
  const STRANDS = style.strands;
  const leadA = from.at.clone().addScaledVector(from.dir, LEAD);
  const leadB = to.at.clone().addScaledVector(to.dir, LEAD);
  const assembled = [from.at, leadA, ...route.via, leadB, to.at];
  // Anchors: the ends and any pinned waypoints (control-point indices).
  const last = assembled.length - 1;
  const anchors = [0, ...(route.pinned ?? []).map((i) => i + 2), last];
  // Each control point's stretch (between anchors k and k+1) and its position along it (0…1).
  const cum = [0];
  for (let i = 1; i < assembled.length; i++) cum.push(cum[i - 1] + assembled[i].distanceTo(assembled[i - 1]));
  const stretch = assembled.map((_, i) => Math.max(0, anchors.findIndex((a) => a >= i) - 1));
  const share = assembled.map((_, i) => {
    const [a, b] = [anchors[stretch[i]], anchors[stretch[i] + 1]];
    return (cum[i] - cum[a]) / (cum[b] - cum[a] || 1);
  });
  const slackFrom = anchors[anchors.length - 2];
  const span = assembled[slackFrom].distanceTo(to.at);
  // Slack profile sin(π s^k), with k putting the peak at slackPeak.
  const slackPower = Math.log(0.5) / Math.log(route.slackPeak ?? 0.5);

  const geometry = new BufferGeometry();
  const verts = STRANDS * (T + 1) * (R + 1);
  const position = new BufferAttribute(new Float32Array(verts * 3), 3);
  const normal = new BufferAttribute(new Float32Array(verts * 3), 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(verts * 2), 2));
  const index: number[] = [];
  for (let k = 0; k < STRANDS; k++) {
    const base = k * (T + 1) * (R + 1);
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < R; j++) {
        const a = base + i * (R + 1) + j;
        const b = a + R + 1;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  geometry.setIndex(index);
  geometry.userData.dynamic = true;

  const clipR = style.offset + style.strandRadius;
  const clipGeometry = lathe(band(clipR, clipR + style.strandRadius * 0.4, -style.clipWidth / 2, style.clipWidth / 2), SEGMENTS.small);
  const length = cum[cum.length - 1];
  const clipAt = style.clips(length);

  const local = (end: CableEnd) => end.at.clone().sub(new Vector3(...end.origin));
  const localA = local(from);
  const localB = local(to);
  const nowA = new Vector3();
  const nowB = new Vector3();
  const prev = { a: new Vector3(NaN, 0, 0), b: new Vector3() };
  const m = new Matrix4();

  /** World position of a cable end now (assembled position if its part isn't mounted). */
  function endNow(end: CableEnd, loc: Vector3, out: Vector3) {
    const o = partObjects.get(end.part);
    if (!o) return out.copy(end.at);
    o.content.updateWorldMatrix(true, false);
    return out.copy(loc).applyMatrix4(o.content.matrixWorld);
  }

  function update(clips: InstancedMesh | null) {
    endNow(from, localA, nowA);
    endNow(to, localB, nowB);
    const still = nowA.distanceToSquared(prev.a) < 1e-12 && nowB.distanceToSquared(prev.b) < 1e-12;
    if (still && (!clips || clips.userData.placed)) return;
    if (clips) clips.userData.placed = true;
    prev.a.copy(nowA);
    prev.b.copy(nowB);
    const zero = new Vector3();
    const moved = (a: number) => (a === 0 ? nowA.clone().sub(from.at) : a === last ? nowB.clone().sub(to.at) : zero);
    const slackStart = slackFrom === 0 ? nowA : assembled[slackFrom];
    const grown = MathUtils.clamp((slackStart.distanceTo(nowB) - span) / DIMS.hvCable.slackGrowth, 0, 1);
    const points = assembled.map((p, i) => {
      const k = stretch[i];
      const out = p.clone().add(moved(anchors[k]).clone().lerp(moved(anchors[k + 1]), share[i]));
      return k === anchors.length - 2 ? out.addScaledVector(route.slack, grown * Math.sin(Math.PI * share[i] ** slackPower)) : out;
    });
    const pts = new CatmullRomCurve3(points, false, 'centripetal').getSpacedPoints(T);

    // Parallel-transport frames along the centreline.
    const tangents = pts.map((_, i) => pts[Math.min(i + 1, T)].clone().sub(pts[Math.max(i - 1, 0)]).normalize());
    const normals: Vector3[] = [];
    let n = new Vector3(0, 1, 0);
    if (Math.abs(n.dot(tangents[0])) > 0.9) n.set(1, 0, 0);
    for (const t of tangents) {
      n = n.clone().addScaledVector(t, -t.dot(n)).normalize();
      normals.push(n);
    }
    const p = new Vector3();
    const off = new Vector3();
    const dir = new Vector3();
    let v = 0;
    for (let k = 0; k < STRANDS; k++) {
      for (let i = 0; i <= T; i++) {
        const t = tangents[i];
        const nn = normals[i];
        const bb = new Vector3().crossVectors(t, nn);
        const twist = (k / STRANDS) * Math.PI * 2 + (i / T) * length * style.twist * Math.PI * 2;
        off.copy(nn).multiplyScalar(Math.cos(twist) * style.offset).addScaledVector(bb, Math.sin(twist) * style.offset);
        for (let j = 0; j <= R; j++) {
          const a = (j / R) * Math.PI * 2;
          dir.copy(nn).multiplyScalar(Math.cos(a)).addScaledVector(bb, Math.sin(a));
          p.copy(pts[i]).add(off).addScaledVector(dir, style.strandRadius);
          position.setXYZ(v, p.x, p.y, p.z);
          normal.setXYZ(v, dir.x, dir.y, dir.z);
          v++;
        }
      }
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // Keep the picking BVH (added by <Bvh>) in step with the new shape.
    (geometry as { boundsTree?: { refit: () => void } }).boundsTree?.refit();

    if (clips) {
      for (let c = 0; c < clipAt.length; c++) {
        const i = Math.round(clipAt[c] * T);
        const t = tangents[i];
        const nn = normals[i];
        m.makeBasis(new Vector3().crossVectors(t, nn), t, nn).setPosition(pts[i]);
        clips.setMatrixAt(c, m);
      }
      clips.instanceMatrix.needsUpdate = true;
      clips.computeBoundingBox();
      clips.computeBoundingSphere();
    }
  }

  // Assembled shape up front, so bounds (shadow and culling decisions) are right on mount.
  update(null);
  return { geometry, clipGeometry, clipAt, style, update };
}
