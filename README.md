# Horde Run

A personal, single-player, phone-first crowd shooter in the spirit of Mob Control, built with Babylon.js, TypeScript and Vite. No ads, no multiplayer.

The design lives in [docs/concept.md](docs/concept.md).

- Play: https://michelmattos.github.io/horde-run/ (deployed from `main` by GitHub Actions)
- Develop: `npm install`, then `npm run dev` and open the printed network URL on your phone (same Wi-Fi)
- Check: `npm run check` (typecheck, lint, format, unit tests) and `npm run verify` (adds the build and `npm run smoke`, a headless phone-sized run with screenshots). CI runs both on every pull request.

## Building with the workflow

`.claude/workflows/build-milestone.js` is a Claude Code workflow that builds one milestone of the concept doc's build plan with parallel agents (one per module), integrates, smoke-tests in a headless phone viewport, reviews and fixes. Run it from Claude Code with the milestone number as its argument.

## Credits

The toy soldier figures (`public/models/army-men.glb`) are built from "Low Poly Soldier with weapons" by Casti_131 (CC0, [OpenGameArt](https://opengameart.org/content/low-poly-soldier-with-weapons)); details in [public/models/CREDITS.md](public/models/CREDITS.md).
