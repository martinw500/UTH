// The editor's batch model and undo history.
//
// No DOM, no canvas: this is the part of the editor that can be tested in
// jsdom, so as much decision-making as possible lives here rather than in the
// page controller.

import { cloneState, createState } from '../../js/shared/pipeline.js';
import { sanitiseFilename } from '../../js/shared/format.js';

/** How many undo steps to keep. States are small, but not free. */
export const UNDO_LIMIT = 30;

/**
 * The queue of loaded images.
 *
 * Edits are global -- one state applies to every image -- which is what makes
 * batch work at all. That only holds because the crop rect is normalised, so
 * "crop to the middle third" means the same thing on a 4000px and an 800px
 * image. See js/shared/geometry.js.
 */
export function createBatch() {
    const items = [];
    let nextId = 1;
    let selectedId = null;

    function add(files) {
        const added = [];
        for (const file of files) {
            const item = {
                id: nextId++,
                file,
                name: file.name,
                size: file.size,
                width: 0,
                height: 0,
                source: null,      // decoded ImageBitmap/HTMLImageElement
                exif: null,
                status: 'pending', // pending | ready | done | error
                error: null,
                result: null,      // {blob, filename}
            };
            items.push(item);
            added.push(item);
        }
        if (selectedId === null && items.length) selectedId = items[0].id;
        return added;
    }

    function remove(id) {
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) return null;
        const [removed] = items.splice(index, 1);
        if (selectedId === id) {
            // Prefer the item that took its place, then the one before it.
            selectedId = items[index]?.id ?? items[index - 1]?.id ?? null;
        }
        return removed;
    }

    return {
        add,
        remove,
        get(id) {
            return items.find((item) => item.id === id) ?? null;
        },
        list() {
            return [...items];
        },
        select(id) {
            if (items.some((item) => item.id === id)) selectedId = id;
            return selectedId;
        },
        selected() {
            return items.find((item) => item.id === selectedId) ?? null;
        },
        get selectedId() {
            return selectedId;
        },
        get size() {
            return items.length;
        },
        clear() {
            items.length = 0;
            selectedId = null;
        },
    };
}

/**
 * Undo history over edit states.
 *
 * Snapshots the state *before* a change, so `undo()` returns what things looked
 * like beforehand. Cloning matters: without it later mutations would rewrite
 * history in place and undo would restore the state you were already in.
 */
export function createHistory(initial = createState()) {
    let present = cloneState(initial);
    const past = [];

    return {
        /** Call before mutating, with the state as it currently is. */
        push(state) {
            past.push(cloneState(present));
            if (past.length > UNDO_LIMIT) past.shift();
            present = cloneState(state);
        },
        /** Record a new present without adding an undo step. */
        replace(state) {
            present = cloneState(state);
        },
        undo() {
            if (!past.length) return null;
            present = past.pop();
            return cloneState(present);
        },
        current() {
            return cloneState(present);
        },
        reset(state) {
            past.length = 0;
            present = cloneState(state);
        },
        get canUndo() {
            return past.length > 0;
        },
        get depth() {
            return past.length;
        },
    };
}

/**
 * Turn a resize form into a concrete pixel size.
 *
 * `unit` is 'px' or 'percent'; percentages are relative to the *current* output
 * size, and the aspect lock fills in whichever field the user did not type in.
 */
export function resolveResize({
    unit, width, height, lockAspect, currentWidth, currentHeight, lastEdited = 'width',
}) {
    const w = Number(width);
    const h = Number(height);

    if (unit === 'percent') {
        const percent = Number.isFinite(w) && w > 0 ? w : 100;
        return {
            width: Math.max(1, Math.round(currentWidth * percent / 100)),
            height: Math.max(1, Math.round(currentHeight * percent / 100)),
        };
    }

    const hasW = Number.isFinite(w) && w > 0;
    const hasH = Number.isFinite(h) && h > 0;
    if (!hasW && !hasH) return null;

    if (lockAspect) {
        const ratio = currentHeight / currentWidth;
        if (lastEdited === 'height' && hasH) {
            return { width: Math.max(1, Math.round(h / ratio)), height: Math.max(1, Math.round(h)) };
        }
        if (hasW) {
            return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(w * ratio)) };
        }
        return { width: Math.max(1, Math.round(h / ratio)), height: Math.max(1, Math.round(h)) };
    }

    return {
        width: Math.max(1, Math.round(hasW ? w : currentWidth)),
        height: Math.max(1, Math.round(hasH ? h : currentHeight)),
    };
}

/**
 * Output filename for an item, given the target extension.
 *
 * The name comes from a dropped file, so it is untrusted. Reducing to the base
 * name first means a path can never survive into the download attribute --
 * relying on the caller to sanitise would work only until someone reuses this.
 */
export function outputFilename(name, extension, { suffix = '' } = {}) {
    const leaf = String(name).split(/[/\\]/).pop() ?? '';
    const stem = leaf.replace(/\.[^.]+$/, '');
    const base = sanitiseFilename(stem, 'image') || 'image';
    return `${base}${suffix}.${extension}`;
}

/**
 * Is this image big enough that re-encoding it on every slider tick would jank?
 *
 * The live size estimate re-encodes on a debounce; past roughly 24 megapixels a
 * single encode is slow enough to be felt, so the estimate becomes manual.
 */
export const AUTO_ESTIMATE_PIXEL_LIMIT = 24_000_000;

export function shouldAutoEstimate(width, height, limit = AUTO_ESTIMATE_PIXEL_LIMIT) {
    return width * height <= limit;
}
