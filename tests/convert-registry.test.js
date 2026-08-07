import {
    KINDS,
    TARGETS,
    OPTION_SPECS,
    detectKind,
    targetsFor,
    findTarget,
    engineFor,
    isSupported,
    defaultTarget,
    optionSpec,
    optionsFor,
    defaultOptions,
    outputName,
    describeKind,
} from '../js/shared/convert-registry.js';

import { ENGINE_NAMES, isKnownEngine } from '../convert/js/engine-loader.js';

const file = (name, type = '') => ({ name, type, size: 1000 });

describe('detectKind', () => {
    test.each([
        ['photo.jpg', 'image/jpeg', 'image'],
        ['photo.png', 'image/png', 'image'],
        ['art.svg', 'image/svg+xml', 'image'],
        ['clip.mp4', 'video/mp4', 'video'],
        ['clip.webm', 'video/webm', 'video'],
        ['song.mp3', 'audio/mpeg', 'audio'],
        ['song.flac', 'audio/flac', 'audio'],
    ])('%s is %s', (name, type, expected) => {
        expect(detectKind(file(name, type))).toBe(expected);
    });

    // Browsers report an empty type for these on several platforms, so the
    // extension has to carry it.
    test.each(['movie.mkv', 'movie.avi', 'movie.mov', 'movie.wmv', 'movie.flv'])(
        '%s is detected as video with no MIME type at all',
        (name) => {
            expect(detectKind(file(name, ''))).toBe('video');
        },
    );

    // Windows reports .m4a as audio/mp4, which by prefix is indistinguishable
    // from video/mp4. The extension is the only thing that disambiguates.
    test('an .m4a reported as audio/mp4 is audio, not video', () => {
        expect(detectKind(file('song.m4a', 'audio/mp4'))).toBe('audio');
    });

    test('extension wins over a contradictory MIME type', () => {
        expect(detectKind(file('actually-a-song.mp3', 'video/mp4'))).toBe('audio');
    });

    test('MIME type carries it when the extension is unknown', () => {
        expect(detectKind(file('capture', 'image/png'))).toBe('image');
    });

    test.each([
        ['notes.txt', 'text/plain'],
        ['archive.zip', 'application/zip'],
        ['nameless', ''],
    ])('%s is unknown rather than guessed at', (name, type) => {
        expect(detectKind(file(name, type))).toBe('unknown');
    });

    test('a missing file object does not throw', () => {
        expect(detectKind(null)).toBe('unknown');
        expect(detectKind({})).toBe('unknown');
    });

    test('case does not matter', () => {
        expect(detectKind(file('PHOTO.JPG', 'IMAGE/JPEG'))).toBe('image');
    });
});

describe('routing', () => {
    test('images can only become images', () => {
        expect(targetsFor('image').every((t) => t.kind === 'image')).toBe(true);
    });

    // Extracting a soundtrack is the main reason to convert a video to audio.
    test('video can become video or audio', () => {
        const kinds = new Set(targetsFor('video').map((t) => t.kind));
        expect(kinds).toEqual(new Set(['video', 'audio']));
    });

    test('audio can only become audio', () => {
        expect(targetsFor('audio').every((t) => t.kind === 'audio')).toBe(true);
    });

    // A frame grab is a different feature with different controls, not a
    // format conversion, so it must not appear as one.
    test('audio cannot become video, and neither becomes an image', () => {
        expect(isSupported('audio', 'mp4')).toBe(false);
        expect(isSupported('audio', 'png')).toBe(false);
        expect(isSupported('video', 'png')).toBe(false);
        expect(isSupported('image', 'mp3')).toBe(false);
    });

    test('an unknown kind offers nothing rather than everything', () => {
        expect(targetsFor('unknown')).toEqual([]);
        expect(targetsFor(undefined)).toEqual([]);
    });

    test('every kind has a default target that it can actually reach', () => {
        for (const kind of KINDS) {
            const id = defaultTarget(kind);
            expect(id).toBeTruthy();
            expect(isSupported(kind, id)).toBe(true);
        }
    });
});

describe('the target table is internally consistent', () => {
    test('ids are unique', () => {
        const ids = TARGETS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every target names an engine that exists', () => {
        for (const target of TARGETS) {
            expect(isKnownEngine(target.engine)).toBe(true);
        }
    });

    // A typo here would otherwise surface as an unrendered control, silently.
    test('every option a target lists is a real spec', () => {
        for (const target of TARGETS) {
            for (const id of target.options) {
                expect(optionSpec(id)).not.toBeNull();
            }
        }
    });

    test('every target carries a mime type and extension', () => {
        for (const target of TARGETS) {
            expect(target.mime).toMatch(/^[a-z]+\//);
            expect(target.ext).toMatch(/^[a-z0-9]+$/);
        }
    });

    test('every option spec has a type the UI can render', () => {
        const renderable = ['range', 'select', 'checkbox', 'colour', 'size', 'trim'];
        for (const spec of OPTION_SPECS) {
            expect(renderable).toContain(spec.type);
        }
    });

    test('every select spec has choices, and its default is one of them', () => {
        for (const spec of OPTION_SPECS.filter((s) => s.type === 'select')) {
            expect(spec.choices.length).toBeGreaterThan(0);
            expect(spec.choices.map((c) => c.value)).toContain(spec.default);
        }
    });

    test('the table is frozen against accidental mutation', () => {
        expect(Object.isFrozen(TARGETS)).toBe(true);
        expect(Object.isFrozen(OPTION_SPECS)).toBe(true);
        expect(Object.isFrozen(ENGINE_NAMES)).toBe(true);
    });

    // Only JPEG among the image targets lacks an alpha channel, and it is the
    // one that composites transparency to black without a matte colour.
    test('the opaque image format offers a background colour', () => {
        expect(findTarget('jpg').options).toContain('matte');
        expect(findTarget('png').options).not.toContain('matte');
    });

    test('lossless formats do not offer a quality slider', () => {
        expect(findTarget('png').options).not.toContain('quality');
        expect(findTarget('wav').options).not.toContain('bitrate');
        expect(findTarget('flac').options).not.toContain('bitrate');
    });

    test('engineFor accepts an id or a target object', () => {
        expect(engineFor('png')).toBe('image');
        expect(engineFor(findTarget('mp4'))).toBe('media');
        expect(engineFor('nope')).toBeNull();
    });
});

describe('options', () => {
    test('optionsFor returns specs in the declared order', () => {
        const ids = optionsFor('mp4').map((spec) => spec.id);
        expect(ids).toEqual(findTarget('mp4').options);
    });

    test('an unknown target has no options rather than throwing', () => {
        expect(optionsFor('nonsense')).toEqual([]);
        expect(defaultOptions('nonsense')).toEqual({});
    });

    test('defaults cover every option the target declares', () => {
        const defaults = defaultOptions('jpg');
        expect(Object.keys(defaults).sort()).toEqual([...findTarget('jpg').options].sort());
    });
});

describe('outputName', () => {
    test('swaps the extension for the target format', () => {
        expect(outputName('holiday.png', 'webp')).toBe('holiday.webp');
        expect(outputName('clip.mkv', findTarget('mp4'))).toBe('clip.mp4');
    });

    test('only the final extension is replaced', () => {
        expect(outputName('backup.2024.mov', 'mp4')).toBe('backup.2024.mp4');
    });

    test('a name with no extension keeps its name', () => {
        expect(outputName('recording', 'mp3')).toBe('recording.mp3');
    });

    // The name comes from a dropped file and lands in a download attribute.
    test('a path cannot survive into the filename', () => {
        const name = outputName('../../etc/passwd.png', 'jpg');
        expect(name).toBe('passwd.jpg');
        expect(name).not.toContain('/');
        expect(name).not.toContain('..');
    });

    test('an empty or hostile name still yields something downloadable', () => {
        expect(outputName('', 'png')).toBe('converted.png');
        expect(outputName('.gitignore', 'png')).toBe('converted.png');
        expect(outputName(null, 'png')).toBe('converted.png');
    });

    test('an unknown target still produces a usable name', () => {
        expect(outputName('a.txt', 'nonsense')).toBe('a.bin');
    });
});

describe('describeKind', () => {
    test.each([
        ['image', 1, '1 image'],
        ['image', 3, '3 images'],
        ['video', 2, '2 videos'],
        ['audio', 1, '1 audio file'],
        ['audio', 4, '4 audio files'],
    ])('%s x%i reads as "%s"', (kind, count, expected) => {
        expect(describeKind(kind, count)).toBe(expected);
    });

    test('an unknown kind still reads sensibly', () => {
        expect(describeKind('unknown', 2)).toBe('2 files');
    });
});

describe('engine loader', () => {
    test('only the engines that exist are known', () => {
        expect(ENGINE_NAMES).toEqual(['image', 'media']);
        expect(isKnownEngine('image')).toBe(true);
        expect(isKnownEngine('document')).toBe(false);
    });
});
