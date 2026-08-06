// Where the browser should send API requests.
//
// The frontend is served from three places -- GitHub Pages, Vercel production,
// and Vercel preview deployments -- but only Vercel runs the Python functions.

const PRODUCTION_BACKEND = 'https://useful-tool-hub.vercel.app';
const LOCAL_BACKEND = 'http://localhost:5000';

/**
 * Pure so it can be unit-tested; the browser calls it with location.hostname.
 *
 * A preview deployment carries its own copy of the API, so it must talk to
 * itself rather than to production -- otherwise a preview can never exercise
 * backend changes, which is the whole point of having previews.
 */
export function resolveBackendUrl(hostname, protocol = 'https:') {
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return LOCAL_BACKEND;
    }
    // Vercel (production or preview) serves the API from its own origin.
    if (hostname.endsWith('.vercel.app')) {
        return `${protocol}//${hostname}`;
    }
    // GitHub Pages is static only, so it has to borrow production's API.
    return PRODUCTION_BACKEND;
}

export const API_CONFIG = {
    BACKEND_URL: typeof window !== 'undefined' && window.location
        ? resolveBackendUrl(window.location.hostname, window.location.protocol)
        : PRODUCTION_BACKEND,
};

/** Build an API URL with encoded query parameters. */
export function apiUrl(path, params) {
    const base = `${API_CONFIG.BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
    if (!params) return base;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            search.set(key, String(value));
        }
    }
    const query = search.toString();
    return query ? `${base}?${query}` : base;
}
