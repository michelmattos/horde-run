// Loading screen: the #loading cover in index.html. It is up from the first paint, so
// the page never shows half-built screens (unstyled menus before the font arrives, a
// battlefield whose shaders and textures are still on their way under a live HUD).
// Boot hides it once the first screen is ready; every battle load covers the screen
// again until its scene is ready. A load that never settles still lifts the cover after
// LOADING_TIMEOUT_MS, so a slow texture can never trap the player behind it.

export const LOADING_TIMEOUT_MS = 10_000;
const FADE_MS = 250;

export interface LoadingScreen {
  show(): void; // cover the screen now (no fade in: nothing half-built may show)
  // Fade the cover out once `ready` settles (or after timeoutMs) and two frames have
  // been painted; resolves when it is gone. A show() in the meantime cancels it.
  hideWhen(ready: Promise<unknown>, timeoutMs?: number): Promise<void>;
  whenHidden(): Promise<void>; // resolves once the cover is gone (at once when it is)
  readonly visible: boolean;
}

// `ready`, but never later than timeoutMs, and never rejecting.
export function settle(ready: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    const done = (): void => {
      clearTimeout(t);
      resolve();
    };
    ready.then(done, done);
  });
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export function createLoadingScreen(): LoadingScreen {
  const el = document.getElementById('loading');
  let up = !!el && !el.hidden;
  let token = 0; // bumped by every show(): a pending hide from an older load stands down
  let fadeTimer = 0;
  let waiters: (() => void)[] = [];
  const gone = (): void => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };

  return {
    show() {
      token++;
      up = true;
      clearTimeout(fadeTimer);
      if (!el) return;
      el.hidden = false;
      el.classList.remove('out');
    },
    async hideWhen(ready, timeoutMs = LOADING_TIMEOUT_MS) {
      const mine = token;
      await settle(ready, timeoutMs);
      // Two painted frames: the screen under the cover has drawn at least once.
      await frame();
      await frame();
      if (mine !== token || !up) return;
      up = false;
      if (!el) return gone();
      el.classList.add('out');
      await new Promise<void>((r) => {
        fadeTimer = window.setTimeout(() => {
          el.hidden = true;
          r();
        }, FADE_MS);
      });
      gone();
    },
    whenHidden() {
      return up ? new Promise((r) => waiters.push(r)) : Promise.resolve();
    },
    get visible() {
      return up;
    },
  };
}
