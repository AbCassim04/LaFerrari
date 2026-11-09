# Overnight run review (`wip/m2-overnight`)

Unattended run of the overnight plan: 2b, 2c, 2f, then milestone 7. One checkpoint
commit per phase on `wip/m2-overnight`; nothing pushed, `main` untouched. Decisions taken
without review are in docs/BRIEF.md under "Decisions made unattended (review)".

Screenshots were in docs/review/ (Playwright Chromium, 1440×900 unless noted; phone shots
390×844); since the review they are no longer committed (docs/review/ is git-ignored). Phases 1–3 show the dev panel; phase 4 hides it (`?panel=0`). The FPS meter in
the corner is dev-only, and reads near 0 because the review browser renders slowly.

## How performance is measured
Dev-only `PerfProbe` (src/scene/PerfProbe.tsx) reads `renderer.info` per frame
(`autoReset` off, so every pass counts) and the scene's geometry triangles with instances
expanded. Review scripts read `window.__perf` and `window.__perfParts()` (per-part
triangles). Three figures per phase:
- **scene**: triangles of all visible geometry (instances expanded), the content itself;
- **idle**: one still frame (main pass only; shadows are not re-rendered when nothing moves);
- **peak**: a frame while animating (`?perfPeak=1`: main pass + one shadow pass, the
  shadow map and contact shadows alternate frame by frame).

Budget: under ~1.5M triangles and ~500 draw calls for the whole scene.

| Phase | Scene tris | Idle: calls / tris (engine view · exploded) | Peak: calls / tris (exploded) |
|---|---|---|---|
| Start (2a + body, before fixes) | — | ~980–1030 calls / 3.3M (every frame) | same |
| 1 (2b) | 670k (powertrain 568k) | 187 / 0.65M · 214 / 0.67M | 377 / 1.06M |
| 2 (2c) | 756k | 221 / 0.74M · 248 / 0.76M | 433 / 1.23M |
| 3 (2f) | 695k | ≈285 / 0.68M · 305 / 0.70M | 400–493 / 0.91–1.20M |
| 4 (M7) | 695k | 268 / 0.69M (panel open) · 278 / 0.69M (hover) · 301 / 0.74M (X-ray) | 408–484 / 0.93–1.22M (exploded, crankshaft inspected) |
| 5 (2d, `wip/2d`) | 813k | 285 / 0.79M · 187 / 0.61M (exploded) · 305 / 0.81M (X-ray) | 495–505 / 1.42–1.43M (shadow-map frames), 415–425 / 1.13M (contact frames) |

Phase 3 adds the post-processing passes (N8AO at half resolution, tone mapping, SMAA: a handful of full-screen draws) and still comes in lower than phase 2: the hidden internals were trimmed.
Before phase 1 every frame re-rendered the shadow map, the contact shadows and a
transmission pass for the body glass: four scene passes. See "Phase 1" below.

## Phase 1: 2b intake, fuel, exhaust, electronics

**Built** (26 parts, src/parts/engine/intakeExhaust.ts, geometry in
src/parts/engine/geometry/intakeExhaust.ts, routing in src/parts/engine/exhaustLayout.ts,
sizes in `DIMS.engine` plenum/runner/throttleBody/intakeTube/airbox/fuelRail/exhaust/ecu/
fuseBox/loom):
- `intake-plenum-cover`: lofted pillow (superellipse plan and section, cosine-spaced
  stations so the rounded ends stay smooth), three shallow flutes per side and a centre
  groove carrying a red seam; clear-coated carbon with a visible twill (UVs in metres).
- `intake-runners-l/r` (trumpets ×6 instanced), `throttle-body-l/r` (with actuator),
  `intake-tube-l/r` (ribbed bellows swept along a curve with a varying radius, plain cuffs
  and 2 clamps), `airbox-l/r` (carbon, lid, outboard snout).
- `fuel-rail-l/r` with 6 instanced injectors into the V side of each head.
- `headers-l/r`: 6 primaries per bank (CatmullRom, centripetal), two twisted pairs weaving
  in outboard lanes plus two inboard drops, merging on a ring into the collector cone;
  port flanges ×6, port gaskets ×6, flange bolts ×12, O2 sensors ×2 instanced. Explode
  swings 25° out about the port line. Clearance check: `node --import
  ./scripts/ts-hooks.mjs scripts/dev/check-headers.mjs` (closest tube centres 39 mm for
  34 mm tubes; ≥13 mm from the head, ≥38 mm from everything else).
- `catalyst-l/r`, `exhaust-pipe-l/r` (flanged both ends, 2 clamps), `silencer-l/r`
  (pressed two-shell box, 2 brackets), `exhaust-tips-l/r` (2 per side, hollow with rolled
  lips, centred on the body's openings at x ±0.643/±0.752, y 0.324, exit z −2.07).
- `ecu-l/r` on the bay side walls (finned face inboard), `fuse-box`, `wiring-loom-l/r`
  along the cam covers with a lead to each coil and 12 clips.
- 2a review fixes: timing cover with chain-path housings, cast rim, bosses and webs
  around the water pumps and aux motor (they break its outline); block skirts with a
  horizontal rib and cast bosses.

**The "grey mush" through the glass** had three causes, all fixed:
1. The glass was alpha-blended with a light grey diffuse colour: a grey film over
   everything behind it. Glass is now reflection-only (`src + dst × (1 − opacity)`).
2. Environment lighting has no occlusion, so the engine under the body reflected the
   whole studio softbox; and three silently ignores `envMapIntensity` for materials lit by
   `scene.environment`, so the earlier tuning never applied. `EnvironmentLevels` binds the
   environment explicitly; our parts keep 25% of it while the body is on, ramping to full
   as the body comes off.
3. One big display light over the bay was mirrored by the clear coat as a white sheet;
   now two narrow strips that read as highlight lines along the plenum's shoulders.

**Performance work** (needed to get under the budget): body glass no longer uses
transmission (that re-rendered the whole scene every frame); the shadow map and contact
shadows only re-render while something moves, alternating frame by frame; meshes under
4 cm cast no shadows. `PerfProbe` added for the figures above.

**Gates**: `npm run typecheck` and `npm run build` pass. Clash check (C): assembled vs
body, only `ref-battery` (the placeholder 2c replaces); exploded overlaps: none.

**Screenshots**: p1-engine-glass (the view this phase is judged by), p1-rear34,
p1-engine-solo, p1-plenum, p1-headers, p1-tips, p1-engine-explode, p1-timing-cover.

**Known, left for later phases**: the gearbox placeholder (`ref-gearbox`) is still a
bright box behind the plenum (2c); cast-aluminium noise reads blotchy close up and the
cam covers are still too pink (2f); no bevels on the airbox/ECU boxes beyond their
corner radius (2f).

## Phase 2: 2c gearbox, clutch, hybrid, HV cables

**Built** (16 parts; `src/parts/drivetrain/`, sizes in `DIMS.transaxle`, `DIMS.battery`,
`DIMS.driveshaft`, `DIMS.hvCable`; the `ref-*` placeholders are gone):
- `transaxle` (assembly; stage 5 slides back 0.40) carrying `bellhousing` (lofted from the
  block's rear face, bolted flange ×16), `dct-casing` (lofted, tapering casing with four
  rib rings, X-rib lattice on both sides and the top, 60 seam bolts), `gear-clusters`
  (input shaft, two layshafts, 14 instanced gears, hidden inside), `rear-diff` (side
  bosses on the rear axle line with bolted covers and output flanges) and `main-emotor`
  (ribbed drum at the very rear, end cap with a 12-bolt ring, HV terminal box; back 0.35
  more).
- `flywheel` (ring gear, 8 bolts) and `dual-clutch` (ribbed drum), riding the engine and
  sliding out of the bellhousing.
- `inverter-l/r`: boxes on the casing top with X-braced lids, rim and lid bolts ×8, and
  orange HV ports.
- `driveshaft-l/r`: from the diff flanges on the axle line, inner and outer CV joints,
  ribbed boots (instanced pairs), bar and stub axle into the hub; stage 2 out 0.35.
- `battery-pack`: the approved floor-following tray (18 mm at the back, 42 mm at the
  front), 8 modules, 28 flange bolts, rear-centre HV connector; slides out to the left.
- `hv-cable-battery`, `hv-cable-aux`, `hv-cable-emotor`: 3-strand orange bundles with
  clips, rebuilt every frame between their ends (`HvCable.tsx`). Routes and explode slack
  are in `src/parts/drivetrain/index.ts`.

**Gates**: typecheck and build pass. Clash check (C): assembled vs body none; exploded
overlaps none; cables also checked mid-explode (`?clashes=1&clashFocus=hv-cable&clashAt=t`
at t = 1.0, 1.8, 2.0, 2.6, 3.0, 3.2, 3.4, 3.8, 4.0, 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 5.0 s): none.

**Screenshots**: p2-transaxle-solo, p2-stage5-explode, p2-cables-stage5-0/-50/-100
(t = 4.2, 4.7, 5.2 s: the battery cable stretches and re-curves as the pack slides out,
the e-motor cable follows the transaxle back), p2-car-explode-side, p2-engine-glass (the
inverters and cables now fill the back of the bay where the white placeholder was).

**Dev aids added**: clash report gives a contact point instead of a bounds overlap;
`?clashes=all` adds an info pass of our parts against each other when assembled;
`clashAt=<t>` and `clashFocus=a,b`; `t=<s>` poses the timeline; `solo=` takes a list.

**Known, left for later phases**: the gear clusters are only visible in a cutaway (not
built); the bellhousing's front is a flat face (no visible bolt-on flywheel opening).

## Phase 3: 2f realism

**Lighting and post**: CC0 studio HDRI (Poly Haven "Studio Small 09", 2k) under our
softbox Lightformers; ACES tone mapping (AgX made the red salmon); N8AO ambient occlusion
at half resolution plus SMAA (`src/scene/PostEffects.tsx`). Two compatibility fixes were
needed: no MSAA in the composer (N8AO got blank depth) and a patch for n8ao 2.0.1's
half-res target on three r187.

**Materials**: body paint gets a clear coat over a satin base (it had none and read
flat); fine sand-cast grain on cast aluminium; heat-tinted header primaries (vertex
colours, blue/purple at the ports to gold and straw); cam covers confirmed red; matte
rubber, satin-black brackets, clear-coated carbon as before.

**Geometry**: 1.5 mm rounds on every lathe-turned corner (no raw 90° edges on turned
parts; extrusions and boxes were already bevelled); coolant hoses from the water pumps
to the side-pod radiator area (re-curving, clamped); oil-tank straps, inverter feet, ECU
tabs and harnesses, airbox brackets and lid screws, flange bolts on throttle bodies,
catalysts and pipes.

**Gates**: typecheck and build pass; clash check: assembled vs body none, exploded
overlaps none; hoses and cables also checked at t = 2.0–5.0 s: none.

**Screenshots** (before = end of phase 2): p3-before/after-engine-glass,
p3-before/after-engine-solo, p3-before/after-rear34; N8AO off/on: p3-ao-off, p3-ao-on;
p3-headers-tint, p3-coolant-hose, p3-paint.

**Known**: on this machine's iGPU the full scene runs at ~1 fps in the review browser,
so frame times aren't meaningful here (draw calls and triangles are). The cabin glass
now shows the studio's reflections from above, which looks grey in the engine view.

## Phase 4: milestone 7, inspect panel and X-ray

**Built**:
- **Hover** (mouse only): cyan outline round the part and its name beside the pointer;
  the cursor becomes a pointer. Picking is BVH-accelerated and passes through glass,
  X-rayed panels and hidden parts.
- **Click**: the camera eases to frame the part (keeping its direction unless other parts
  would hide it, then the clearest nearby direction) and the panel opens with the
  part's group, name, description and specs; the picture shifts so the part sits beside
  the panel. Esc, the close button or a click on empty space closes it and the camera
  returns. A drag (orbit) doesn't close it. Works assembled and exploded, and while the
  explode is running (it frames where the part is heading).
- **Info**: every one of the 98 parts has a written description and specs; the thin
  ones (scavenge pump, filter, cooler, water pumps, mounts, ECUs, silencers, all the
  body panels, doors, wheels, calipers, tub) were rewritten or filled in.
- **X-ray** toggle next to Explode: body panels and the tub turn into faint ghost shells
  in place; wheels and brakes stay solid; parts inside can be hovered and clicked
  through them.
- **Mobile** (< 720 px wide): the panel is a bottom sheet (42% of the height), the
  Explode and X-ray buttons sit above it, tap selects, no hover; the camera presets back
  off on upright phones so the car fits across.

**Gates**: typecheck and build pass; clash check: assembled vs body none, exploded
overlaps none (no geometry changed). Interaction checked in the browser with real
pointer events: hover → tooltip and outline; click through the engine-cover glass →
plenum; Esc → closed, camera back to the exact earlier view; click on empty background
→ closed; drag → stays open; pointer onto the panel → hover cleared; touch tap on a
phone viewport → selected, no hover.

**Screenshots**: p4-hover-plenum (outline + tooltip through the glass), p4-panel-plenum,
p4-panel-crankshaft (exploded, clicked from the rear three-quarter overview),
p4-xray-rear34, p4-xray-side, p4-mobile, p4-mobile-sheet, p4-mobile-xray.

**Polish after the checkpoint**: camera framing (Explode and inspect) now fits the
corners of each part's own box instead of one box round everything (the exploded car
came out small in three-quarter views), and keeps the subject clear of the Explode/X-ray
buttons. Saved views restore exactly, focal offset included.

## 2d: radiators, fuel system, rear subframe and suspension (`wip/2d`)

**Built** (25 parts; `src/parts/chassis/` and `src/parts/cooling/`, sizes in
`DIMS.radiator/coolantTank/fuelTank/fuelLine/rearSuspension/bumperBeam`, explode in
`EXPLODE.rearCorner` and friends, timing in `CORNER_DELAY` / `FUEL_DELAY`):
- `radiator-l/r`: core, fins, end tanks and side frames under each side-intake grille,
  parallel to it; an outlet pipe drops to the coolant hose at the bay wall (the hoses
  now end there instead of on the tub).
- `coolant-tank`: translucent header tank with a pressure cap, on short legs left of
  the plenum cover.
- `fuel-tank` (≈50 L, est), `fuel-pump` (flange, two vertical quick-connect outlets),
  `fuel-line-l/r` (rigid, riding the fuel rails).
- `rear-subframe` (two tube ladders, node collars, clevis brackets for every pivot,
  bolted plates front and rear), `rear-bumper-beam` (box beam on crash cans).
- Per side: `rear-upright` (cast arms to three ball joints and the caliper lugs, bored
  bearing housing, hub), `rear-brake-disc` (two friction rings, 36 vanes, 72 cross-drilled
  holes, aluminium bell on bobbins), `rear-lower-wishbone`, `rear-upper-link`,
  `rear-toe-link`, `rear-coilover` (damper, spring, seats, eyes); plus
  `rear-anti-roll-bar` (bar, bushes, clamps, drop links) and `brake-lines-rear`.
- The model's rear discs are hidden; the HV battery cable is re-routed under and past
  the tank with its floor run pinned (new `pinned` cable waypoints).

**Gates**: typecheck and build pass. Clash check: assembled vs body none, exploded
overlaps none. Our own parts touch nothing they don't list (`?clashes=all`). With the
new parts' tub contacts stripped, the only tub contacts left are the designed ones: the
links, coilovers and brake hoses crossing the wheelhouse liner, and the subframe and
crash cans on the rear frame. Mid-explode sweeps (`clashAt`, focused on the new parts):
stage 2 every 0.15 s from 0.85 to 1.8 s, the lift at 1.55–2.3 s, the teardown at
2.4–3.3 s and stage 5 at 4.3–5.1 s, all clean except the pre-existing lift crossing
below.

**Pre-existing, found while sweeping**: the powertrain rises straight up, and around
t ≈ 1.75–1.9 s its front (cam covers, timing cover and chains) passes through the
roof-intake duct structure over the front of the bay (y ≈ 0.77–0.99, z −0.62…−0.30).
The fuel lines riding the engine do the same. A short move back before the lift would
avoid it; not changed here.

**Performance** (1440×900; how it's measured: top of this file): scene 813k triangles
(+117k for 2d, mostly the drilled ventilated discs, radiators, subframe and coilovers),
290 meshes. Idle: engine view 285 calls / 0.79M, exploded engine view 187 / 0.61M,
X-ray rear three-quarter 305 / 0.81M. Peak (`?perfPeak=1`, exploded): front and rear
three-quarter 495–505 / 1.42–1.43M on shadow-map frames and 415–425 / 1.13M on
contact-shadow frames; inspect isolation (rear upright) 180 / 0.44M. Triangles are
under the budget, but the exploded peak sits at the ~500 draw-call budget, not under it.
Getting there took merging the new parts' materials (72 → 33 meshes). Further cuts
would mean dropping detail: the drilled holes, the black spring and the radiator core
each cost a draw.

**Screenshots** (scratchpad `review-2d/`, 1440×900): 01-xray-rear34, 02-exploded-rear34,
03-corner-exploded, 04-suspension-solo, 05-pod-xray, 06-tank-xray, 07-inspect-disc,
08-inspect-subframe, 09-inspect-coolant-tank, 10-inspect-radiator, 11-tank-in-bay,
12-coilover-solo.

## Blocked
None.

## What to do next
1. Review the four phases with the screenshots above and the "Decisions made unattended
   (review)" entries in docs/BRIEF.md; merge `wip/m2-overnight` if happy (never pushed).
2. Look at the X-ray ghost look and the inspect framing on a real GPU at full frame rate
   (the review browser here runs at ~1 fps, so the camera eases were only checked with
   `?snap=1`).
3. Review 2d on `wip/2d` (section above), then continue with 2e (front axle and
   car-level parts) per docs/M2-PLAN.md.
4. Smaller follow-ups: cabin glass reads grey in the engine view under the new studio
   environment; the gear clusters are only visible in a future cutaway mode.
