# Horde Run

Phone-first crowd shooter (Babylon.js 9, TypeScript 5.9, Vite 8). Design: `docs/concept.md`.

## Closing the loop

- `npm run check`: typecheck, oxlint (type-aware), oxfmt check and unit tests (about a minute). Run it before every commit.
- `npm run verify`: `check` plus the production build and `npm run smoke` (headless 390x844 touch run of the real game; writes `smoke-*.png` screenshots you can open to see what the game looks like). Run it before opening or updating a PR.
- `node scripts/render-audio.mjs <outdir>` renders the music loops and every sound effect to WAV with the real `src/audio` code (headless Chromium), for listening and loudness checks (`ffmpeg -af ebur128`).
- `npm run lint:fix` and `npm run format` fix what they can. Never silence a rule inline to get green without saying why in a comment.
- CI (`.github/workflows/ci.yml`) runs `checks` and `smoke` on every PR; smoke runs its four scenarios (`SMOKE=campaign|boss|expedition|meta`) as parallel jobs and uploads their screenshots as `smoke-screenshots-<scenario>` artifacts. Locally, `SMOKE=boss npm run smoke` runs one scenario.

Claude Code hooks in `.claude/settings.json` run oxfmt and oxlint on each file you edit and report lint errors back to you, and install dependencies at session start when `node_modules` is missing.

## Conventions

- Tests use `node --experimental-strip-types --test`, so TypeScript must be erasable: no enums, no namespaces, no parameter properties (`erasableSyntaxOnly`). Use `import type` for type-only imports.
- Shared types live in `src/contracts.ts`.
- No screen shake, ever.
