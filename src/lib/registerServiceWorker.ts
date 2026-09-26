/**
 * Single, guarded registrar for the app-shell service worker.
 *
 * The stale-bundle incident (clients running months-old JS that wrote NULL
 * resolution_method) came from a service worker serving cached HTML/JS.
 * Rules enforced here:
 *   - never register in dev, in an iframe, or in any Lovable preview host
 *   - unregister any matching worker found in those contexts
 *   - `?sw=off` is a kill switch that unregisters and clears app caches
 *   - production registrations auto-update and take over immediately
 */

const SW_URL = "/sw.js";

const isPreviewHost = (host: string) =>
  host.startsWith("id-preview--") ||
  host.startsWith("preview--") ||
  host === "lovableproject.com" ||
  host.endsWith(".lovableproject.com") ||
  host === "lovableproject-dev.com" ||
  host.endsWith(".lovableproject-dev.com") ||
  host === "beta.lovable.dev" ||
  host.endsWith(".beta.lovable.dev");

async function unregisterAppWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations
      .filter((r) => {
        const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
        return url.endsWith(SW_URL);
      })
      .map((r) => r.unregister()),
  );
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const host = window.location.hostname;
  const inIframe = window.self !== window.top;
  const killSwitch = new URLSearchParams(window.location.search).has("sw")
    ? new URLSearchParams(window.location.search).get("sw") === "off"
    : false;

  if (!import.meta.env.PROD || inIframe || isPreviewHost(host) || killSwitch) {
    await unregisterAppWorkers();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    // Check for a newer bundle on every load and on focus, so a fixed build
    // cannot sit behind a stale cached worker.
    registration.update().catch(() => undefined);
    window.addEventListener("focus", () => registration.update().catch(() => undefined));

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } catch {
    // Registration failures must never break the app.
  }
}
