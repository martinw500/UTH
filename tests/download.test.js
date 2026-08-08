// js/shared/download.js
//
// The document is faked rather than driven through jsdom, because jsdom treats
// a click on an anchor with an href as a navigation it has not implemented and
// reports it on the virtual console. A fake also lets the ORDER of append and
// click be asserted, which is the half of this that Firefox actually cares
// about. Real downloads are covered by scripts/verify-*.mjs in a real browser.

import {
    REVOKE_AFTER_MS,
    attachDownload,
    saveAllAsZip,
    saveBlob,
    saveRemote,
    saveUrl,
} from '../js/shared/download.js';
import { createUrlSlot } from '../js/shared/objecturl.js';

/** A document that records what was done to it, in order. */
function fakeDoc() {
    const log = [];
    const created = [];

    const doc = {
        log,
        created,
        body: {
            appendChild(node) {
                log.push(`append:${node.id}`);
                node.attached = true;
            },
        },
        createElement() {
            const node = {
                id: created.length,
                style: {},
                attached: false,
                removed: false,
                clicked: 0,
                click() { log.push(`click:${this.id}`); this.clicked += 1; },
                remove() { log.push(`remove:${this.id}`); this.removed = true; },
            };
            created.push(node);
            return node;
        },
    };
    return doc;
}

let revoked;
let createdUrls;

beforeEach(() => {
    jest.useFakeTimers();
    revoked = [];
    createdUrls = [];
    global.URL.createObjectURL = jest.fn(() => {
        const url = `blob:fake/${createdUrls.length}`;
        createdUrls.push(url);
        return url;
    });
    global.URL.revokeObjectURL = jest.fn((url) => revoked.push(url));
});

afterEach(() => {
    jest.useRealTimers();
});

describe('saveBlob', () => {
    // Firefox ignores click() on an anchor that is not in the document.
    // convert/js/main.js and the image editor both skipped the append and
    // appeared to work, because Chrome tolerates it.
    test('appends the anchor to the document before clicking it', () => {
        const doc = fakeDoc();
        saveBlob(new Blob(['x']), 'a.png', { doc });

        expect(doc.log).toEqual(['append:0', 'click:0']);
        expect(doc.created[0].clicked).toBe(1);
    });

    test('removes the anchor once the click has landed', () => {
        const doc = fakeDoc();
        saveBlob(new Blob(['x']), 'a.png', { doc });

        expect(doc.created[0].removed).toBe(false);
        jest.advanceTimersByTime(REVOKE_AFTER_MS);
        expect(doc.created[0].removed).toBe(true);
    });

    // click() returns when the event dispatches, not when the browser has
    // finished reading the blob. convert/ and the image editor revoked on the
    // next tick, which races that read and fails the download for a big file.
    test('keeps the object URL alive well past the click, then revokes it', () => {
        const doc = fakeDoc();
        saveBlob(new Blob(['x']), 'a.png', { doc });

        jest.advanceTimersByTime(1);
        expect(revoked).toEqual([]);

        jest.advanceTimersByTime(REVOKE_AFTER_MS);
        expect(revoked).toEqual([createdUrls[0]]);
    });

    test('a second is a whole second, not a token delay', () => {
        expect(REVOKE_AFTER_MS).toBeGreaterThanOrEqual(1000);
    });

    test('points the anchor at the URL it created', () => {
        const doc = fakeDoc();
        saveBlob(new Blob(['x']), 'a.png', { doc });
        expect(doc.created[0].href).toBe(createdUrls[0]);
    });

    // youtube-downloader carried its own regex that missed control characters
    // and leading dots. There is one sanitiser and everything goes through it.
    test('sanitises the filename', () => {
        const doc = fakeDoc();
        saveBlob(new Blob(['x']), 'my/clip: "final".mp4', { doc });
        expect(doc.created[0].download).toBe('my-clip- -final-.mp4');
    });

    test('reports failure instead of throwing when there is nothing to save', () => {
        expect(saveBlob(null, 'a.png', { doc: fakeDoc() })).toBe(false);
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });
});

describe('saveUrl', () => {
    // The slot revokes on the next set() and on revokeAll(). Revoking here too
    // would release a URL still wired to a visible preview.
    test('never revokes -- the slot that made the URL owns it', () => {
        const doc = fakeDoc();
        const slot = createUrlSlot();
        const url = slot.set(new Blob(['x']));

        saveUrl(url, 'a.png', { doc });
        jest.advanceTimersByTime(REVOKE_AFTER_MS * 5);

        expect(revoked).toEqual([]);
        expect(doc.created[0].href).toBe(url);
    });

    test('still appends, clicks and removes', () => {
        const doc = fakeDoc();
        saveUrl('blob:held', 'a.png', { doc });
        expect(doc.log).toEqual(['append:0', 'click:0']);
        jest.advanceTimersByTime(REVOKE_AFTER_MS);
        expect(doc.created[0].removed).toBe(true);
    });
});

describe('saveRemote', () => {
    // Cross-origin responses ignore `download`. Setting it anyway would tell a
    // reader of the call site that the filename is honoured, which it is not --
    // that is why this is a separate function from saveBlob.
    test('sets no download attribute when the server names the file', () => {
        const doc = fakeDoc();
        saveRemote('https://api.example.com/download?x=1', { doc });
        expect(doc.created[0].download).toBeUndefined();
    });

    test('sets download when a filename is given, for the same-origin case', () => {
        const doc = fakeDoc();
        saveRemote('/api/x', { filename: 'clip.mp4', doc });
        expect(doc.created[0].download).toBe('clip.mp4');
    });

    // The last-resort path when a media URL cannot be fetched. rel=noopener is
    // not optional: target=_blank without it hands the opener to a third party.
    test('opens in a new tab with rel=noopener when asked', () => {
        const doc = fakeDoc();
        saveRemote('https://cdn.example.com/x.jpg', { newTab: true, doc });
        expect(doc.created[0].target).toBe('_blank');
        expect(doc.created[0].rel).toBe('noopener');
    });

    test('creates no object URL -- there is no blob', () => {
        saveRemote('https://api.example.com/x', { doc: fakeDoc() });
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });
});

describe('attachDownload', () => {
    test('takes its URL from the slot rather than creating one of its own', () => {
        const anchor = {};
        const slot = createUrlSlot();
        const url = attachDownload(anchor, new Blob(['x']), 'out.webp', slot);

        expect(anchor.href).toBe(url);
        expect(anchor.download).toBe('out.webp');
        expect(slot.get()).toBe(url);
    });

    test('re-attaching revokes the previous URL, because the slot still owns it', () => {
        const anchor = {};
        const slot = createUrlSlot();
        const first = attachDownload(anchor, new Blob(['a']), 'a.webp', slot);
        attachDownload(anchor, new Blob(['b']), 'b.webp', slot);

        expect(revoked).toEqual([first]);
        expect(anchor.download).toBe('b.webp');
    });

    test('addresses a pool by key', () => {
        const anchor = {};
        const pool = { set: jest.fn((key, blob) => `blob:${key}`) };
        attachDownload(anchor, new Blob(['x']), 'out.webp', pool, 'item-7');

        expect(pool.set).toHaveBeenCalledWith('item-7', expect.anything());
        expect(anchor.href).toBe('blob:item-7');
    });
});

describe('saveAllAsZip', () => {
    test('refuses an empty batch instead of saving an empty archive', async () => {
        await expect(saveAllAsZip([], 'out.zip', { doc: fakeDoc() })).resolves.toBe(false);
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    test('saves one archive for the whole batch', async () => {
        const doc = fakeDoc();
        const ok = await saveAllAsZip(
            [{ name: 'a.txt', data: new Blob(['a']) }, { name: 'b.txt', data: new Blob(['b']) }],
            'batch.zip',
            { doc },
        );

        expect(ok).toBe(true);
        expect(doc.created).toHaveLength(1);
        expect(doc.created[0].download).toBe('batch.zip');
    });
});
