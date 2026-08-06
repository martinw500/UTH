import {
    COMPRESSION_PRESETS,
    CUSTOM_PRESET,
    PRESET_NAMES,
    qualityForPreset,
    presetForQuality,
    parseTargetBytes,
    savings,
    describeTargetResult,
} from '../js/shared/compression.js';

import {
    IDENTITY_ADJUST,
    FULL_RECT,
    createState,
    cloneState,
    isIdentityAdjust,
    isPristine,
    buildFilterString,
    needsConvolution,
    normaliseRotation,
    outputSize,
    describeState,
} from '../js/shared/pipeline.js';

import { formatBytes } from '../js/shared/format.js';

// ============================================
// compression.js
// ============================================

describe('quality presets', () => {
    test('every preset maps to a quality', () => {
        for (const name of PRESET_NAMES) {
            expect(qualityForPreset(name)).toBe(COMPRESSION_PRESETS[name]);
        }
    });

    test('an unknown name is not silently treated as a preset', () => {
        expect(qualityForPreset('enormous')).toBeNull();
        expect(qualityForPreset(undefined)).toBeNull();
    });

    // Guards against a prototype key being read as a preset.
    test('inherited object properties are not presets', () => {
        expect(qualityForPreset('constructor')).toBeNull();
        expect(qualityForPreset('toString')).toBeNull();
    });

    // The dropdown used to follow the slider but not vice versa, so dragging
    // the slider left it reading "Medium" at a quality that was not medium.
    test('preset and quality round-trip', () => {
        for (const name of PRESET_NAMES) {
            expect(presetForQuality(qualityForPreset(name))).toBe(name);
        }
    });

    test('a quality between presets reports as custom', () => {
        expect(presetForQuality(0.55)).toBe(CUSTOM_PRESET);
        expect(presetForQuality(0.93)).toBe(CUSTOM_PRESET);
    });

    test('a near-miss within tolerance still names the preset', () => {
        expect(presetForQuality(0.605)).toBe('medium');
        expect(presetForQuality(0.59)).toBe('medium');
    });

    test('a nonsense quality is custom rather than a crash', () => {
        expect(presetForQuality(NaN)).toBe(CUSTOM_PRESET);
        expect(presetForQuality(undefined)).toBe(CUSTOM_PRESET);
    });

    test('presets are ordered best to worst', () => {
        const values = PRESET_NAMES.map((n) => COMPRESSION_PRESETS[n]);
        expect([...values].sort((a, b) => b - a)).toEqual(values);
    });
});

describe('parseTargetBytes', () => {
    test('converts each unit', () => {
        expect(parseTargetBytes(500, 'kb')).toBe(500 * 1024);
        expect(parseTargetBytes(2, 'mb')).toBe(2 * 1024 * 1024);
        expect(parseTargetBytes(900, 'b')).toBe(900);
    });

    test('accepts the string an input element actually gives you', () => {
        expect(parseTargetBytes('500', 'kb')).toBe(500 * 1024);
        expect(parseTargetBytes(' 1.5 ', 'mb')).toBe(Math.round(1.5 * 1024 * 1024));
    });

    // An empty target field is the normal default, not an error.
    test.each([['', 'kb'], [null, 'kb'], [undefined, 'kb']])(
        '%p means no target',
        (value, unit) => {
            expect(parseTargetBytes(value, unit)).toBeNull();
        },
    );

    test('zero and negative sizes are rejected', () => {
        expect(parseTargetBytes(0, 'kb')).toBeNull();
        expect(parseTargetBytes(-5, 'kb')).toBeNull();
    });

    test('garbage is rejected rather than becoming NaN bytes', () => {
        expect(parseTargetBytes('abc', 'kb')).toBeNull();
    });

    test('an unknown unit falls back to KB rather than NaN', () => {
        expect(parseTargetBytes(1, 'furlongs')).toBe(1024);
    });

    test('unit case does not matter', () => {
        expect(parseTargetBytes(1, 'MB')).toBe(1024 * 1024);
    });
});

describe('savings', () => {
    test('reports a smaller file', () => {
        expect(savings(1000, 250)).toEqual({ percent: 75, direction: 'smaller', label: '75% smaller' });
    });

    // Re-encoding a small PNG as PNG routinely grows it. Saying "-12% smaller"
    // would be nonsense, so direction carries the sign instead.
    test('reports a larger file without a negative percentage', () => {
        const result = savings(1000, 1200);
        expect(result.direction).toBe('larger');
        expect(result.percent).toBe(20);
        expect(result.label).toBe('20% larger');
    });

    test('reports no change', () => {
        expect(savings(1000, 1000).direction).toBe('same');
    });

    test('a zero or unknown original size does not divide by zero', () => {
        for (const before of [0, -1, NaN, undefined]) {
            const result = savings(before, 500);
            expect(result.percent).toBe(0);
            expect(Number.isFinite(result.percent)).toBe(true);
        }
    });
});

describe('describeTargetResult', () => {
    test('says so when downscaling was needed to hit the target', () => {
        const text = describeTargetResult(
            { reachedTarget: true, scale: 0.68, quality: 0.3 }, 480 * 1024, formatBytes,
        );
        expect(text).toContain('68%');
        expect(text).toContain('480.0 KB');
    });

    test('does not mention downscaling when none happened', () => {
        const text = describeTargetResult(
            { reachedTarget: true, scale: 1, quality: 0.8 }, 1024, formatBytes,
        );
        expect(text).not.toMatch(/downscal/i);
    });

    test('is honest when the target could not be reached', () => {
        const text = describeTargetResult(
            { reachedTarget: false, scale: 0.2, quality: 0.3 }, 1024, formatBytes,
        );
        expect(text).toMatch(/could not reach/i);
    });
});

// ============================================
// pipeline.js
// ============================================

describe('edit state', () => {
    test('a fresh state is pristine', () => {
        expect(isPristine(createState())).toBe(true);
    });

    test('each kind of edit makes it non-pristine', () => {
        const edits = [
            (s) => { s.adjust.brightness = 10; },
            (s) => { s.crop = { x: 0.1, y: 0, w: 0.5, h: 1 }; },
            (s) => { s.rotate = 90; },
            (s) => { s.straighten = 3; },
            (s) => { s.flipH = true; },
            (s) => { s.flipV = true; },
            (s) => { s.resize = { width: 10, height: 10, mode: 'fit' }; },
        ];
        for (const apply of edits) {
            const state = createState();
            apply(state);
            expect(isPristine(state)).toBe(false);
        }
    });

    // Undo pushes clones. A shallow copy would let later edits mutate the
    // history in place, so undo would restore the state you were already in.
    test('cloneState does not share nested objects', () => {
        const original = createState();
        const copy = cloneState(original);
        copy.adjust.brightness = 50;
        copy.crop.x = 0.5;
        expect(original.adjust.brightness).toBe(0);
        expect(original.crop.x).toBe(0);
    });

    test('cloneState copies a resize rather than aliasing it', () => {
        const original = createState();
        original.resize = { width: 100, height: 50, mode: 'fit' };
        const copy = cloneState(original);
        copy.resize.width = 999;
        expect(original.resize.width).toBe(100);
    });

    test('a null resize survives cloning', () => {
        expect(cloneState(createState()).resize).toBeNull();
    });

    test('IDENTITY_ADJUST and FULL_RECT cannot be mutated by a caller', () => {
        expect(Object.isFrozen(IDENTITY_ADJUST)).toBe(true);
        expect(Object.isFrozen(FULL_RECT)).toBe(true);
    });

    test('isIdentityAdjust notices every adjustment', () => {
        for (const key of Object.keys(IDENTITY_ADJUST)) {
            const adjust = { ...IDENTITY_ADJUST, [key]: 5 };
            expect(isIdentityAdjust(adjust)).toBe(false);
        }
        expect(isIdentityAdjust({ ...IDENTITY_ADJUST })).toBe(true);
    });
});

describe('buildFilterString', () => {
    const filter = (overrides) => buildFilterString({ ...IDENTITY_ADJUST, ...overrides });

    test('no adjustments means no filter', () => {
        expect(filter({})).toBe('none');
    });

    test.each([
        ['grayscale', { grayscale: 100 }, 'grayscale(100%)'],
        ['sepia', { sepia: 60 }, 'sepia(60%)'],
        ['invert', { invert: 100 }, 'invert(100%)'],
        ['hue rotate', { hueRotate: -90 }, 'hue-rotate(-90deg)'],
    ])('%s', (_name, adjust, expected) => {
        expect(filter(adjust)).toBe(expected);
    });

    // CSS has no sharpen filter. Emitting one would be silently ignored by the
    // browser, so it must go through a convolution pass instead.
    test('sharpen is never emitted as a CSS filter', () => {
        expect(filter({ sharpen: 80 })).toBe('none');
        expect(needsConvolution({ ...IDENTITY_ADJUST, sharpen: 80 })).toBe(true);
        expect(needsConvolution(IDENTITY_ADJUST)).toBe(false);
    });

    test('combined adjustments all appear', () => {
        const result = filter({ brightness: 10, grayscale: 50, hueRotate: 45, blur: 3 });
        expect(result).toContain('brightness(110%)');
        expect(result).toContain('grayscale(50%)');
        expect(result).toContain('hue-rotate(45deg)');
        expect(result).toContain('blur(3px)');
    });
});

describe('normaliseRotation', () => {
    test.each([
        [0, 0], [90, 90], [180, 180], [270, 270],
        [360, 0], [450, 90], [-90, 270], [-450, 270],
    ])('%i degrees normalises to %i', (input, expected) => {
        expect(normaliseRotation(input)).toBe(expected);
    });
});

describe('outputSize', () => {
    const base = () => createState();

    test('an untouched image keeps its dimensions', () => {
        expect(outputSize(1920, 1080, base())).toEqual({ width: 1920, height: 1080 });
    });

    test('a crop shrinks it proportionally', () => {
        const state = base();
        state.crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
        expect(outputSize(1920, 1080, state)).toEqual({ width: 960, height: 540 });
    });

    test('a quarter turn swaps the dimensions', () => {
        const state = base();
        state.rotate = 90;
        expect(outputSize(1920, 1080, state)).toEqual({ width: 1080, height: 1920 });
    });

    test('a half turn does not', () => {
        const state = base();
        state.rotate = 180;
        expect(outputSize(1920, 1080, state)).toEqual({ width: 1920, height: 1080 });
    });

    test('crop and rotate compose', () => {
        const state = base();
        state.crop = { x: 0, y: 0, w: 0.5, h: 1 };
        state.rotate = 90;
        expect(outputSize(1920, 1080, state)).toEqual({ width: 1080, height: 960 });
    });

    test('an explicit resize wins over everything', () => {
        const state = base();
        state.crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
        state.rotate = 90;
        state.resize = { width: 300, height: 200, mode: 'fit' };
        expect(outputSize(1920, 1080, state)).toEqual({ width: 300, height: 200 });
    });

    test('never returns a zero dimension', () => {
        const state = base();
        state.crop = { x: 0, y: 0, w: 0.0001, h: 0.0001 };
        const size = outputSize(10, 10, state);
        expect(size.width).toBeGreaterThanOrEqual(1);
        expect(size.height).toBeGreaterThanOrEqual(1);
    });

    test('a missing crop is treated as the full image', () => {
        expect(outputSize(800, 600, { rotate: 0, adjust: IDENTITY_ADJUST }))
            .toEqual({ width: 800, height: 600 });
    });
});

describe('describeState', () => {
    test('says nothing about an untouched image', () => {
        expect(describeState(createState(), 800, 600)).toEqual([]);
    });

    test('names each applied change', () => {
        const state = createState();
        state.rotate = 90;
        state.flipH = true;
        state.adjust.brightness = 20;
        state.crop = { x: 0, y: 0, w: 0.5, h: 0.5 };

        const notes = describeState(state, 800, 600).join(', ');
        expect(notes).toMatch(/cropped/);
        expect(notes).toMatch(/rotated 90/);
        expect(notes).toMatch(/flipped horizontally/);
        expect(notes).toMatch(/adjusted/);
    });
});
