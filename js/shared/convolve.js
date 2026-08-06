// 3x3 convolution over raw RGBA pixels.
//
// CSS filters cover brightness, contrast, saturation, blur, grayscale, sepia,
// invert and hue-rotate, but there is no sharpen filter, so sharpening has to
// happen on the pixels themselves.
//
// Operates on a plain Uint8ClampedArray rather than a canvas, which keeps it
// testable -- jsdom has no canvas pixel support, so anything that took a
// CanvasRenderingContext2D could not be covered at all.

/** Classic sharpen. Strong; usually wants blending down. */
export const KERNEL_SHARPEN = Object.freeze([
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0,
]);

/** Gentler variant, better on photographs. */
export const KERNEL_SHARPEN_SOFT = Object.freeze([
    -0.5, -0.5, -0.5,
    -0.5, 5, -0.5,
    -0.5, -0.5, -0.5,
]);

const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : n);

/**
 * Apply a 3x3 kernel to RGBA data, returning new pixels.
 *
 * Alpha is copied through untouched: convolving it would halo the edges of a
 * transparent PNG. Edge pixels clamp to the nearest in-bounds sample rather
 * than being skipped, so the border does not stay conspicuously unsharpened.
 */
export function convolve3x3(data, width, height, kernel, { divisor = 1, offset = 0 } = {}) {
    const out = new Uint8ClampedArray(data.length);
    const weight = divisor || kernel.reduce((sum, k) => sum + k, 0) || 1;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const centre = (y * width + x) * 4;
            let r = 0;
            let g = 0;
            let b = 0;

            for (let ky = -1; ky <= 1; ky += 1) {
                for (let kx = -1; kx <= 1; kx += 1) {
                    const sx = Math.min(width - 1, Math.max(0, x + kx));
                    const sy = Math.min(height - 1, Math.max(0, y + ky));
                    const sample = (sy * width + sx) * 4;
                    const k = kernel[(ky + 1) * 3 + (kx + 1)];
                    r += data[sample] * k;
                    g += data[sample + 1] * k;
                    b += data[sample + 2] * k;
                }
            }

            out[centre] = clamp255(r / weight + offset);
            out[centre + 1] = clamp255(g / weight + offset);
            out[centre + 2] = clamp255(b / weight + offset);
            out[centre + 3] = data[centre + 3];
        }
    }

    return out;
}

/**
 * Sharpen by `amount` (0..1), blending the convolved result with the original.
 *
 * Blending rather than applying the kernel outright is what makes the slider
 * continuous; the raw kernel is a single fixed strength and looks harsh.
 */
export function unsharpMask(data, width, height, { amount = 0.5, soft = true } = {}) {
    if (amount <= 0) return new Uint8ClampedArray(data);

    const strength = Math.min(1, amount);
    const sharpened = convolve3x3(
        data, width, height,
        soft ? KERNEL_SHARPEN_SOFT : KERNEL_SHARPEN,
    );

    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
        out[i] = clamp255(data[i] + (sharpened[i] - data[i]) * strength);
        out[i + 1] = clamp255(data[i + 1] + (sharpened[i + 1] - data[i + 1]) * strength);
        out[i + 2] = clamp255(data[i + 2] + (sharpened[i + 2] - data[i + 2]) * strength);
        out[i + 3] = data[i + 3];
    }
    return out;
}
