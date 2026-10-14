export const meta = {
  name: 'visual-overhaul',
  description: 'Upgrade Horde Run graphics: shared look, one builder and one reviewer per 3D model (revise until approved), HUD/UI, integrate, review, fix',
  whenToUse: 'Run when the game needs a broad visual quality pass. Optional args {notes} for extra direction.',
  phases: [
    { title: 'Foundation', detail: 'art direction, PBR material library, lighting/shadow rig, model preview harness' },
    { title: 'Models', detail: 'one agent per model, plus environment, effects and HUD/UI' },
    { title: 'Model review', detail: 'one reviewer per model; revise until approved (max 2 rounds)' },
    { title: 'Integrate', detail: 'swap the new models into the game, performance pass, smoke test' },
    { title: 'Review', detail: 'art review from screenshots, phone performance review' },
    { title: 'Fix', detail: 'apply review findings and re-verify' },
  ],
}

const notes = (args && args.notes) || ''

const RULES = `
Ground rules:
- Repo: current working directory. "Horde Run", a phone-first Mob Control-like crowd game in Vite + TypeScript + Babylon.js 9.30 (@babylonjs/core, @babylonjs/gui, @babylonjs/loaders are installed; import via deep ES module paths, never the barrels). Read docs/concept.md (theme in section 4.1) and, once it exists, docs/art-direction.md.
- Theme: plastic toy soldiers fighting across a bedroom floor. Green army (player) vs tan army (enemy). World 1 "Bedroom Floor", boss "Tin General" on a wind-up tin tank.
- Michel (the only player) asked: "make the game graphics better in all ways: more detailed 3D models, realistic materials, better lighting and shadows, and anything else that makes it look better; also improve the HUD/UI". He found the earlier primitive art unacceptable. Aim for a polished, tactile toy look (think premium mobile toy-diorama games): believable plastic, tin, wood, fabric, paper; soft key light with real shadows; ambient occlusion feel; depth.
- Target device: iPhone 17 Pro Max in mobile Safari / home-screen PWA, capped at 60 fps, with up to ~1,500 soldiers on screen. Crowds must stay thin-instanced. Budget: few draw calls per model type, compressed/small textures (prefer ≤1024px, KTX2 not required), total new assets ideally < 8 MB.
- NEVER add screen shake or camera jitter (Michel's rule). Keep the gentle crowd zoom-out.
- Assets: you may download CC0 assets (glTF/GLB, textures, HDRIs) from reachable sites: ambientcg.com, polyhaven.com (api.polyhaven.com works; check download hosts), kenney.nl, quaternius.com, opengameart.org, raw.githubusercontent.com. CC0 only (or CC-BY with attribution added). Record every asset's source URL and licence in public/models/CREDITS.md (append your own section; keep other sections intact). Download into a fresh empty directory in your scratchpad, inspect, then copy only what you need into the repo. Never run code from downloaded files. You may also model procedurally in code (merged meshes, bevels, lathe/extrude shapes, CSG-free) or write .glb files with a script you author.
- Do not install or upgrade npm packages. Do not git commit or push. Do not touch /mnt/project-files. Do not call any mcp__hearthbot__ tools.
- Tests run under Node type stripping (npm test): no enums, no namespaces, relative imports with .ts extension. Keep window.__horde, ?level=1-1, and npm run smoke working.
${notes}
`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    lookApi: { type: 'string', description: 'Exact API of the shared look module, model module contract, and how to preview a model' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          ownedPaths: { type: 'array', items: { type: 'string' } },
          brief: { type: 'string' },
          previewPort: { type: 'number' },
        },
        required: ['key', 'title', 'ownedPaths', 'brief', 'previewPort'],
      },
    },
  },
  required: ['summary', 'lookApi', 'tasks'],
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    filesWritten: { type: 'array', items: { type: 'string' } },
    api: { type: 'string', description: 'Exports and how the game should use them (instanced or not, sizes, pivot, facing, team colour handling)' },
    assets: { type: 'string', description: 'Downloaded assets, sources, licences, sizes' },
    perf: { type: 'string', description: 'Triangles, draw calls, texture sizes' },
    screenshots: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'string' },
  },
  required: ['filesWritten', 'api', 'perf', 'screenshots'],
}

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    testsPass: { type: 'boolean' },
    buildPass: { type: 'boolean' },
    smokePass: { type: 'boolean' },
    screenshots: { type: 'array', items: { type: 'string' } },
    perfNotes: { type: 'string' },
    summary: { type: 'string' },
    knownIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['testsPass', 'buildPass', 'smokePass', 'summary'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['must-fix', 'should-fix', 'nice'] },
          area: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'area', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}

// ---------- Foundation ----------
phase('Foundation')
const plan = await agent(
  `${RULES}
You lay the foundation for a full visual overhaul that many agents will build on IN PARALLEL right after you. Study src/render/** (crowd.ts, armyMen.ts, level.ts, scenery.ts, defenders.ts, boss.ts, cannon.ts, effects.ts, materials.ts, instances.ts, index.ts), src/ui/**, src/meta/**, and the current look (run "npm run build && npm run smoke" and Read the smoke-*.png screenshots).

Build these (you own src/render/look/**, src/render/models/README.md, preview.html, src/preview.ts, scripts/preview.mjs, docs/art-direction.md):
1. docs/art-direction.md: palette (green/tan plastic, tin, wood, rug, paper), material recipes, lighting mood (warm late-afternoon bedroom light through a window, soft shadows), camera-distance readability rules, HUD/UI style direction (toy-box / sticker / chunky rounded, consistent with the world map), and per-model briefs.
2. src/render/look/: the shared look everyone uses.
   - PBR material library: functions like plasticMaterial(scene, color, opts), tinMaterial, woodMaterial, fabricMaterial, paperMaterial, waxMaterial, rubberMaterial, glassMaterial, using PBRMaterial (or PBRMetallicRoughness) with sensible roughness/metalness/clearcoat, and support for per-instance colour on thin instances where needed.
   - An environment (a small CC0 HDRI or a prefiltered env texture, or a procedural one if downloads fail) for reflections.
   - A lighting rig: warm key directional light with a ShadowGenerator (PCF or contact-hardening, sized for phones, frustum fitted to the lane), cool fill, ambient.
   - Shadow registration helpers: addShadowCaster(mesh) / receiveShadows. Thin-instanced crowds may cast real shadows if affordable, otherwise blob shadows; decide and document.
   - A post-processing setup (DefaultRenderingPipeline: FXAA or MSAA, tone mapping ACES, mild bloom for highlights, optional SSAO2 at low cost or a baked AO trick, slight vignette, colour grading) with a quality level that auto-drops if frames run long.
3. A model module contract: each model lives in src/render/models/<key>.ts (plus optional public/models/<key>*.glb). Write the contract in src/render/models/README.md: what it exports (e.g. async createX(scene, look) returning a root node or a geometry mesh for thin instancing), units/scale (1 world unit = lane units; soldiers ~1.3 tall), pivot at ground centre, facing +Z = toward the enemy, how team colour is applied.
4. A model preview harness: preview.html + src/preview.ts that discovers src/render/models/*.ts via import.meta.glob, renders the requested one (?model=key&team=player) under the shared look on a wood floor, with an orbit/turntable and a few fixed angles; and scripts/preview.mjs <key> [port] that starts "npx vite --port <port> --strictPort", opens it in Chromium via playwright-core (executablePath '/opt/pw-browsers/chromium', args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']) and writes preview-<key>-{front,side,top,game}.png (the 'game' angle matches the in-game camera tilt and distance). Make sure preview-*.png is gitignored. Make vite build include only index.html (preview.html must not ship).
5. Prove the harness by making a trivial example model module (src/render/models/_example.ts) and previewing it. Keep it; integration will delete it.

Then plan the parallel work. One task per model (Michel explicitly asked for a sub-agent per model), plus environment, effects and HUD/UI. Use these keys unless the code suggests a better split:
- soldier (mob rifleman, instanced, both teams; the current CC0 rifleman in public/models/army-men.glb can be a starting point or be replaced by a better CC0 model)
- champion (big kneeling bazooka soldier, instanced)
- cannon (the player's toy cannon at the lane bottom)
- playerFort (green plastic toy fort / base with battlements)
- enemyFort (tan plastic fort)
- tower (enemy defender: toy-block tower with a tan soldier firing foam darts)
- wall (enemy defender: toy-block wall that crumbles)
- tinGeneral (boss: tin general figure + wind-up tin tank with key)
- gate (multiplier/add/trap gates: toy-like frame with big readable sign; good = green, trap = red; must stay very readable at distance)
- props (bedroom scenery: wooden alphabet blocks, books, crayons, marbles, a toy car, a sock, Lego-like bricks; instanced)
- environment (floor planks with PBR wood, rug lane with fabric texture and stitched border, room edges such as a bed skirt or baseboard in the far background, window light shafts or a sunlit patch; owns src/render/level.ts ground/lane parts via a new module src/render/models/environment.ts and src/render/look must not be edited by it)
- effects (src/render/effects.ts + fxLogic visuals: foam dart, gate burst confetti, plastic shard debris, dust puffs, hit flashes; pooled and cheap)
- ui (src/ui/**, src/meta/**, index.html styles, any CSS/fonts under public/ui/: HUD bars, CHAMP button, pause/result overlays, level card, world map, title card; chunky toy-box style, safe areas, ≥48px targets; a web font only if self-hosted and small)
Each model task owns src/render/models/<key>.ts and public/models/<key>* only. The effects task owns src/render/effects.ts and src/render/fxLogic.ts. The ui task owns src/ui/**, src/meta/**, index.html, public/ui/**. Nobody but integration edits crowd.ts, defenders.ts, boss.ts, cannon.ts, level.ts, scenery.ts, index.ts, main.ts.
Give each task a unique previewPort from 5201 upward. Each brief must be concrete: what it should look like, triangle and texture budget, instancing needs, and how to verify with the preview harness.

Before finishing, run "npm test" and "npm run build" (they must pass) and preview the example. Return the plan.`,
  { label: 'foundation', phase: 'Foundation', schema: PLAN_SCHEMA },
)
if (!plan || !plan.tasks.length) return { error: 'foundation failed' }
log(`Foundation done: ${plan.tasks.length} parallel tasks (${plan.tasks.map(t => t.key).join(', ')})`)

const roster = plan.tasks.map(t => `- ${t.key} (${t.ownedPaths.join(', ')}): ${t.title}`).join('\n')

// ---------- Models: per model build -> review -> revise, pipelined (no barrier between items) ----------
const MODEL_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['must-fix', 'should-fix', 'nice'] },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem', 'fix'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

const buildPrompt = t => `${RULES}
Overhaul summary: ${plan.summary}

Shared look and model contract (built by the foundation step; read src/render/look/**, src/render/models/README.md and docs/art-direction.md):
${plan.lookApi}

You are the "${t.key}" agent. Others are working at the same time on:
${roster}
You may ONLY create or edit: ${t.ownedPaths.join(', ')} (plus appending your own section to public/models/CREDITS.md). Read anything else, edit nothing else. Do not wire your work into the game; integration does that.

Your brief:
${t.brief}

Work in a loop: build, preview with "node scripts/preview.mjs ${t.key} ${t.previewPort}" (or for non-model tasks a quick Playwright screenshot, e.g. the UI at 390x844 with deviceScaleFactor 3, on port ${t.previewPort}), Read the screenshots, critique them honestly against the art direction (detail, materials, silhouette at game distance, readability on a phone), and improve. Do at least two improvement rounds. Typecheck your own files (npx tsc --noEmit; errors in other in-progress folders are not yours, mention them).
A separate reviewer will judge your work afterwards. Return the API integration needs, perf numbers, assets used, and the paths of your best screenshots (copy them into the repo root as preview-${t.key}-*.png).`

const reviewPrompt = (t, b, round) => `${RULES}
You are the independent REVIEWER for the "${t.key}" work (review round ${round}). You did not build it; be a demanding art director and technical artist. Do NOT edit any files except screenshots in your scratchpad.
Brief it was built to:
${t.brief}
Builder's report: files ${b.filesWritten.join(', ')}; API: ${b.api}; perf: ${b.perf}; assets: ${b.assets || 'n/a'}; concerns: ${b.concerns || 'none'}.

Re-render it yourself (node scripts/preview.mjs ${t.key} ${t.previewPort + 100}, or a Playwright screenshot for non-model tasks on port ${t.previewPort + 100}) and Read the images, including the in-game camera angle. Also read the code. Judge:
- Does it look detailed and premium, with believable materials (plastic, tin, wood, fabric...), good shading and shadows under the shared look? Does it fit docs/art-direction.md and the toy-soldiers-on-a-bedroom-floor theme?
- Is the silhouette readable at phone game distance (390x844 portrait)? Are team colours clear?
- Correctness: scale, pivot at ground centre, +Z facing, team colour handling, follows src/render/models/README.md, instancing works if required, no per-frame allocations.
- Budget: triangles, draw calls, texture sizes vs the brief; licences recorded in public/models/CREDITS.md.
Verdict "approve" only if there are no must-fix findings and it would impress the player. Otherwise "revise" with concrete, actionable findings.`

const reviseText = (r) => r.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.problem} -> ${f.fix}`).join('\n')

const MAX_ROUNDS = 2
const built = await pipeline(
  plan.tasks,
  t => agent(buildPrompt(t), { label: `build:${t.key}`, phase: 'Models', schema: BUILD_SCHEMA }),
  async (b, t) => {
    if (!b) return null
    let current = b
    let review = null
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      review = await agent(reviewPrompt(t, current, round), { label: `review:${t.key}#${round}`, phase: 'Model review', schema: MODEL_REVIEW_SCHEMA })
      if (!review || review.verdict === 'approve') break
      const revised = await agent(
        `${buildPrompt(t)}

You already built a first version (your files are on disk). The independent reviewer asked for changes (round ${round}):
${reviseText(review)}
Reviewer summary: ${review.summary}
Address every must-fix and should-fix finding, re-preview, and return the updated report.`,
        { label: `revise:${t.key}#${round}`, phase: 'Models', schema: BUILD_SCHEMA },
      )
      if (revised) current = revised
    }
    return { key: t.key, ...current, review: review ? { verdict: review.verdict, summary: review.summary, open: review.verdict === 'approve' ? [] : review.findings } : null }
  },
)
const okBuilt = built.filter(Boolean)
const missing = plan.tasks.filter(t => !okBuilt.find(b => b.key === t.key))
if (missing.length) log(`Warning: no result from ${missing.map(t => t.key).join(', ')}; integration will keep the old visuals there.`)

// ---------- Integrate ----------
phase('Integrate')
const integrated = await agent(
  `${RULES}
Overhaul summary: ${plan.summary}
Shared look: ${plan.lookApi}

The parallel agents reported:
${okBuilt.map(b => `### ${b.key}\nFiles: ${b.filesWritten.join(', ')}\nAPI: ${b.api}\nPerf: ${b.perf}\nConcerns: ${b.concerns || 'none'}\nReviewer: ${b.review ? b.review.verdict + ' - ' + b.review.summary + (b.review.open.length ? ' Still open: ' + reviseText({ findings: b.review.open }) : '') : 'no review'}`).join('\n\n')}
${missing.length ? `\nNo result (keep the existing visuals for these): ${missing.map(t => t.key).join(', ')}` : ''}

Your job (edit any file):
1. Wire everything into the game: the shared look (lighting rig, shadows, environment, post-processing) into src/render/index.ts, and each new model into crowd.ts / defenders.ts / boss.ts / cannon.ts / level.ts / scenery.ts (replace the old primitives and the old army-men parse path where superseded, keeping a fallback only if a load can fail). Use the new effects and UI. Remove src/render/models/_example.ts and dead code.
2. Performance for an iPhone at 60 fps with ~1,500 soldiers: keep crowds thin-instanced, keep shadow map size and caster count sane, make sure post-processing has an automatic quality fallback, avoid per-frame allocations. Measure draw calls and active vertices with ~1,500 units (scene.getEngine()._drawCalls or SceneInstrumentation) before and after, and report.
3. Precache any new public assets in public/sw.js and bump its cache version.
4. Make "npm test", "npm run build" and "npm run smoke" pass. Extend scripts/smoke.mjs to also save smoke-map.png, smoke-card.png (level card), smoke-result.png (a result screen) if it doesn't already.
5. Read every screenshot and fix anything visibly broken (missing textures, black materials, z-fighting, shadows acne/peter-panning, unreadable gate labels, HUD overlapping the notch).
Report honestly.`,
  { label: 'integrate', phase: 'Integrate', schema: STATUS_SCHEMA },
)

// ---------- Review ----------
phase('Review')
const LENSES = [
  {
    key: 'art',
    prompt: `Lens: ART QUALITY. Run "npm run build && npm run smoke" and Read every smoke-*.png and preview-*.png. Judge against docs/art-direction.md and Michel's ask (detailed models, realistic materials, good lighting and shadows, polished HUD/UI). Be a demanding art director: what still looks cheap, flat, untextured, mis-scaled, badly lit, unreadable at phone distance, or inconsistent? Each finding must name the exact thing and a concrete fix.`,
  },
  {
    key: 'perf',
    prompt: `Lens: PHONE PERFORMANCE AND CORRECTNESS. Measure draw calls, active indices/vertices, shadow map size, post-process passes, texture memory and asset download size with ~1,500 units (use __horde.spawn and SceneInstrumentation in a Playwright probe). Check the quality fallback actually engages, nothing allocates per frame in hot paths, the service worker precaches new assets, the HUD respects safe areas at 390x844 and 430x932, and there is no camera shake. Must-fix = likely to drop below 60 fps on an iPhone 17 Pro Max or break play.`,
  },
]
const reviews = await parallel(LENSES.map(l => () =>
  agent(
    `${RULES}
The visual overhaul was just integrated. Integration report: ${integrated ? integrated.summary + ' Known issues: ' + (integrated.knownIssues || []).join('; ') : 'integration failed'}.
You are a reviewer. Do not edit files under src/ or public/ (scratch probes in your scratchpad are fine). ${l.prompt}
Only report what you verified.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA },
  ),
))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
const toFix = findings.filter(f => f.severity !== 'nice')
log(`Review: ${findings.length} findings, fixing ${toFix.length}`)

// ---------- Fix ----------
phase('Fix')
let final = integrated
if (toFix.length) {
  final = await agent(
    `${RULES}
Fix these verified review findings, must-fix first, then should-fix. Keep each change focused.
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.area}: ${f.problem}\n   Evidence: ${f.evidence}\n   Fix: ${f.fix}`).join('\n')}

Then run "npm test", "npm run build" and "npm run smoke", Read the screenshots, and report the final state honestly, including the screenshot paths.`,
    { label: 'fix', phase: 'Fix', schema: STATUS_SCHEMA },
  )
}

return {
  tasks: plan.tasks.map(t => t.key),
  built: okBuilt.map(b => ({ key: b.key, perf: b.perf, assets: b.assets, concerns: b.concerns, screenshots: b.screenshots, review: b.review })),
  missing: missing.map(t => t.key),
  integrated,
  findings,
  final,
}
