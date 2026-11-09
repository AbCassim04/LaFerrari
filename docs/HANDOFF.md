# Handoff

Where the project stands and how to work on it. The spec and decision log are in
docs/BRIEF.md; read that first.

## Status (2026-11-08, overnight run)
- Milestone 1 (scaffold, scene, registry, explode pipeline) done and reviewed.
- Licensed body model integrated and segmented into parts; body explode reviewed.
- Milestone 2 plan approved (docs/M2-PLAN.md); 2a done (on main).
- **Overnight run on branch `wip/m2-overnight`** (never pushed; main untouched). Plan:
  phase 1 = 2b, phase 2 = 2c, phase 3 = 2f realism, phase 4 = milestone 7 inspect panel
  + X-ray. Progress, figures and screenshots in docs/REVIEW.md; unattended decisions in
  the BRIEF decision log.
- **Phase 1 (2b) done**: intake, fuel, exhaust, electronics (26 parts in
  `parts/engine/intakeExhaust.ts`), timing-cover and block detail, glass/lighting fixes
  for the through-the-glass view, shadow scheduling and perf probe.
- **Phase 2 (2c) done**: transaxle, clutch, hybrid system and re-curving HV cables in
  `parts/drivetrain/` (the `ref-*` placeholders are gone).
- **Phase 3 (2f) done**: studio HDRI + Lightformers, ACES, N8AO (half res) + SMAA,
  clear-coated paint, heat-tinted headers, cast grain, lathe rounds, coolant hoses and
  brackets/bolts/harness detail (`parts/cooling.ts`).
- **Phase 4 (milestone 7) done**: hover outline + name tooltip, click to frame + inspect
  panel (bottom sheet on narrow screens), info copy for every part, X-ray toggle.
- Overnight run reviewed and merged. Review fixes on `wip/2d` (2026-11-09): inspect
  isolation (other parts ghosted), deeper paint, car presets fitted to the car,
  screenshots no longer committed.
- **2d done on `wip/2d`** (not pushed): side-pod radiators, expansion tank, fuel tank,
  pump and lines, rear subframe and bumper beam, rear suspension, discs, anti-roll bar
  and brake hoses (25 parts). Figures and screenshots in docs/REVIEW.md.
- Next: review 2d, then 2e (front axle and car-level parts) per docs/M2-PLAN.md.

## Run
```
npm install
npm run dev          # http://127.0.0.1:5173/
npm run typecheck
npm run build
npm run prep:body    # assets-src/models/body.glb → public/models/body.opt.glb + docs/body-report.md
npx vite preview     # after a build: http://localhost:4173/LaFerrari/ (the production subpath)
```

## Deploy
GitHub Pages, https://abcassim04.github.io/LaFerrari/, by `.github/workflows/deploy.yml` on
every push to `main` (or run it by hand from the Actions tab). The repository's Pages
source must be set to "GitHub Actions". Production builds use the base path
`/LaFerrari/` (vite.config.ts); refer to files in public/ with `asset('models/…')`
(src/lib/asset.ts), never with a leading slash. The original model
(assets-src/models/body.glb) is not shipped.

## Layout
- `src/config/dims.ts` — every dimension (reference, model-measured, derived, explode).
- `src/config/scene.ts` — camera, controls, view presets, grid, shadows.
- `src/parts/registry.ts` — all parts; `parts/body` (model parts), `parts/engine` (the
  V12: `layout.ts` bank frames and kinematics, `geometry/*` builders, `intakeExhaust.ts`
  for 2b), `parts/drivetrain` (2c: transaxle, battery, driveshafts, `HvCable.tsx`:
  re-curving cables and hoses, with optional pinned waypoints), `parts/cooling` (radiators,
  expansion tank, coolant hoses), `parts/chassis` (2d: fuel system, rear subframe and
  bumper beam, rear suspension and brakes), `parts/powertrain.ts` (the assembly that
  lifts out). Types in `parts/types.ts`.
- `src/geometry/build.ts` — geometry toolkit (extrude with exact bevels, lathe, merge,
  hulls, gears). `src/scene/MeshSet.tsx` — part builds from mesh specs (plain or
  instanced).
- `src/scene/PartsRenderer.tsx` — mounts each part as anchor → swing → content.
  `partObjects.ts` holds the live objects the timeline tweens.
- `src/explode/` — one GSAP timeline (play = explode, reverse = assemble), stage timing,
  exploded-bounds helper used for the camera fit.
- `src/body/BodyModel.tsx` — loads body.opt.glb, builds model parts, tunes the
  engine-cover glass, dev diagnostics (bbox, wheel drift vs DIMS) and segment colours.
- `src/scene/ClashCheck.tsx` — dev key C.
- Inspect (milestone 7): `src/scene/Inspect.tsx` (camera framing of the selected part,
  ghost switching, the outline effect), `picking.ts` (what blocks a click), `ghosts.ts`
  (ghost shells for X-ray and for isolating the inspected part),
  `src/ui/InspectPanel.tsx`, `HoverTooltip.tsx`, `XrayToggle.tsx`. Picking is
  BVH-accelerated (`<Bvh>` in PartsRenderer); a click a part doesn't claim closes the
  panel (App.tsx). `CameraRig` keeps separate saved views for explode and inspect and
  shifts the picture (focal offset) so the part sits beside the panel.
- `src/scene/PostEffects.tsx` — N8AO, ACES tone mapping, SMAA (dev: `?ao=0`, `?aoView=1`,
  `?tone=agx`). `public/hdri/` — the CC0 studio HDRI.
- `src/scene/EnvironmentLevels.tsx` — per-material environment levels (bay specular
  occlusion; body glass). `ShadowScheduler.tsx` — shadows only re-render while things
  move. `PerfProbe.tsx` — dev perf readout (`window.__perf`, `window.__perfParts()`).
- `scripts/dev/check-headers.mjs` — exhaust primary clearance check
  (`node --import ./scripts/ts-hooks.mjs scripts/dev/check-headers.mjs`; the hooks file
  lets Node load the app's TypeScript modules).
- `scripts/prep-body.mjs` + `scripts/body-rules.mjs` — body asset pipeline (hidden
  nodes: the original engine bay and rear discs).
- Laying out new parts: `window.__slice({ axis, at, u, v, step, t, only, hide })` (dev)
  prints an ASCII section of every part (ours and the model's) at timeline time `t`,
  one letter per part; `scripts/dev/model-slices.mjs` does the same for the body model
  alone in Node. Mid-explode checks: `?clashes=1&clashAt=<s>&clashFocus=<ids>`.

## Conventions
- Car coordinates: metres, +Y up, +Z forward, +X = car's left, origin on the ground at
  the wheelbase centre. Part `position` is always in car coordinates.
- No magic numbers in part files: sizes/positions come from DIMS, tessellation from
  `config/detail.ts`, colours from `materials/materials.ts`.
- One milestone (or sub-milestone) at a time: dev server, screenshots, commit, stop.
- Commit messages end with the Co-Authored-By line used in git history.

## Dev aids
Keys: L ids, G guides, K segments, C clashes, S solo group, B engine-bay ghost.
Panel: solo part or group, camera presets, clash report.
URL: `?view=front34|top|engine|side|rear34&explode=1&t=<s>&fit=1&segments=1&labels=1&solo=<id>[,<id>…]&soloGroup=<group>&ghost=1&clashes=1|all&clashFocus=<a,b>&clashAt=<s>&guides=0&cam=x,y,z&look=x,y,z&perfPeak=1&inspect=<id>&xray=1&snap=1&panel=0`
(`inspect` opens the panel on a part, `snap` makes camera framing instant (the review
browser renders too slowly for the ease), `panel=0` hides the dev panel for product
shots; `window.__state()` returns selection/hover/X-ray/explode for scripts).
(`explode=1` jumps straight to the final pose; `fit=1` frames the scene after load;
`cam`/`look` set the starting camera for review screenshots).

## Screenshots and visual checks (WSL2)
Playwright's Chromium, driven by a small script (`page.goto` the dev URL, wait, screenshot):
- **GPU (default, ~3–5× faster)**: the full Chromium build (`ms-playwright/chromium-*/
  chrome-linux64/chrome`), *headed* on the WSLg display (`DISPLAY=:0`) with the window
  off-screen (`--window-position=-4000,-4000`), flags `--use-angle=gl
  --ignore-gpu-blocklist`, env `LD_LIBRARY_PATH=/usr/lib/wsl/lib GALLIUM_DRIVER=d3d12`.
  WebGL renderer: "ANGLE (Microsoft Corporation, D3D12 (Intel(R) Iris(R) Xe Graphics),
  OpenGL 4.1)". Headless modes never reach the GPU here (they fall back to SwiftShader;
  `--use-angle=vulkan` only finds llvmpipe, no D3D12 Vulkan driver is installed).
- **Fallback**: `chrome-headless-shell` with `--use-angle=swiftshader
  --enable-unsafe-swiftshader` (CPU). The system Playwright dependencies are installed,
  so the borrowed NSS/libasound libraries are no longer needed.
- Benchmark (2026-11-08, same two shots): GPU 14 s and 23 s per shot; SwiftShader 41 s
  and 111 s. One GPU run crashed once ("page closed"), so scripts retry with SwiftShader.
- Use small viewports (800×500) while iterating, 1440×900 for review shots. Shots live
  in the scratchpad (docs/review/ is git-ignored). GSAP lag
  smoothing still stretches animations at low frame rates: pose with `?explode=1` or
  `?t=<seconds>` rather than waiting for the timeline. `window.__perf` has the frame cost.

## Known issues
- three ignores `material.envMapIntensity` when lighting comes from `scene.environment`;
  set levels through `EnvironmentLevels` (or `modelEnvLevels` for model materials).
- `THREE.Clock` deprecation warning comes from inside R3F.
- Bundle > 500 kB warning (three + drei); code-split in the performance pass.
- docs/reference/ images are third-party and git-ignored.
