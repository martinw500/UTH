import {
    UNDO_LIMIT,
    AUTO_ESTIMATE_PIXEL_LIMIT,
    createBatch,
    createHistory,
    resolveResize,
    outputFilename,
    shouldAutoEstimate,
} from '../image-converter/js/editor-state.js';

import { createState } from '../js/shared/pipeline.js';

const fakeFile = (name, size = 1000) => ({ name, size });

describe('batch', () => {
    test('starts empty', () => {
        const batch = createBatch();
        expect(batch.size).toBe(0);
        expect(batch.selected()).toBeNull();
    });

    test('adding files selects the first one', () => {
        const batch = createBatch();
        batch.add([fakeFile('a.png'), fakeFile('b.png')]);
        expect(batch.size).toBe(2);
        expect(batch.selected().name).toBe('a.png');
    });

    test('ids are unique even after removals', () => {
        const batch = createBatch();
        const [first] = batch.add([fakeFile('a.png')]);
        batch.remove(first.id);
        const [second] = batch.add([fakeFile('b.png')]);
        expect(second.id).not.toBe(first.id);
    });

    test('selection follows an explicit choice', () => {
        const batch = createBatch();
        const items = batch.add([fakeFile('a.png'), fakeFile('b.png')]);
        batch.select(items[1].id);
        expect(batch.selected().name).toBe('b.png');
    });

    test('selecting an unknown id is ignored rather than blanking the preview', () => {
        const batch = createBatch();
        batch.add([fakeFile('a.png')]);
        batch.select(9999);
        expect(batch.selected().name).toBe('a.png');
    });

    // Removing the previewed image must leave something previewed, or the
    // canvas goes blank while the queue still has images in it.
    test('removing the selected item selects its neighbour', () => {
        const batch = createBatch();
        const items = batch.add([fakeFile('a.png'), fakeFile('b.png'), fakeFile('c.png')]);
        batch.select(items[1].id);
        batch.remove(items[1].id);
        expect(batch.selected().name).toBe('c.png');
    });

    test('removing the last item falls back to the one before it', () => {
        const batch = createBatch();
        const items = batch.add([fakeFile('a.png'), fakeFile('b.png')]);
        batch.select(items[1].id);
        batch.remove(items[1].id);
        expect(batch.selected().name).toBe('a.png');
    });

    test('removing everything leaves nothing selected', () => {
        const batch = createBatch();
        const [item] = batch.add([fakeFile('a.png')]);
        batch.remove(item.id);
        expect(batch.size).toBe(0);
        expect(batch.selected()).toBeNull();
    });

    test('removing an unknown id is harmless', () => {
        const batch = createBatch();
        batch.add([fakeFile('a.png')]);
        expect(batch.remove(9999)).toBeNull();
        expect(batch.size).toBe(1);
    });

    test('list returns a copy, so callers cannot mutate the queue', () => {
        const batch = createBatch();
        batch.add([fakeFile('a.png')]);
        batch.list().push(fakeFile('sneaky.png'));
        expect(batch.size).toBe(1);
    });

    test('clear empties everything', () => {
        const batch = createBatch();
        batch.add([fakeFile('a.png'), fakeFile('b.png')]);
        batch.clear();
        expect(batch.size).toBe(0);
        expect(batch.selected()).toBeNull();
    });
});

describe('history', () => {
    test('a fresh history has nothing to undo', () => {
        expect(createHistory().canUndo).toBe(false);
        expect(createHistory().undo()).toBeNull();
    });

    test('undo returns the state as it was before the change', () => {
        const history = createHistory(createState());
        const changed = createState();
        changed.rotate = 90;
        history.push(changed);

        expect(history.canUndo).toBe(true);
        expect(history.undo().rotate).toBe(0);
    });

    // Without cloning, a later mutation rewrites history in place and undo
    // restores the state you are already in.
    test('history is not aliased to the live state', () => {
        const live = createState();
        const history = createHistory(live);
        history.push(live);
        live.rotate = 180;
        expect(history.undo().rotate).toBe(0);
    });

    test('current() hands out a copy', () => {
        const history = createHistory(createState());
        const snapshot = history.current();
        snapshot.rotate = 270;
        expect(history.current().rotate).toBe(0);
    });

    test('replace updates the present without adding an undo step', () => {
        const history = createHistory(createState());
        const changed = createState();
        changed.rotate = 90;
        history.replace(changed);
        expect(history.canUndo).toBe(false);
    });

    test('the stack is capped', () => {
        const history = createHistory(createState());
        for (let i = 0; i < UNDO_LIMIT + 15; i += 1) {
            const next = createState();
            next.rotate = (i % 4) * 90;
            history.push(next);
        }
        expect(history.depth).toBe(UNDO_LIMIT);
    });

    test('reset clears the stack', () => {
        const history = createHistory(createState());
        history.push(createState());
        history.reset(createState());
        expect(history.canUndo).toBe(false);
    });
});

describe('resolveResize', () => {
    const base = { currentWidth: 1920, currentHeight: 1080 };

    test('a percentage scales both axes together', () => {
        expect(resolveResize({ ...base, unit: 'percent', width: '50' }))
            .toEqual({ width: 960, height: 540 });
    });

    test('an empty percentage means no change rather than zero', () => {
        expect(resolveResize({ ...base, unit: 'percent', width: '' }))
            .toEqual({ width: 1920, height: 1080 });
    });

    test('with the lock on, width drives height', () => {
        expect(resolveResize({ ...base, unit: 'px', width: '960', lockAspect: true }))
            .toEqual({ width: 960, height: 540 });
    });

    test('with the lock on, height drives width when height was the field edited', () => {
        expect(resolveResize({
            ...base, unit: 'px', height: '540', lockAspect: true, lastEdited: 'height',
        })).toEqual({ width: 960, height: 540 });
    });

    test('with the lock off, both are taken literally', () => {
        expect(resolveResize({ ...base, unit: 'px', width: '100', height: '900', lockAspect: false }))
            .toEqual({ width: 100, height: 900 });
    });

    test('with the lock off, a blank field keeps the current dimension', () => {
        expect(resolveResize({ ...base, unit: 'px', width: '100', height: '', lockAspect: false }))
            .toEqual({ width: 100, height: 1080 });
    });

    test('two blank fields mean no resize at all', () => {
        expect(resolveResize({ ...base, unit: 'px', width: '', height: '' })).toBeNull();
    });

    test('never resolves to a zero dimension', () => {
        const result = resolveResize({ ...base, unit: 'percent', width: '0.001' });
        expect(result.width).toBeGreaterThanOrEqual(1);
        expect(result.height).toBeGreaterThanOrEqual(1);
    });

    test('rejects negative and non-numeric input', () => {
        expect(resolveResize({ ...base, unit: 'px', width: '-5', height: 'abc' })).toBeNull();
    });
});

describe('outputFilename', () => {
    test('swaps the extension', () => {
        expect(outputFilename('photo.jpg', 'webp')).toBe('photo.webp');
    });

    test('only the last extension is replaced', () => {
        expect(outputFilename('holiday.2024.png', 'jpg')).toBe('holiday.2024.jpg');
    });

    test('a file with no extension just gains one', () => {
        expect(outputFilename('scan', 'png')).toBe('scan.png');
    });

    test('a dotfile does not become an empty name', () => {
        expect(outputFilename('.gitignore', 'png')).toBe('image.png');
    });

    test('a suffix can be added for batch output', () => {
        expect(outputFilename('a.png', 'jpg', { suffix: '-1' })).toBe('a-1.jpg');
    });

    // A name from a dropped file is untrusted input.
    test('path separators in the name do not survive', () => {
        expect(outputFilename('../../etc/passwd.png', 'jpg')).not.toContain('..');
    });
});

describe('shouldAutoEstimate', () => {
    // The estimate re-encodes on a debounce; on a very large image a single
    // encode is slow enough to stutter the slider, so it becomes manual.
    test('an ordinary photo estimates automatically', () => {
        expect(shouldAutoEstimate(4000, 3000)).toBe(true);
    });

    test('an enormous image does not', () => {
        expect(shouldAutoEstimate(10000, 10000)).toBe(false);
    });

    test('the boundary is inclusive', () => {
        expect(shouldAutoEstimate(AUTO_ESTIMATE_PIXEL_LIMIT, 1)).toBe(true);
        expect(shouldAutoEstimate(AUTO_ESTIMATE_PIXEL_LIMIT + 1, 1)).toBe(false);
    });
});
