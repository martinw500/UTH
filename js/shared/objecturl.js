// Object URL lifetime management.
//
// A blob URL pins its blob in memory until revoked. The editor used to revoke
// the previous URL only at the *start* of the next successful export, so the
// last export always leaked, and the failure path returned without revoking at
// all -- exporting a large image, failing, and retrying leaked every attempt.
//
// A slot owns exactly one live URL and can always be revoked from a `finally`.

/**
 * A single-URL slot.
 *
 * `set` revokes whatever was there before, so a slot can never hold two URLs.
 */
export function createUrlSlot() {
    let current = null;

    return {
        set(blob) {
            if (current) URL.revokeObjectURL(current);
            current = URL.createObjectURL(blob);
            return current;
        },
        get() {
            return current;
        },
        revoke() {
            if (!current) return;
            URL.revokeObjectURL(current);
            current = null;
        },
    };
}

/**
 * A keyed pool of slots, for batches where each item has its own result.
 *
 * `revokeAll` exists so clearing the batch cannot leave URLs behind, which is
 * the batch-sized version of the same leak.
 */
export function createUrlPool() {
    const slots = new Map();

    return {
        set(key, blob) {
            if (!slots.has(key)) slots.set(key, createUrlSlot());
            return slots.get(key).set(blob);
        },
        get(key) {
            return slots.get(key)?.get() ?? null;
        },
        revoke(key) {
            slots.get(key)?.revoke();
            slots.delete(key);
        },
        revokeAll() {
            for (const slot of slots.values()) slot.revoke();
            slots.clear();
        },
        get size() {
            return slots.size;
        },
    };
}
