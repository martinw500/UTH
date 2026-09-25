// convert/js/ui.js — the option panel the hub renders per target format.

import { renderOptions } from '../convert/js/ui.js';

describe('renderOptions', () => {
    // main.js re-renders the panel on every format change and passes the old
    // values in, promising they carry over. Target size and trim ignored them,
    // so 10 MB then MP4 -> WebM silently exported at full size.
    test('target size and trim survive a format change', () => {
        const host = document.createElement('div');
        let read = renderOptions(host, 'mp4');
        host.querySelector('#opt-targetSize').value = '10';
        host.querySelector('#opt-targetSize-unit').value = 'mb';
        host.querySelector('#opt-trim-start').value = '0:05';
        host.querySelector('#opt-trim-end').value = '0:30';

        read = renderOptions(host, 'webm', read());
        const values = read();
        expect(values.targetSize).toEqual({ value: '10', unit: 'mb' });
        expect(values.trim).toEqual({ start: '0:05', end: '0:30' });
    });

    test('an empty target size and trim stay empty', () => {
        const host = document.createElement('div');
        const read = renderOptions(host, 'webm', renderOptions(host, 'mp4')());
        expect(read().targetSize).toBeNull();
        expect(read().trim).toBeNull();
    });
});
