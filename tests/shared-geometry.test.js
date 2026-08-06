import {
    MIN_RECT,
    elementToNormalised,
    normalisedToPx,
    pxToNormalised,
    clampRect,
    parseRatio,
    applyAspect,
    resizeRectByHandle,
    moveRect,
    centredRect,
    fitBox,
    sizeFromPercent,
    heightForWidth,
    widthForHeight,
    rotatedBounds,
    largestInscribedRect,
} from '../js/shared/geometry.js';

/** Stand-in for an element whose CSS size differs from its canvas attributes. */
function fakeElement({ left = 0, top = 0, width = 100, height = 100 }) {
    return { getBoundingClientRect: () => ({ left, top, width, height }) };
}

const ratioOf = (rect, srcW, srcH) => (rect.w * srcW) / (rect.h * srcH);

describe('elementToNormalised', () => {
    test('maps a pointer to a fraction of the rendered box', () => {
        const el = fakeElement({ left: 20, top: 10, width: 200, height: 100 });
        expect(elementToNormalised(120, 60, el)).toEqual({ x: 0.5, y: 0.5 });
    });

    // The bug this module exists to kill: the editor stored the crop rect in
    // canvas-attribute pixels but measured drags in CSS pixels, so whenever CSS
    // scaled the canvas the crop landed somewhere other than where it was drawn.
    // A normalised fraction is identical at any rendered size.
    test('is unaffected by CSS scaling the element', () => {
        const rendered = fakeElement({ left: 0, top: 0, width: 400, height: 300 });
        const shrunk = fakeElement({ left: 0, top: 0, width: 200, height: 150 });
        expect(elementToNormalised(100, 75, rendered)).toEqual(elementToNormalised(50, 37.5, shrunk));
    });

    test('clamps a drag that leaves the element instead of going negative', () => {
        const el = fakeElement({ left: 0, top: 0, width: 100, height: 100 });
        expect(elementToNormalised(-50, 150, el)).toEqual({ x: 0, y: 1 });
    });

    test('a zero-sized element does not produce NaN', () => {
        const el = fakeElement({ width: 0, height: 0 });
        expect(elementToNormalised(10, 10, el)).toEqual({ x: 0, y: 0 });
    });
});

describe('normalisedToPx / pxToNormalised', () => {
    test('converts to whole pixels within the image', () => {
        const px = normalisedToPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 400);
        expect(px).toEqual({ x: 200, y: 200, width: 400, height: 100 });
    });

    test('round-trips', () => {
        const original = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
        const px = normalisedToPx(original, 800, 400);
        expect(pxToNormalised(px, 800, 400)).toEqual(original);
    });

    // Rounding the far edge rather than the size keeps adjacent rects touching;
    // rounding the size lets them drift apart by a pixel and leave a seam.
    test('adjacent rects tile without a gap', () => {
        const left = normalisedToPx({ x: 0, y: 0, w: 1 / 3, h: 1 }, 1000, 10);
        const right = normalisedToPx({ x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, 1000, 10);
        expect(left.x + left.width).toBe(right.x);
    });

    test('never produces a zero-pixel dimension', () => {
        const px = normalisedToPx({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 10, 10);
        expect(px.width).toBeGreaterThanOrEqual(1);
        expect(px.height).toBeGreaterThanOrEqual(1);
    });

    test('a zero-sized image does not divide by zero', () => {
        expect(pxToNormalised({ x: 0, y: 0, width: 5, height: 5 }, 0, 0))
            .toEqual({ x: 0, y: 0, w: 1, h: 1 });
    });
});

describe('clampRect', () => {
    test('slides an overhanging rect back rather than shrinking it', () => {
        const clamped = clampRect({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 });
        expect(clamped.w).toBeCloseTo(0.5);
        expect(clamped.h).toBeCloseTo(0.5);
        expect(clamped.x).toBeCloseTo(0.5);
        expect(clamped.y).toBeCloseTo(0.5);
    });

    test('shrinks only when the rect genuinely cannot fit', () => {
        expect(clampRect({ x: 0, y: 0, w: 1.5, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    });

    test('enforces a minimum size', () => {
        const clamped = clampRect({ x: 0, y: 0, w: 0, h: 0 });
        expect(clamped.w).toBe(MIN_RECT);
        expect(clamped.h).toBe(MIN_RECT);
    });

    test('a negative origin is pulled back inside', () => {
        const clamped = clampRect({ x: -0.5, y: -0.2, w: 0.4, h: 0.4 });
        expect(clamped.x).toBe(0);
        expect(clamped.y).toBe(0);
    });
});

describe('parseRatio', () => {
    test.each([
        ['16:9', 16 / 9],
        ['16/9', 16 / 9],
        ['1:1', 1],
        ['9:16', 9 / 16],
        ['1.5', 1.5],
    ])('parses %s', (spec, expected) => {
        expect(parseRatio(spec, 100, 100)).toBeCloseTo(expected);
    });

    test('"original" uses the source dimensions', () => {
        expect(parseRatio('original', 1920, 1080)).toBeCloseTo(16 / 9);
    });

    test.each(['free', '', null, undefined, '0:0', 'nonsense'])(
        '%s means unconstrained',
        (spec) => {
            expect(parseRatio(spec, 100, 100)).toBeNull();
        },
    );
});

describe('applyAspect', () => {
    // A 1:1 crop on a 2000x1000 image is 0.5 x 1.0 in normalised space, not a
    // normalised square. Treating normalised coordinates as if they were pixels
    // is how "square" crops come out rectangular.
    test('a 1:1 crop on a non-square image is square in IMAGE pixels', () => {
        const rect = applyAspect({ x: 0, y: 0, w: 1, h: 1 }, 1, 'nw', 2000, 1000);
        const px = normalisedToPx(rect, 2000, 1000);
        expect(px.width).toBe(px.height);
    });

    test.each([
        ['16:9', 16 / 9],
        ['4:3', 4 / 3],
        ['9:16', 9 / 16],
        ['3:2', 3 / 2],
    ])('%s comes out at that ratio in image pixels', (_label, ratio) => {
        const rect = applyAspect({ x: 0, y: 0, w: 0.9, h: 0.9 }, ratio, 'nw', 1600, 1200);
        expect(ratioOf(rect, 1600, 1200)).toBeCloseTo(ratio, 5);
    });

    test('never exceeds the image bounds', () => {
        const rect = applyAspect({ x: 0, y: 0, w: 1, h: 1 }, 32 / 9, 'nw', 1000, 1000);
        expect(rect.w).toBeLessThanOrEqual(1);
        expect(rect.h).toBeLessThanOrEqual(1);
        expect(rect.x + rect.w).toBeLessThanOrEqual(1.0001);
        expect(rect.y + rect.h).toBeLessThanOrEqual(1.0001);
    });

    test('an nw anchor holds the top-left corner still', () => {
        const rect = applyAspect({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, 1, 'nw', 100, 100);
        expect(rect.x).toBeCloseTo(0.1);
        expect(rect.y).toBeCloseTo(0.2);
    });

    test('an se anchor holds the bottom-right corner still', () => {
        const orig = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
        const rect = applyAspect(orig, 1, 'se', 100, 100);
        expect(rect.x + rect.w).toBeCloseTo(orig.x + orig.w);
        expect(rect.y + rect.h).toBeCloseTo(orig.y + orig.h);
    });

    test('a center anchor keeps the midpoint', () => {
        const orig = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
        const rect = applyAspect(orig, 2, 'center', 100, 100);
        expect(rect.x + rect.w / 2).toBeCloseTo(0.5);
        expect(rect.y + rect.h / 2).toBeCloseTo(0.5);
    });

    test('no ratio leaves the rect alone', () => {
        const orig = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
        expect(applyAspect(orig, null, 'nw', 100, 100)).toBe(orig);
    });
});

describe('resizeRectByHandle', () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

    test('dragging se outward grows width and height', () => {
        const next = resizeRectByHandle(start, 'se', 0.1, 0.1);
        expect(next.w).toBeCloseTo(0.5);
        expect(next.h).toBeCloseTo(0.5);
        expect(next.x).toBeCloseTo(0.2);
        expect(next.y).toBeCloseTo(0.2);
    });

    test('dragging nw inward moves the origin and shrinks', () => {
        const next = resizeRectByHandle(start, 'nw', 0.1, 0.1);
        expect(next.x).toBeCloseTo(0.3);
        expect(next.y).toBeCloseTo(0.3);
        expect(next.w).toBeCloseTo(0.3);
        expect(next.h).toBeCloseTo(0.3);
    });

    test('an edge handle only moves its own axis', () => {
        const next = resizeRectByHandle(start, 'e', 0.1, 0.1);
        expect(next.w).toBeCloseTo(0.5);
        expect(next.h).toBeCloseTo(0.4);
        expect(next.y).toBeCloseTo(0.2);
    });

    test('cannot be dragged inside out', () => {
        const next = resizeRectByHandle(start, 'e', -10, 0);
        expect(next.w).toBeGreaterThanOrEqual(MIN_RECT);
        expect(next.x).toBeLessThanOrEqual(next.x + next.w);
    });

    test('cannot be dragged outside the image', () => {
        const next = resizeRectByHandle(start, 'se', 10, 10);
        expect(next.x + next.w).toBeLessThanOrEqual(1.0001);
        expect(next.y + next.h).toBeLessThanOrEqual(1.0001);
    });

    test('with a ratio, every corner drag keeps that ratio', () => {
        for (const handle of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']) {
            const next = resizeRectByHandle(start, handle, 0.15, 0.05, {
                ratio: 16 / 9, srcW: 1000, srcH: 1000,
            });
            expect(ratioOf(next, 1000, 1000)).toBeCloseTo(16 / 9, 4);
        }
    });

    test('the constrained result still stays inside the image', () => {
        const next = resizeRectByHandle(start, 'se', 5, 5, {
            ratio: 16 / 9, srcW: 1000, srcH: 1000,
        });
        expect(next.x).toBeGreaterThanOrEqual(0);
        expect(next.y).toBeGreaterThanOrEqual(0);
        expect(next.x + next.w).toBeLessThanOrEqual(1.0001);
        expect(next.y + next.h).toBeLessThanOrEqual(1.0001);
    });
});

describe('moveRect', () => {
    test('translates without resizing', () => {
        const next = moveRect({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, 0.2, 0.1);
        expect(next.x).toBeCloseTo(0.3);
        expect(next.y).toBeCloseTo(0.2);
        expect(next.w).toBeCloseTo(0.3);
        expect(next.h).toBeCloseTo(0.3);
    });

    test('stops at the edge instead of leaving the image', () => {
        const next = moveRect({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, 0.5, 0.5);
        expect(next.x).toBeCloseTo(0.8);
        expect(next.y).toBeCloseTo(0.8);
        expect(next.w).toBeCloseTo(0.2);
    });
});

describe('centredRect', () => {
    test('unconstrained, it is centred at the requested coverage', () => {
        const rect = centredRect(null, 100, 100, 0.8);
        expect(rect.w).toBeCloseTo(0.8);
        expect(rect.h).toBeCloseTo(0.8);
        expect(rect.x).toBeCloseTo(0.1);
        expect(rect.y).toBeCloseTo(0.1);
    });

    test('constrained, it is centred and at the right ratio', () => {
        const rect = centredRect(16 / 9, 1000, 1000, 0.8);
        expect(rect.x + rect.w / 2).toBeCloseTo(0.5);
        expect(rect.y + rect.h / 2).toBeCloseTo(0.5);
        expect(ratioOf(rect, 1000, 1000)).toBeCloseTo(16 / 9, 4);
    });

    test('a ratio wider than the image still fits', () => {
        const rect = centredRect(21 / 9, 1000, 1000, 0.9);
        expect(rect.w).toBeLessThanOrEqual(1);
        expect(rect.h).toBeLessThanOrEqual(1);
    });
});

describe('fitBox', () => {
    test('fit letterboxes without cropping', () => {
        const box = fitBox(1000, 500, 400, 400, 'fit');
        expect(box.sw).toBe(1000);
        expect(box.sh).toBe(500);
        expect(box.dw).toBe(400);
        expect(box.dh).toBe(200);
        expect(box.dy).toBe(100); // centred vertically
        expect(box.dx).toBe(0);
    });

    test('cover fills the frame and centre-crops the overflow', () => {
        const box = fitBox(1000, 500, 400, 400, 'cover');
        expect(box.dw).toBe(400);
        expect(box.dh).toBe(400);
        expect(box.sw).toBe(500);        // a square region of the source
        expect(box.sh).toBe(500);
        expect(box.sx).toBe(250);        // taken from the middle
        expect(box.sy).toBe(0);
    });

    test('stretch uses the whole source and the exact destination', () => {
        const box = fitBox(1000, 500, 400, 400, 'stretch');
        expect(box).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 500, dx: 0, dy: 0, dw: 400, dh: 400 });
    });

    test('fit and cover agree when the aspects already match', () => {
        const fit = fitBox(800, 400, 400, 200, 'fit');
        const cover = fitBox(800, 400, 400, 200, 'cover');
        expect(fit.dw).toBeCloseTo(cover.dw);
        expect(fit.dh).toBeCloseTo(cover.dh);
    });

    test('degenerate inputs do not produce NaN', () => {
        for (const box of [fitBox(0, 0, 100, 100), fitBox(100, 100, 0, 0)]) {
            for (const value of Object.values(box)) expect(Number.isFinite(value)).toBe(true);
        }
    });
});

describe('resize helpers', () => {
    test('sizeFromPercent halves', () => {
        expect(sizeFromPercent(1920, 1080, 50)).toEqual({ width: 960, height: 540 });
    });

    test('a tiny percentage still leaves at least one pixel', () => {
        expect(sizeFromPercent(10, 10, 1)).toEqual({ width: 1, height: 1 });
    });

    test('heightForWidth and widthForHeight preserve the aspect ratio', () => {
        expect(heightForWidth(960, 1920, 1080)).toBe(540);
        expect(widthForHeight(540, 1920, 1080)).toBe(960);
    });

    test('they never return zero', () => {
        expect(heightForWidth(1, 1000, 1)).toBeGreaterThanOrEqual(1);
        expect(widthForHeight(1, 1, 1000)).toBeGreaterThanOrEqual(1);
    });
});

describe('rotatedBounds', () => {
    test('a right angle swaps the dimensions', () => {
        expect(rotatedBounds(800, 600, 90)).toEqual({ width: 600, height: 800 });
    });

    test('zero degrees is a no-op', () => {
        expect(rotatedBounds(800, 600, 0)).toEqual({ width: 800, height: 600 });
    });

    test('45 degrees grows both dimensions to the diagonal', () => {
        const bounds = rotatedBounds(100, 100, 45);
        expect(bounds.width).toBe(Math.round(100 * Math.SQRT2));
        expect(bounds.height).toBe(Math.round(100 * Math.SQRT2));
    });

    test('sign of the angle does not matter', () => {
        expect(rotatedBounds(800, 600, -30)).toEqual(rotatedBounds(800, 600, 30));
    });
});

describe('largestInscribedRect', () => {
    test('zero degrees keeps the whole image', () => {
        expect(largestInscribedRect(800, 600, 0)).toEqual({ width: 800, height: 600 });
    });

    test('a straighten always crops inside the original', () => {
        for (const angle of [1, 5, 10, 20, 33, 45]) {
            const inner = largestInscribedRect(800, 600, angle);
            expect(inner.width).toBeGreaterThan(0);
            expect(inner.height).toBeGreaterThan(0);
            expect(inner.width).toBeLessThanOrEqual(800);
            expect(inner.height).toBeLessThanOrEqual(600);
        }
    });

    test('a larger angle crops more away', () => {
        const small = largestInscribedRect(800, 600, 5);
        const large = largestInscribedRect(800, 600, 25);
        expect(large.width * large.height).toBeLessThan(small.width * small.height);
    });

    test('sign of the angle does not matter', () => {
        expect(largestInscribedRect(800, 600, -15)).toEqual(largestInscribedRect(800, 600, 15));
    });

    test('a degenerate image returns nothing rather than NaN', () => {
        expect(largestInscribedRect(0, 0, 20)).toEqual({ width: 0, height: 0 });
    });
});
