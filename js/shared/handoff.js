/**
 * Pass one file from one tool page to another.
 *
 * The YouTube downloader fetches an audio track and wants to open it in the
 * audio converter with a single click. A navigation throws away every JS value,
 * so the bytes have to be parked somewhere both pages can see.
 *
 * IndexedDB, not sessionStorage: sessionStorage holds strings, so a file would
 * have to be base64'd (a third bigger) into a ~5 MB quota, and would blow up on
 * anything longer than a short song. IndexedDB stores the Blob itself, is
 * same-origin like sessionStorage, and survives the navigation.
 *
 * Entries are one-shot -- `takeHandoff` deletes what it reads -- so a reload of
 * the destination page does not silently re-import a file the user already
 * dealt with. Stale entries are swept on open, because a hand-off whose
 * destination was never reached would otherwise sit in storage forever.
 */

const DB_NAME = 'uth-handoff';
const STORE = 'files';
const DB_VERSION = 1;

/** Anything older than this was abandoned; nothing legitimate takes minutes. */
const MAX_AGE_MS = 10 * 60 * 1000;

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is unavailable'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open IndexedDB'));
        // Private-browsing modes can leave the request hanging rather than
        // erroring, so don't let a caller wait on it forever.
        request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
}

function runTransaction(db, mode, work) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let request;
        try {
            request = work(store);
        } catch (err) {
            reject(err);
            return;
        }
        // Resolve on `complete`, not on the request's own success: the write is
        // not durable until the transaction commits, and reading `.result`
        // before then can hand back a record the browser then rolls back.
        //
        // The unwrap is `request.result`, not `request.value` -- IDBRequest has
        // no `value`, so getting that wrong silently returns the request object
        // itself and every read looks like it found something.
        tx.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : request);
        tx.onerror = () => reject(tx.error || new Error('Hand-off transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Hand-off transaction aborted'));
    });
}

function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function sweep(db) {
    const cutoff = Date.now() - MAX_AGE_MS;
    await runTransaction(db, 'readwrite', (store) => {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            if (!cursor.value || cursor.value.storedAt < cutoff) cursor.delete();
            cursor.continue();
        };
    });
}

/**
 * Park `file` and return the id to pass in the destination page's URL.
 * Throws if storage is unavailable, so callers can fall back to a plain
 * download rather than navigating to a page that will find nothing.
 */
export async function putHandoff(file, meta = {}) {
    const db = await openDb();
    try {
        await sweep(db).catch(() => {});
        const id = newId();
        await runTransaction(db, 'readwrite', (store) => {
            store.put({
                id,
                blob: file,
                name: file && file.name ? file.name : 'file',
                type: (file && file.type) || 'application/octet-stream',
                meta,
                storedAt: Date.now(),
            });
        });
        return id;
    } finally {
        db.close();
    }
}

/**
 * Read and remove the hand-off with this id.
 * Returns `{ file, meta }`, or `null` if there is nothing under that id.
 */
export async function takeHandoff(id) {
    if (!id) return null;
    let db;
    try {
        db = await openDb();
    } catch {
        return null;
    }
    try {
        const record = await runTransaction(db, 'readonly', (store) => store.get(id));
        if (!record || !record.blob) return null;

        // Delete before returning: a refresh of the destination page must not
        // re-import a file the user has already been given.
        await runTransaction(db, 'readwrite', (store) => { store.delete(id); }).catch(() => {});

        const file = record.blob instanceof File
            ? record.blob
            : new File([record.blob], record.name, { type: record.type });
        return { file, meta: record.meta || {} };
    } catch {
        return null;
    } finally {
        db.close();
    }
}
