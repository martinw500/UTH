/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
// This service worker adds Cross-Origin Isolation headers (COOP/COEP)
// enabling SharedArrayBuffer on environments that can't set headers (e.g. GitHub Pages).
// Source: https://github.com/niceegg/coi-serviceworker

let coepCredentialless = true;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (ev.data && ev.data.type === "deregister") {
            self.registration.unregister().then(() => {
                ev.source.postMessage({ type: "deregistered" });
            });
            return;
        }
        if (!ev.data) return;
        if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, { credentials: "omit" })
            : r;

        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) return response;

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });
} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = reloadedBySelf === "coepdegrade";

        // If the browser already supports cross-origin isolation, skip the service worker
        if (window.crossOriginIsolated) return;

        // If we're on a page served with correct headers (e.g. Vercel), skip
        if (window.crossOriginIsolated !== false) return;

        if (!window.isSecureContext) {
            console.log("COOP/COEP Service Worker: Not a secure context, cannot register");
            return;
        }

        // Register the service worker from the current scope.
        //
        // Resolve against location.href, NOT import.meta.url. A service worker
        // registered without { type: "module" } is a classic script, and
        // `import.meta` is a *parse-time* syntax error there — so its mere
        // presence anywhere in this file, even on a branch that never runs in
        // the worker, made the whole script fail to evaluate. Registration then
        // failed with "ServiceWorker script evaluation failed" and
        // SharedArrayBuffer stayed disabled everywhere the headers are not set
        // server-side, which is GitHub Pages and local dev.
        const n = navigator;
        if (n.serviceWorker) {
            n.serviceWorker.register(new URL("coi-serviceworker.js", window.location.href).href).then(
                (registration) => {
                    if (registration.active && !n.serviceWorker.controller) {
                        window.sessionStorage.setItem("coiReloadedBySelf", coepDegrading ? "coepdegrade" : "");
                        window.location.reload();
                    } else if (registration.installing) {
                        registration.installing.addEventListener("statechange", function () {
                            if (this.state === "activated") {
                                window.sessionStorage.setItem("coiReloadedBySelf", coepDegrading ? "coepdegrade" : "");
                                window.location.reload();
                            }
                        });
                    }
                },
                (err) => {
                    console.error("COOP/COEP Service Worker registration failed:", err);
                }
            );
        }
    })();
}
