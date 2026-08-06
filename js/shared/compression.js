// Quality presets, target sizes and savings arithmetic.
//
// Pure and DOM-free so the export panel's behaviour can be tested without a
// canvas. The actual encoding lives in image.js (`compressToTarget`).

/** Preset name -> canvas encode quality. Ordered best to worst. */
export const COMPRESSION_PRESETS = Object.freeze({
    none: 1.0,
    light: 0.8,
    medium: 0.6,
    heavy: 0.4,
    extreme: 0.2,
});

/** Shown when the slider sits between presets. Not a preset itself. */
export const CUSTOM_PRESET = 'custom';

export const PRESET_NAMES = Object.freeze(Object.keys(COMPRESSION_PRESETS));

/** Preset name -> quality, or null if the name is not a preset. */
export function qualityForPreset(name) {
    return Object.prototype.hasOwnProperty.call(COMPRESSION_PRESETS, name)
        ? COMPRESSION_PRESETS[name]
        : null;
}

/**
 * Quality -> the preset it corresponds to, or 'custom'.
 *
 * The inverse of qualityForPreset, so the preset dropdown can follow the
 * quality slider. Previously the sync only ran one way: picking "Medium" moved
 * the slider, but then dragging the slider left the dropdown still claiming
 * "Medium" while the actual quality was something else.
 */
export function presetForQuality(quality, { tolerance = 0.015 } = {}) {
    if (!Number.isFinite(quality)) return CUSTOM_PRESET;
    for (const [name, value] of Object.entries(COMPRESSION_PRESETS)) {
        if (Math.abs(value - quality) <= tolerance) return name;
    }
    return CUSTOM_PRESET;
}

const UNIT_BYTES = { b: 1, kb: 1024, mb: 1024 * 1024 };

/**
 * A target-size field and its unit -> bytes, or null when unset/invalid.
 *
 * Null means "no target", which is a normal state, not an error -- the field is
 * optional and empty by default.
 */
export function parseTargetBytes(value, unit = 'kb') {
    if (value === null || value === undefined || value === '') return null;
    const amount = typeof value === 'number' ? value : parseFloat(String(value).trim());
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const multiplier = UNIT_BYTES[String(unit).toLowerCase()] ?? UNIT_BYTES.kb;
    return Math.round(amount * multiplier);
}

/**
 * How the exported file compares with the original.
 *
 * `percent` is always non-negative; `direction` carries the sign, so callers
 * never have to decide whether a negative saving means bigger or smaller.
 */
export function savings(beforeBytes, afterBytes) {
    const before = Number(beforeBytes);
    const after = Number(afterBytes);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) {
        return { percent: 0, direction: 'same', label: '' };
    }

    const delta = before - after;
    const percent = Math.round(Math.abs(delta / before) * 100);

    if (percent === 0) return { percent: 0, direction: 'same', label: 'same size' };
    if (delta > 0) return { percent, direction: 'smaller', label: `${percent}% smaller` };
    return { percent, direction: 'larger', label: `${percent}% larger` };
}

/**
 * Human summary of a compressToTarget result.
 *
 * Downscaling to hit a target is a real change to the image, so it has to be
 * said out loud rather than silently returning smaller pixels than asked for.
 */
export function describeTargetResult({ reachedTarget, scale = 1, quality = 1 }, targetBytes, formatBytes) {
    const target = formatBytes ? formatBytes(targetBytes) : `${targetBytes} B`;
    if (!reachedTarget) {
        return `Could not reach ${target} — this is as small as it goes without destroying the image.`;
    }
    const qualityPart = `quality ${Math.round(quality * 100)}%`;
    if (scale < 1) {
        return `Hit ${target} at ${qualityPart}, downscaled to ${Math.round(scale * 100)}%.`;
    }
    return `Hit ${target} at ${qualityPart}.`;
}
