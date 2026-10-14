// Registers the offline service worker (public/sw.js) in production builds only,
// so dev server reloads are never served stale from cache.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const register = (): void => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Offline support is best-effort.
    });
  };
  // Register after load so it doesn't compete with the first frames.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
