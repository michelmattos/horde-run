export const meta = {
  name: 'build-milestone',
  description: 'Build one Horde Run milestone from docs/concept.md: plan, parallel module builders, integrate, phone smoke test, review, fix',
  whenToUse: 'Run with args {milestone: N} to build milestone N of the build plan in docs/concept.md section 9.',
  phases: [
    { title: 'Plan', detail: 'split the milestone into disjoint module tasks' },
    { title: 'Build', detail: 'one agent per module, in parallel' },
    { title: 'Integrate', detail: 'wire main.ts, smoke test in a phone viewport' },
    { title: 'Review', detail: 'phone/touch/perf and gameplay/correctness lenses' },
    { title: 'Fix', detail: 'apply must-fix findings and re-verify' },
  ],
}

const milestone = (args && args.milestone) || 1
const extra = (args && args.notes) || ''

const RULES = `
Ground rules (apply to everything you do):
- Repository: the current working directory, a Vite + TypeScript + Babylon.js game ("Horde Run"). The design source of truth is docs/concept.md; read the parts relevant to your task (sections 2, 5, 8 and 9 matter most).
- It is a personal single-player web game, phone-first: portrait, touch is the primary input, mouse/keyboard secondary. Target 60 fps on a mid-range phone.
- src/contracts.ts holds the shared cross-module types. Do not change existing shapes in it. If you truly need something new, ADD an optional field or a new export and mention it in your result.
- Import Babylon via deep ES module paths (e.g. '@babylonjs/core/Meshes/mesh'), never the '@babylonjs/core' barrel, to keep the bundle small. Remember side-effect imports Babylon needs (e.g. '@babylonjs/core/Meshes/thinInstanceMesh' for thin instances).
- Tests run with Node's type stripping (npm test → node --experimental-strip-types --test tests/*.test.ts): no enums, no namespaces, no parameter properties, and relative imports must include the .ts extension. Pure logic (sim, rules, RNG, input math) must not import Babylon so it stays testable.
- Do not install, add or upgrade npm packages; use what package.json already has.
- Do not git commit, push, or create branches. Do not touch /mnt/project-files. Do not call any mcp__hearthbot__ tools.
- Placeholder art only: primitives and flat colours (player team blue, enemy team red, gates green for good ops and red for bad ops).
- Keep code readable: short module-level comments explaining intent, no dead code.
`

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          ownedPaths: { type: 'array', items: { type: 'string' } },
          brief: { type: 'string' },
        },
        required: ['key', 'title', 'ownedPaths', 'brief'],
      },
    },
  },
  required: ['summary', 'acceptance', 'tasks'],
}

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    filesWritten: { type: 'array', items: { type: 'string' } },
    publicApi: { type: 'string', description: 'Exports other modules use, with signatures and how to call them each frame' },
    contractAdditions: { type: 'string' },
    checks: { type: 'string', description: 'typecheck / test results for your files' },
    concerns: { type: 'string' },
  },
  required: ['filesWritten', 'publicApi', 'checks'],
}

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    testsPass: { type: 'boolean' },
    buildPass: { type: 'boolean' },
    smokePass: { type: 'boolean' },
    smokeNotes: { type: 'string', description: 'what the smoke run measured: fps, unit counts, outcome, screenshots written' },
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
          file: { type: 'string' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'how you confirmed it: code path, smoke output, test' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['findings'],
}

// ---------- Plan ----------
phase('Plan')
const plan = await agent(
  `${RULES}
You are planning milestone ${milestone} of the build plan in docs/concept.md section 9. ${extra}
Look at what already exists in src/ and tests/ and plan only what is missing for this milestone.

Split the work into 3 or 4 tasks that can be built IN PARALLEL by separate agents with NO overlapping files. Each task owns a set of paths (folders or files) and only writes there. src/main.ts and scripts/ belong to the later integration step, so no task owns them. src/contracts.ts is shared and read-only for builders.

For milestone 1 (core feel prototype) the natural split is:
- sim: src/sim/** + tests/sim*.test.ts. Data-oriented crowd sim per concept section 8 (typed arrays, spatial hash, movement up the lane with separation, player/enemy cancellation on contact, gates applied once per unit with burst spread, unit cap with stacked weights ~1500 on phone, base damage), deterministic with a seeded RNG it receives. Exposes SimView.
- render: src/render/**. Scene, tilted portrait camera looking up the lane that keeps the whole lane width visible on a tall phone screen, lane/ground, gates with big readable labels, cannon, bases with HP, thin-instance unit renderer fed from SimView each frame, cheap effects (gate burst, base hit flash, light shake), capped hardware scaling with auto-lowering when frames run long.
- control: src/core/** + src/ui/**. Fixed-timestep loop helper, seeded RNG (src/core/rng.ts, used by sim and game), pointer input per concept "Touch controls" (relative drag, hold-to-fire in lower screen, multi-touch by pointer id, champion button ≥56px in a bottom corner clear of safe areas, Space/mouse mapping, sensitivity), pause on visibility/orientation change, haptics with toggle, Babylon GUI HUD (both base HP bars, unit counts, champion charge), win/lose overlay with instant retry and next-level, service worker registration (public/sw.js, cache-first app shell).
- game: src/game/** + src/data/** + tests/game*.test.ts. Battle rules on top of the sim (cannon fire rate and aim limit from LevelDef, enemy waves and trickle, champion charge and launch, victory/defeat), a level loader, and 3 tuned prototype levels as JSON that ramp from easy to tense (60-120 s battles), using x2/x3/+N gates, one moving gate, and one trap gate.
Adapt this for later milestones (campaign world, Expedition, progression, editor) using the concept doc.

Each brief must be self-contained and concrete: what to build, the public API other tasks will call (function names and signatures), and how it uses src/contracts.ts. Also list acceptance criteria for the milestone as a whole (what Michel should be able to do on his phone).`,
  { label: 'plan', phase: 'Plan', schema: TASKS_SCHEMA },
)
if (!plan || !plan.tasks.length) return { error: 'planning failed' }
log(`Milestone ${milestone}: ${plan.tasks.length} parallel tasks (${plan.tasks.map(t => t.key).join(', ')})`)

const briefsOverview = plan.tasks.map(t => `- ${t.key} (${t.ownedPaths.join(', ')}): ${t.title}`).join('\n')

// ---------- Build (barrier: integration needs every module) ----------
phase('Build')
const built = await parallel(plan.tasks.map(t => () =>
  agent(
    `${RULES}
Milestone ${milestone}: ${plan.summary}

You are the "${t.key}" builder. Other agents are building the other modules at the same time:
${briefsOverview}

You may ONLY create or edit files under: ${t.ownedPaths.join(', ')}. Other folders are being written concurrently; read them if useful but never edit them, and do not rely on their APIs beyond what their briefs promise (they may not exist yet).

Your brief:
${t.brief}

When done, run "npx tsc --noEmit" and "npm test" and make sure nothing in YOUR files causes errors (errors in other folders that are still being written are not yours; mention them). Return the public API precisely so the integrator can wire it up without guessing.`,
    { label: `build:${t.key}`, phase: 'Build', schema: BUILD_SCHEMA },
  ).then(r => r && { key: t.key, ...r }),
))
const okBuilt = built.filter(Boolean)
if (okBuilt.length < plan.tasks.length) log(`Warning: ${plan.tasks.length - okBuilt.length} builder(s) failed; the integrator will fill the gap.`)

// ---------- Integrate ----------
phase('Integrate')
const integrated = await agent(
  `${RULES}
Milestone ${milestone}: ${plan.summary}

The modules were just built in parallel. Their reported APIs:
${okBuilt.map(b => `### ${b.key}\nFiles: ${b.filesWritten.join(', ')}\nAPI: ${b.publicApi}\nContract additions: ${b.contractAdditions || 'none'}\nConcerns: ${b.concerns || 'none'}`).join('\n\n')}
${okBuilt.length < plan.tasks.length ? `\nThese tasks produced nothing and you must build the missing parts yourself: ${plan.tasks.filter(t => !okBuilt.find(b => b.key === t.key)).map(t => `${t.key}: ${t.brief}`).join('\n')}` : ''}

Your job, editing any file you need:
1. Write src/main.ts: boot the engine (antialias off on high-DPR phones is fine), load the first level, run the sim at a fixed 60 Hz step decoupled from rendering, feed input → game → sim → render/HUD each frame, handle win/lose/retry/next level, pause when hidden, register the service worker in production builds only. Expose window.__horde = { state(): BattleState, fps(): number, level(): string, spawn(n:number): void } for automated testing (spawn adds n player mobs at the cannon).
2. Fix every type error and failing test until "npm test" and "npm run build" both pass.
3. Write scripts/smoke.mjs (run by "npm run smoke"): build is assumed done; start "npx vite preview --port 4173 --strictPort" as a child process, launch Chromium with playwright-core (executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']) in an iPhone-sized portrait viewport (390x844, deviceScaleFactor 3, isMobile, hasTouch). Load http://localhost:4173/horde-run/. Fail on any console error or page error. Simulate a touch drag with fire held using CDP Input.dispatchTouchEvent for ~8 s (sweeping left and right), save smoke-play.png, then call __horde.spawn to push past 1000 player units, sample __horde.fps() and unit counts for a few seconds, save smoke-crowd.png, and print a JSON summary (fps min/avg under swiftshader, peak units, outcome). Exit non-zero on errors. Software rendering is slow, so do not fail on low fps; just report it.
4. Run "npm run build && npm run smoke", look at both screenshots with the Read tool, and fix anything visibly wrong (black screen, lane off-screen in portrait, unreadable gate labels, HUD under the notch area, nothing moving).
Report honestly; if something still fails, say what.`,
  { label: 'integrate', phase: 'Integrate', schema: STATUS_SCHEMA },
)

// ---------- Review (two lenses in parallel) ----------
phase('Review')
const LENSES = [
  {
    key: 'phone',
    prompt: `Lens: PHONE PLAY. Check against docs/concept.md "Touch controls", "Screen, layout and camera" and "Phone performance": relative drag aiming (finger never covers the cannon), hold-to-fire, multi-touch champion button while firing, touch-action/none and no browser gestures, safe areas and 100dvh, portrait framing of the whole lane, button sizes ≥56px/48px, pause on hide, capped pixel ratio and auto scaling, per-frame allocations in hot paths (sim step, renderer buffer writes), draw-call count for the crowd, unit cap behaviour. Use the smoke script (and extra Playwright probes you write in /tmp if needed) for evidence.`,
  },
  {
    key: 'gameplay',
    prompt: `Lens: GAMEPLAY CORRECTNESS AND FEEL. Check: gates apply exactly once per unit and multiply visibly (burst spread, not stacked on one point), moving and trap gates work, units cancel 1:1 by weight on contact, stacked units count correctly in HUD totals, enemy waves arrive as the level says, champion charges and launches, base damage and victory/defeat trigger once, retry fully resets state, the 3 levels ramp in difficulty and a battle lasts roughly 60-120 s, determinism with the same seed. Write quick node tests or scripted runs (headless sim stepping without rendering) for evidence; keep any useful tests in tests/.`,
  },
]
const reviews = await parallel(LENSES.map(l => () =>
  agent(
    `${RULES}
Milestone ${milestone} was just built and integrated. Integration report: ${integrated ? integrated.summary + ' Known issues: ' + (integrated.knownIssues || []).join('; ') : 'integration agent failed'}.
Acceptance criteria: ${plan.acceptance.join(' | ')}

You are a reviewer. Do NOT edit source files under src/ (you may add tests under tests/). ${l.prompt}
Only report problems you verified. "must-fix" means it breaks play on a phone or breaks an acceptance criterion.`,
    { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS_SCHEMA },
  ),
))
const findings = reviews.filter(Boolean).flatMap(r => r.findings)
const toFix = findings.filter(f => f.severity !== 'nice')
const deferred = findings.filter(f => f.severity === 'nice')
log(`Review: ${findings.length} findings, fixing ${toFix.length} (must-fix + should-fix), deferring ${deferred.length} nice-to-haves`)

// ---------- Fix ----------
phase('Fix')
let final = integrated
if (toFix.length) {
  final = await agent(
    `${RULES}
Fix these verified review findings for milestone ${milestone}, must-fix first. For each, apply the fix (or explain in knownIssues why not), keeping changes minimal.
${toFix.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}: ${f.problem}\n   Evidence: ${f.evidence}\n   Suggested fix: ${f.fix}`).join('\n')}

Then run "npm test", "npm run build" and "npm run smoke", look at the screenshots, and report the final state honestly.`,
    { label: 'fix', phase: 'Fix', schema: STATUS_SCHEMA },
  )
}

return { milestone, plan: { summary: plan.summary, acceptance: plan.acceptance, tasks: plan.tasks.map(t => t.key) }, built: okBuilt.map(b => ({ key: b.key, files: b.filesWritten.length, concerns: b.concerns })), integrated, findings, deferred, final }
