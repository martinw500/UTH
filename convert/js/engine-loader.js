// Lazily load a conversion engine.
//
// Native dynamic import(), so there is still no bundler and no build step. The
// point is that the ffmpeg engine -- the expensive one -- is only fetched when
// a video or audio job actually runs; converting a PNG to WebP downloads none
// of it.

/**
 * The engines that exist, as a frozen list.
 *
 * A typo in a registry row then fails here, synchronously and by name, instead
 * of becoming a 404 the first time a user clicks Convert on that format.
 */
export const ENGINE_NAMES = Object.freeze(['image', 'media']);

const cache = new Map();

export function isKnownEngine(name) {
    return ENGINE_NAMES.includes(name);
}

export function getEngine(name) {
    if (!isKnownEngine(name)) {
        return Promise.reject(new Error(`Unknown conversion engine: ${name}`));
    }
    if (!cache.has(name)) {
        // Cache the promise, not the resolved module, so two conversions
        // started at once import it once.
        cache.set(name, import(`./engines/${name}.js`));
    }
    return cache.get(name);
}

/** Test seam. */
export function resetEngines() {
    cache.clear();
}
