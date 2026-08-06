// localStorage that cannot throw.
//
// Access throws outright in Safari private mode and when a page is opened over
// file://, and setItem throws on quota exhaustion. Every call site here used to
// need its own try/catch.

function backing() {
    try {
        const store = window.localStorage;
        const probe = '__uth_probe__';
        store.setItem(probe, '1');
        store.removeItem(probe);
        return store;
    } catch {
        return null;
    }
}

let store;
function getStore() {
    if (store === undefined) store = backing();
    return store;
}

export const isAvailable = () => getStore() !== null;

/** Read and JSON-parse a key. Returns `fallback` if absent or corrupt. */
export function getJSON(key, fallback = null) {
    const s = getStore();
    if (!s) return fallback;
    try {
        const raw = s.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/** JSON-serialise and write a key. Returns false if it could not be stored. */
export function setJSON(key, value) {
    const s = getStore();
    if (!s) return false;
    try {
        s.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

export function remove(key) {
    const s = getStore();
    if (!s) return;
    try { s.removeItem(key); } catch { /* nothing useful to do */ }
}

/** Read a plain string, no JSON parsing. */
export function getString(key, fallback = null) {
    const s = getStore();
    if (!s) return fallback;
    try {
        const raw = s.getItem(key);
        return raw === null ? fallback : raw;
    } catch {
        return fallback;
    }
}

export function setString(key, value) {
    const s = getStore();
    if (!s) return false;
    try { s.setItem(key, value); return true; } catch { return false; }
}

// Test seam: forget the cached availability probe.
export function _reset() { store = undefined; }
