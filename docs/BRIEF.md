# Project: Exploded Hypercar — interactive 3D powertrain reveal

This is the reference spec. It is kept up to date when a decision changes it; see the
decision log at the bottom. Current state and how to work on the code: docs/HANDOFF.md.

## Goal
A single-page site showing a mid-engined V12 hybrid hypercar. One button ("Explode")
animates the car apart in stages so the viewer sees how a 6.3L V12, hybrid system,
gearbox and battery are packaged inside a car only 1.116 m tall. Pressing again
reassembles it. Clicking any part focuses the camera on it and shows an info panel.

Engineering layout follows the real Ferrari LaFerrari.

### Body: licensed model (supersedes the original-body requirement, 2026-11-08)
The body is a licensed model: "2014 Ferrari LaFerrari" by Ddiaz Design (Sketchfab),
CC BY-NC-SA 4.0, at assets-src/models/body.glb (original, untouched; not shipped: the
site serves only the adapted public/models/body.opt.glb).
- The MODEL provides: body panels, doors + door glass, hood, front/rear kits, engine
  cover, interior, wheels/tyres, calipers.
- WE BUILD procedurally: the full V12, gearbox, diff, driveshafts, main + aux e-motors,
  battery, HV cables, radiators, exhaust, suspension, uprights, brake discs (and the rest
  of the milestone-2 parts list below).
- Our procedural tub is only kept if it doesn't clash with the model's interior;
  otherwise the model is the reference (currently: model only).
- The UI credits the model with links to the source and licence, noting it is modified.
- Procedural parts carry no logos or text. The model's own badges are part of the
  licensed asset.
- Licence obligations: attribution, non-commercial use only, and adaptations of the
  model (body.opt.glb) are shared under the same licence (public/models/LICENSE.md).

## Stack
- Vite + React + TypeScript
- @react-three/fiber, @react-three/drei, @react-three/postprocessing
- GSAP for the explode timeline
- Zustand for state (exploded state, selected part, hovered part)
- Asset pipeline: @gltf-transform + meshoptimizer (scripts/prep-body.mjs)
- three-mesh-bvh (dev clash check, bay measurement)
- No backend. Must hold 60 fps on a mid-range laptop.

## Units & coordinates
1 unit = 1 metre. Origin = ground under the centre of the wheelbase.
+Z = forward, +Y = up, +X = car's left. The prepped body model is baked into this frame.

## Reference dimensions
Real-car reference figures, with the model's measured values adopted where they differ
by < 3 cm (so our suspension meets its wheels):
- Overall (ref): L 4.702, W 1.992, H 1.116. Model measures L 4.724, W 2.115 incl.
  mirrors, H 1.105.
- Wheelbase: 2.655 (model; ref 2.650).
- Track: front 1.693, rear 1.622 (model; ref 1.68 / 1.61), at tyre centreline.
- Ground clearance: 0.104 (ref).
- Tyres: front 265/30R19 (Ø 641.6 mm), rear 345/30R20 (Ø 715.0 mm). Model wheel centres
  at y 0.324 front / 0.360 rear.
- Brakes: carbon-ceramic discs, 398 mm front, 380 mm rear.
- Suspension: double wishbone front, multi-link rear.
- Chassis: carbon-fibre monocoque tub, seats moulded into the tub.
- Engine: 6262 cc V12, 65° bank angle, bore 94 mm, stroke 75.2 mm, DOHC,
  naturally aspirated, longitudinal, rear-mid mounted behind the cabin.
  Dry sump (model a sump pan low and shallow).
- Gearbox: 7-speed dual-clutch, mounted behind the engine.
- Hybrid: main electric motor mounted on the BACK of the gearbox, driving the
  final drive via its own gear set. A small auxiliary electric motor replaces
  the alternator (mount on the engine front).
- Battery: ~66 kg Li-ion pack under the floor, beneath the seats.
- Cooling: side-mounted radiators feeding from side intakes.

Measured packaging (2 cm voxels, against all visible model geometry):
- Firewall z −0.338 (rearmost cabin structure spanning both seats; the model has no
  solid firewall panel).
- engineBay (tall core): x ±0.34, y 0.13–0.75, z −1.328…−0.348.
- engineBayWide (lower): x ±0.48, y 0.13–0.59, z −1.328…−0.588 (the bay narrows at the
  top front where the roof-intake ducts come in).
- transaxleBay: x ±0.50, y 0.21–0.65, z −1.768…−1.328.

## Architecture
src/config/dims.ts — ALL dimensions, including derived ones (axle z, wheel centre
heights, model measurements, bays, explode distances). Every part reads from it; no
magic numbers inside part files, so proportions can be retuned in one place.

src/parts/registry.ts — the single source of truth for parts. Each part:
  { id, name, group, description, specs: Record<string,string>,
    build: () => JSX (procedural geometry), position, rotation,
    explodeOffset: [x,y,z], stage: number, color/material key,
    parent?, explodeRotation?, pivot?, delay?, source? }
- `position` is always in car coordinates, even for child parts.
- `parent`: child parts ride along with the parent's offset and swing; their own
  `explodeOffset` is added on top.
- `explodeRotation` + `pivot` (car axes): hinged motion (doors, engine cover, headers).
- `delay`: seconds after the stage starts.
- `source: 'model'`: geometry comes from the body model (with its own materials).
Groups: "body", "chassis", "suspension", "wheels", "engine", "hybrid",
"transmission", "cooling", "exhaust".

Each part is its own mesh/group so it can move independently.
Use InstancedMesh for repeated parts (cylinders, pistons, valves, bolts).

Body pipeline: `npm run prep:body` turns body.glb into body.opt.glb with one top-level
node per registry part id and writes docs/body-report.md (normalisation, wheel
centres, hinges, bays, every source mesh → part). The source mesh names are unreliable
(pieces are merged by material across regions), so scripts/body-rules.mjs combines name
rules with spatial rules applied per connected piece. The model's stand-in engine bay
(plenum, airboxes, cables, ECUs, deck shelves, exhaust tips) goes to a hidden
`model-engine-bay` node: never rendered in production, kept as a placement guide.

## Milestone 2 spec: the full powertrain (2026-11-08)
Full text in the request of that date; the essentials:
- Placement guide: dev key B shows `model-engine-bay` as a faint ghost; our plenum,
  airboxes, inverters, cable routes and exhaust tips sit where the original's did.
- References: docs/reference/laf-ref-01..12.jpg (third-party portfolio; proportions,
  layout and routing ONLY; no textures, no logos or text on geometry; not committed).
- Layout: carbon plenum cover over the V (red centre seam, 12 runners under it); two
  ribbed intake tubes at the gearbox end from carbon airboxes either side of the
  gearbox (drawing from the rear-deck scoops); red cam covers per bank with 6 coil packs
  and edge bolts; silver block and heads; headers outside each bank, low, 6-into-1
  crossing tubes → catalyst per side → pipes along the gearbox → box silencer at each
  rear corner with twin tips at the body's exhaust openings; ribbed DCT casing with
  driveshafts leaving at its front third on the rear axle line, gear clusters behind,
  main e-motor cylinder on the very rear; inverter-l/r on top of the gearbox; orange
  HV bundles battery → inverters → main e-motor and inverter → aux e-motor; battery
  tray under the cabin floor; rear suspension mounting to the gearbox and a tubular
  rear subframe with bumper beam; radiators in the side pods tilted out ~30°; aux
  e-motor low at the cabin end; crank 6 throws at 120° with pistons at real phases.
- Parts checklist: engine core, second-tier detail, car-level parts as listed in the
  request (target ~150 registry parts, a few thousand instances, 60 fps).
- Granularity: anything a person would name = its own registry part with an info-panel
  entry; repeated small items = instanced sub-parts riding with their parent; < 5 mm
  or never visible = skip.
- Everything fits the measured bays with no intersections (dev key C).
- Explode stage 4 reads as a teardown, outside → in: plenum cover → intake tubes,
  airboxes, throttle bodies → runners + fuel rails → cam covers + coil packs →
  camshafts → heads (valves ride along) → headers swing out → sump drops → pistons +
  rods rise → crankshaft drops. Flywheel + clutch separate when the gearbox slides back.
  Stage 5: e-motor slides rearward, inverters lift off, battery slides out. Nothing
  overlaps at full explode. HV cables re-curve between their endpoints every frame.
- Realism: N8AO, CC0 Poly Haven studio HDRI (public/hdri/) plus our Lightformers,
  AgX/ACES, ~1.5–3 mm bevels on hard edges, instanced bolts/clamps/brackets/looms,
  per-material finishes (cast-alu noise, smooth cam covers, heat-tinted headers,
  clearcoated carbon, matte hoses, satin black brackets). Report draw calls and
  triangles for the powertrain.
- Sub-milestones, each reviewed and committed: 2a engine core + heads + valvetrain,
  2b intake + fuel + exhaust, 2c gearbox + clutch + hybrid + cables, 2d cooling + fuel
  tank + rear chassis + suspension, 2e front axle + car-level parts, 2f realism pass.

## Explode sequence (GSAP timeline, ~5.2 s total, staged)
Stage 1: body. Engine cover first and highest (it's the reveal; it opens about its front
         hinge as it lifts), doors swing up, then roof/canopy, the other panels, and
         finally the rear clam (up and back) and the wing above it.
Stage 2: wheels slide outward with the calipers, discs, uprights and driveshafts, the
         links and coilovers follow; the radiators rise out of the side pods and the
         rear bumper beam slides back. The subframe and anti-roll bar stay.
Stage 3: engine + gearbox assembly rises out of the bay (the fuel lines ride it,
         unclipping from the pump).
Stage 4: engine teardown (see milestone 2 spec).
Stage 5: e-motor slides rearward; inverters lift; battery slides out to the car's left;
         the fuel tank slides back into the empty bay and its pump lifts off it.
Second click: reverse timeline. Allow interruption mid-animation.

## Interaction & UI
- Big single "Explode / Assemble" button, bottom centre.
- drei `<CameraControls>` (damped orbit, zoom limits, target boxed above the ground).
- On Explode the camera eases out to fit the full exploded bounds (keeping the current
  viewing angle, with padding); on Assemble it returns to the previous view.
- Hover: outline highlight + part name tooltip.
- Click: camera eases to frame the part; side panel shows name, description,
  specs from the registry. Esc / click empty space to close.
- Toggle: "X-ray" mode (body panels go translucent, no explode) to show packaging
  in place.
- Dark studio look: soft environment lighting, contact shadows, subtle bloom.
- Model credit line, bottom left.

### Dev-only aids
Keys: L part ids, G guides, K segment colours, C clash check (real triangles, assembled
vs body + overlaps at full explode), S solo the selected part's group, B model engine-bay
ghost. Panel: solo a part or a group, camera presets. URL: ?view=front34|top|engine|side|
rear34, explode=1, fit=1, segments=1, labels=1, solo=<id>, soloGroup=<group>, ghost=1,
clashes=1, guides=0, cam=x,y,z&look=x,y,z. FPS meter.

### Later (noted, not built)
- "Cutaway" toggle that slices the gearbox and one bank open with a red section face,
  like laf-ref-06/07.

## Work plan
One milestone at a time; run the dev server, commit with a clear message, stop for review.
1. Scaffold project, scene, lighting, controls, registry system, ground grid. ✓
   Body model integration (licensed GLTF). ✓
2. Full powertrain, in sub-milestones 2a–2f (see the milestone 2 spec).
3. (folded into 2c/2d) Gearbox, e-motor, battery, HV cables, cooling.
4. (folded into 2d/2e) Subframes, suspension, brakes.
5. (done by the model) Body shell.
6. Full staged explode timeline + reverse.
7. Hover/click/inspect panel + X-ray mode. ✓ (overnight run, on `wip/m2-overnight`)
8. Polish: post-processing, performance pass, mobile layout.

## Open questions
- Battery exit in stage 5: it currently sinks to the ground while sliding out past the
  car's left side ("drops below the tub" would go through the floor).

## Decision log
**2026-11-08 (before milestone 1)**
- Use drei `<CameraControls>` instead of `<OrbitControls>`.
- git: commit at the end of each milestone.
- Track F/R 1.68/1.61 m and ground clearance 0.104 m (real figures). Overhangs,
  crank height, cylinder spacing, gearbox layout and engine z-range: estimates OK for now.
- All dimensions live in src/config/dims.ts; no magic numbers in part files.
- HV cables: route both battery -> main motor and battery -> aux motor.
- Approved additions: exhaust-rear, undertray-diffuser, and registry fields
  explodeRotation, pivot, delay, parent.
- Dev-only toggle for floating part-id labels.

**2026-11-08 (after milestone 1)**
- Review fixes: child parts ride inside the parent's swing; pivot/explodeRotation are
  in car axes; camera target boxed above the ground.
- Licensed body model adopted ("2014 Ferrari LaFerrari" by Ddiaz Design, Sketchfab,
  CC BY-NC-SA 4.0). This replaces the original-body requirement and the procedural body
  and wheels. Credit line in the UI ("· modified" added, as the licence requires).
- Model prep: unused skin removed (it was referenced by no node), transforms baked,
  ×100 to metres, ground at y 0 and wheelbase centred; meshopt; 7.56 MB → 3.24 MB,
  449 → 79 draw calls.
- Adopted model values: wheelbase 2.655, track 1.693/1.622, wheel-centre heights,
  body extents. Front overhang estimate (0.975) replaced by the model's 1.200.
- Name-pattern mapping alone proved wrong (e.g. one left-door panel is named SM_Base,
  the roof is in SM_RearKit, all glass is one primitive), so segmentation is
  name + spatial rules per connected piece (scripts/body-rules.mjs).
- The model does have a stand-in engine bay (top surfaces only): hidden as
  model-engine-bay, used as a placement guide.
- Engine bay measured as two boxes (tall core + wide lower), plus a transaxle bay.
- Body explode: engine cover (glass + side rails + louvres) on its own, first and
  highest, tilting open about its front hinge; canopy (windscreen + roof + trailing edge
  with the third brake light) separate from the rear clam; stagger engine cover →
  canopy → panels → rear clam → wing. Camera fits the exploded bounds on Explode and
  returns on Assemble.

**2026-11-08 (milestone 2 plan and 2a)**
- Milestone 2 plan approved (docs/M2-PLAN.md, layout figures docs/m2-layout-*.svg).
- Battery: a flat tray on the model's underbody (y ≈ 0.10) under the cabin floor,
  20 mm deep at the back stepping to 42 mm at the front; touches nothing (built in 2c).
- Model shells: driveshafts and rear suspension pass through the model's connected
  underbody shell (wheelhouse liners, bay walls) as expected contacts; the duct panels
  behind each side-intake grille get hidden so the radiators sit there (2d).
- Clash check (C) tests real triangles, with a per-part `contacts` allowlist, plus a
  second pass for overlaps at full explode.
- Explode ~5.2 s: stage 4 is the outside-in teardown (0.8 s moves), stage 5 at 4.2 s.
- Dev keys: K segment colours, S solo group, B engine-bay ghost.
- Engine at true scale, never shrunk to fit: 0.58 m across the cam covers (from bore
  94, stroke 75.2, spacing 104, 65° V, rod 140 mm and estimated head proportions; no
  published F140 external dimensions found). The ~0.8 m often quoted is across the
  exhaust headers (2b). Deck height 0.207, block 0.67 m long, timing face to bellhousing
  0.715 m, sump bottom 0.145 above ground. It fits the bay with no body contact.
- Bank stagger: the right bank sits one rod width (22 mm) behind the left; crank 6
  throws at 0/240/120/120/240/0°, firing order 1-5-3-6-2-4 per bank; pistons and valves
  posed at their real positions for a 20° crank angle.
- Teardown distances retuned so nothing overlaps at full explode: rods rise 0.30 (out of
  the bores), pistons 0.36, gasket 0.40, heads 0.47; crank drops 0.25 and the sump 0.29
  (the scavenge pump stays above the bay's top-front ducts).
- Engine-cover glass: the prep's dedup() had merged the cover's own glass material back
  into the shared dark glass, so it was never tuned. It is now cloned after dedup and
  tuned to a clear, faintly tinted pane (15% opacity, no metallic tint, no shadow).
  Transparent model materials no longer cast shadows.
- Engine-bay display light: a soft downward area light over the engine's footprint,
  below the deck around the cover opening (no spill on the paint), intensity 5.
- Camera minDistance 1.5 → 0.6 so the exploded engine's detail can be inspected.

**Decisions made unattended (review)** — overnight run on `wip/m2-overnight`, 2026-11-08/09.
Each was the most reasonable option at the time; all are easy to revisit.

*Phase 1 (2b)*
- Exhaust primaries: per bank, the front two pairs drop into outboard lanes and run back
  twisting around each other (a rigid twist, 360° and 180°), the rear two drop down the
  inboard side; all six meet a 46 mm-radius ring at the collector. Closest tube centres
  39 mm for 34 mm tubes (`scripts/dev/check-headers.mjs` checks tube gaps and clearances).
- Exhaust pipe route: the carbon tub has a wall at x ±0.62 from the axle back to
  z −1.72, so the pipes stay inboard of it and enter each silencer through its inboard
  face, not its front face. Pipes explode out 0.30 and back 0.05 (off the catalyst flange).
- Airboxes take air through a snout on the outboard face; a duct up to the deck scoop
  would run into the tub/clam ducting there.
- ECUs sit against the bay side walls (yawed 15.6° to follow them), the fuse box ahead of
  the right ECU; they ride the powertrain like the rest of 2b.
- Ignition loom runs along the top of each cam cover (inboard of the coil packs), with a
  lead to each coil; not along the V side, where the fuel rails and runners are.
- Oil cooler now explodes down and out (0.10 out, 0.12 down) to clear the swung headers.
- "Grey mush" root cause: environment lighting has no occlusion, and three ignores
  `envMapIntensity` for materials lit by `scene.environment`. Our materials now get the
  environment bound explicitly and keep 25% of it while the body encloses the bay,
  ramping to 100% as the body comes off (`EnvironmentLevels`; full in solo views).
- Body glass: every glass (canopy, doors, tail lamps too, not only the engine cover) is a
  plain-alpha, reflection-only pane (`src + dst × (1 − opacity)`): no transmission pass
  (done early for the draw-call budget) and no grey film over what is behind it.
- Bay display light: two narrow strips along the sides instead of one panel, so the
  plenum's clear coat shows highlight lines rather than one white sheet.
- Shadows only re-render while something moves (explode timeline or a state change),
  alternating the shadow map and contact shadows frame by frame; meshes under 4 cm
  (bolts, clips, springs) cast no shadows.
- `engine` view preset now looks down through the glass from above (the phase is judged
  by this view).
- Timing cover rebuilt: flat plate, raised housings over each bank's chain run, cast rim,
  and bosses tied in by webs around the water pumps and aux motor. Block skirts gained a
  horizontal rib and two cast bosses per side.

*Phase 2 (2c)*
- Transaxle layout: bellhousing from the block's rear face to z −1.22, round the flywheel
  and dual clutch; DCT casing z −1.22…−1.78 (2 cm shorter than the layout figure: the
  tub's rear structure sits at z −1.97, behind the e-motor); diff bosses on both sides on
  the rear axle line with bolted covers and output flanges; e-motor drum behind the casing.
- Flywheel and clutch ride the powertrain (they stay with the engine and slide back 0.12
  and 0.24 out of the bellhousing); everything else rides the transaxle.
- Inverters ride the powertrain rather than the transaxle: they lift 0.30 straight up in
  stage 5 and the casing slides back beneath them. Riding the transaxle dragged their
  cables through the lifted airbox.
- Battery tray 18 mm deep at the back, not 20: the cabin floor sits at y 0.131 over part
  of it. Modules and bolt heads stand 1.2 mm proud.
- HV routes: the battery and aux-motor cables both run up the left of the engine (the
  battery slides out to the left, so a right-hand route was stretched across the engine),
  the e-motor cable down the right of the oil tank. The battery cable passes through the
  tub's bulkhead behind the seats (listed contact).
- Cable motion: the assembled route is exact; while exploding, each waypoint follows a
  blend of the two ends' displacements plus a per-cable "slack" bow (outward, up, a
  little back) that grows with how far the ends have separated. Checked with the overlap
  pass at t = 1.0…5.2 s: no cable passes through a part at any sampled time.
- Inverter ports: two on the front face at different heights (the two left cables cross
  one above the other), one on the rear face. E-motor HV terminal on its right side.
- Stage 5 is 0.8 s with delays up to 0.2 s (transaxle and battery, then clutch, flywheel,
  e-motor and inverters), so the explode still ends at 5.2 s.
- Removed the `ref-*` placeholders; the powertrain assembly moved to
  `src/parts/powertrain.ts`.

*Phase 3 (2f realism)*
- Environment: CC0 Poly Haven "Studio Small 09" (Sergej Majboroda), 2k HDR in
  public/hdri/, with the existing softbox Lightformers on top; never the background.
- Tone mapping: ACES filmic. AgX was tried first and turned the body's red to salmon.
- N8AO at half resolution (radius 0.25 m, intensity 6). The composer runs without MSAA
  (N8AO received no usable depth from multisampled buffers) and SMAA does the edges.
  n8ao 2.0.1's half-res render target breaks on three r187 (its `texture` getter
  returns an array); patched at load in `PostEffects.tsx`. n8ao is now a direct
  dependency, with a minimal type declaration.
- Body paint: the model's paints had no clear coat, so the body read flat in the new
  environment. They now have a satin base under a near-mirror clear coat (red and black).
- Exhaust tips are exempt from the bay's specular occlusion (they are seen outside).
- Bevels: every lathe-turned corner gets a 1.5 mm round by default (skipped on features
  under ~4 mm and points on the axis); extrusions and rounded boxes already had bevels.
- Materials: fine low-contrast cast grain (roughness + slight bump) instead of blotchy
  noise; headers heat-tinted by vertex colour (blue/purple at the ports → bronze → gold
  → straw → steel); cam covers read red under ACES and bay occlusion (no colour change).
- Detail: coolant hoses (re-curving, single rubber strand, 4 clamps) from re-angled water
  pump inlets out through the bay walls to the side-pod radiator area; oil-tank straps;
  inverter feet; ECU wall tabs and harnesses; airbox brackets and lid screws; flange
  bolts on the throttle bodies, catalysts and exhaust pipes.
- Aux e-motor now explodes down and forward (0.2 down, 0.15 forward) instead of out and
  forward, so it clears the new coolant hose.
- Performance: hidden internals trimmed (valve springs 12 segments per coil and 6 round
  the wire, timing-chain links plain boxes); contact shadows only consider the 1.2 m
  above the ground; no shadow casting under 5 cm; plain meshes merged per material in
  each part.

*Phase 4 (milestone 7: inspect + X-ray)*
- Outline: postprocessing's OutlineEffect, but without its full-scene depth pre-pass
  (it doubled the draw calls) and with a plain mask material (the stock one failed to
  link on the Mesa/D3D12 driver). So the outline shows a part's whole silhouette, also
  where other parts cover it; that reads as "it's in there" and helped with buried parts.
  Hovered and selected parts are both outlined.
- Glass (engine cover, cabin) is click-through: clicking the plenum through the engine
  cover selects the plenum, not the cover. The cover's rails still select it.
- Framing: the camera keeps its viewing direction when it can, but tries nearby
  directions and takes the one from which other parts hide least of the selected part
  (needed once exploded: zooming straight in on the crankshaft put the catalyst in front
  of it). The picture is shifted so the part sits in the space beside the panel (above
  the sheet on phones). Esc / close / a click on empty space returns to the earlier view.
- Explode or Assemble while the panel is open: the panel stays, the camera takes the
  explode framing, and the view to return to is the one from before the inspect.
- X-ray: body panels and the tub become fresnel "ghost" shells (additive, faint face-on,
  glowing at the silhouette, in each panel's own colour mixed with a cool white). Plain
  alpha made the stacked panels pile into an opaque red block. Wheels and brakes stay
  solid. X-ray doesn't explode anything and works in either state.
- The panel shows group, "part of the …" for child parts, description and specs. Body
  descriptions keep "From the licensed body model."
- Phones held upright: the camera presets back off (up to 2.4×) so the car fits across
  the screen; the bottom sheet is 42% of the height; the controls ride above it; the
  model credit moves to the top while the sheet is open (it stays visible).
- Hover and selection don't re-render the shadows (they can't change them).

**2026-11-09 (review of the overnight run; branch `wip/2d`)**
- Inspect isolation: while a part is selected, every other part becomes a faint ghost
  shell (the X-ray shader, fainter and cooler), not pickable, casting no shadow; the
  selected part stays solid with its outline. Restored on close. This replaces the
  camera's "find an unblocked direction" search, which is no longer needed.
- Paint: deep rosso (#b4000c) with a weaker, rougher base-coat sheen under the same
  clear coat; the model's brighter red went coral under ACES when lit from above.
- Car presets (front34, top, side, rear34) give only a direction; the camera fits the
  assembled car from there, clear of the buttons, on any screen shape. The engine
  close-up keeps its hand-placed pose.
- Review screenshots are no longer committed: docs/review/ is git-ignored and shots
  live in the scratchpad; docs/REVIEW.md still describes them.
- Ghost shells render in one pass (`forceSinglePass`), and N8AO's automatic
  transparency mode is off (it re-rendered every transparent mesh twice): isolation and
  X-ray stay within the draw-call budget, and plain views got cheaper too.

**2026-11-09 (deployment; branch `wip/deploy`)**
- Published on GitHub Pages at https://abcassim04.github.io/LaFerrari/ (a subpath):
  Vite `base` is '/LaFerrari/' for builds and '/' in dev; files in public/ are referred
  to through `asset()` (src/lib/asset.ts, on `import.meta.env.BASE_URL`), never with a
  leading slash.
- The original model moved to assets-src/models/body.glb (the prep script reads it from
  there); only the adapted body.opt.glb and its LICENSE.md ship.
- GitHub Actions workflow .github/workflows/deploy.yml builds and deploys on every push
  to main (and on demand).


**2026-11-09 (2d: radiators, fuel system, rear subframe and suspension; branch `wip/2d`)**
- The model's rear brake discs are split off and hidden (`model-rear-discs`, 105
  triangles per side); our ventilated, cross-drilled carbon-ceramic discs replace them
  inside the model's calipers.
- Radiators lie under the side-intake grilles, parallel to them, so the pod itself is
  the duct; no pod panels needed hiding (M2 decision 2). The coolant hoses now end on
  the radiators' outlets at the bay wall and re-curve as the radiators leave in stage 2
  (out 0.3, up 0.45).
- Expansion tank: left of the plenum cover above the cam cover, on short legs to the
  cam cover's shoulder; it rides the engine and leaves in the teardown (out 0.3, up 0.2).
  Placed inboard of a tub ledge and behind the roof-intake duct so it lifts clear of both.
- Fuel tank: a prism in the slot behind the seats, its front face following the seat
  backs, about 50 L (est; the real car's is larger, but that is what the slot in the
  model holds). The roll structure covers its ends from above, so it can't lift out: in
  stage 5 it slides back 0.5 into the bay the powertrain has left.
- Fuel lines: rigid, one per bank (`fuel-line-l/r`), riding the fuel rails and unclipping
  from the pump's quick connectors as the powertrain lifts. No re-curving line can reach
  the rails, which end up in the middle of the exploded engine.
- Cables can pin waypoints (`pinned` in a route): pinned points stay put, and each
  stretch re-curves only with its own ends. The HV battery cable's run along the floor,
  under the tank and out past its end, is pinned. Otherwise the inverter's lift pulled
  it up into the tank, and the tank slides back over it. Re-routed for the tank.
- Rear subframe: two welded tube ladders, one each side of the gearbox, outboard of the
  exhaust and inboard of the wheelhouse liners. The rear post rakes forward over the
  exhaust pipe climbing to the silencer. Bolted to the tub at the front and the model's
  rear frame at the back; the bumper beam's crash cans bolt to the same frame. It stays.
- Rear suspension: lower wishbone, upper link and toe link to the subframe, coilover
  from the wishbone to the upper rail, cast upright with a bored bearing housing.
  Joints stack vertically at the upright and the chassis pivots sit in clevises facing
  along z, so every link slides straight out. The links cross the wheelhouse liner (M2
  decision 2).
- Explode distances: disc 0.45 with its caliper (it can't leave through the caliper's
  bridge), upright 0.42 starting with it (the driveshaft's outer joint, going 0.35,
  never catches it), wishbone and upper link 0.15, toe link 0.2, coilover 0.25, bumper
  beam back 0.5 rising 0.04 over the diffuser's raised edge.
- The anti-roll bar stays on the subframe: the floor is below it, diffuser strakes
  behind, the catalysts ahead and the subframe's wishbone brackets above its arms.
- Draw calls: the 2d parts use few materials each (bush housings in the arm's steel,
  painted black straps and drop links, fins, collars and bolts baked into their part's
  mesh), which keeps the exploded peak at the ~500 budget.
