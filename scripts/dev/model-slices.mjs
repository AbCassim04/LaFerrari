// ASCII occupancy slices of the body model, for laying out parts against it.
//   node scripts/dev/model-slices.mjs --axis z --at -1.33 --u 0.3:1.0 --v 0:0.8 [--step 0.02]
//        [--only wheel-rl,caliper-rl] [--hide model-engine-bay] [--thick 0.02]
// Slices perpendicular to --axis at --at; --u/--v are the other two axes in x,y,z order
// (axis z → u = x, v = y; axis x → u = z, v = y; axis y → u = x, v = z). Each cell shows
// the first letter code of the part whose triangles pass through it ('.' = free).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const range = (s) => s.split(':').map(Number);
const axis = arg('axis', 'z');
const at = Number(arg('at', '0'));
const step = Number(arg('step', '0.02'));
const thick = Number(arg('thick', String(step)));
const [u0, u1] = range(arg('u', '-1:1'));
const [v0, v1] = range(arg('v', '0:1.2'));
const only = arg('only', '')?.split(',').filter(Boolean);
const hide = (arg('hide', 'model-engine-bay') ?? '').split(',').filter(Boolean);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('public/models/body.opt.glb');
const parts = [];
for (const top of doc.getRoot().getDefaultScene().listChildren()) {
  const id = top.getName();
  if (hide.includes(id) || (only?.length && !only.includes(id))) continue;
  const pos = [];
  top.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const m = new Matrix4().fromArray(n.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION');
      const idx = p.getIndices();
      const count = idx ? idx.getCount() : a.getCount();
      const v = new Vector3();
      for (let i = 0; i < count; i++) {
        const e = a.getElement(idx ? idx.getScalar(i) : i, []);
        v.fromArray(e).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
      }
    }
  });
  if (!pos.length) continue;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  parts.push({ id, bvh: new MeshBVH(g) });
}
const code = (id) => {
  const map = { wheel: 'W', caliper: 'K', 'carbon-tub': 'T', 'rear-clam': 'R', 'side-intake': 'I', 'undertray-diffuser': 'U', 'engine-cover': 'E', door: 'D', canopy: 'C', nose: 'N', 'front-clam': 'F', 'rear-wing': 'S', 'model-engine-bay': 'm' };
  for (const [k, c] of Object.entries(map)) if (id.startsWith(k)) return c;
  return '?';
};
const legend = [...new Set(parts.map((p) => `${code(p.id)}=${p.id.replace(/-(l|r|fl|fr|rl|rr)$/, '')}`))].join(' ');
const box = new Box3();
const lines = [];
const nu = Math.round((u1 - u0) / step), nv = Math.round((v1 - v0) / step);
for (let j = nv - 1; j >= 0; j--) {
  const v = v0 + j * step;
  let row = '';
  for (let i = 0; i < nu; i++) {
    const u = u0 + i * step;
    const lo = axis === 'z' ? [u, v, at - thick / 2] : axis === 'x' ? [at - thick / 2, v, u] : [u, at - thick / 2, v];
    const hi = axis === 'z' ? [u + step, v + step, at + thick / 2] : axis === 'x' ? [at + thick / 2, v + step, u + step] : [u + step, at + thick / 2, v + step];
    box.min.fromArray(lo);
    box.max.fromArray(hi);
    const hit = parts.find((p) => p.bvh.intersectsBox(box, new Matrix4()));
    row += hit ? code(hit.id) : '.';
  }
  lines.push(`${v.toFixed(2).padStart(6)} ${row}`);
}
const [un, vn] = axis === 'z' ? ['x', 'y'] : axis === 'x' ? ['z', 'y'] : ['x', 'z'];
console.log(`slice ${axis} = ${at} (±${thick / 2}), ${un} → ${u0}…${u1}, ${vn} ↑ ${v0}…${v1}, step ${step}`);
console.log(`       ${un}=${u0}${' '.repeat(Math.max(1, nu - String(u0).length - String(u1).length - 4))}${un}=${u1}`);
console.log(lines.join('\n'));
console.log(legend);
