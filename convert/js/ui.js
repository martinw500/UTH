// Render the option panel from the registry.
//
// Generic on purpose: the controls a format supports are a list of ids in
// js/shared/convert-registry.js, so adding a format is a row in that table
// rather than another branch in a hand-written show/hide cascade like the one
// the old video converter had.

import { el } from '../../js/shared/dom.js';
import { optionsFor } from '../../js/shared/convert-registry.js';

/** Build one control. Returns { node, read } so the caller need not know types. */
function buildControl(spec, initial) {
    switch (spec.type) {
        case 'range': {
            const output = el('span', { class: 'adjustment-value' }, String(initial ?? spec.default));
            const input = el('input', {
                type: 'range',
                class: 'quality-slider',
                id: `opt-${spec.id}`,
                min: String(spec.min),
                max: String(spec.max),
                value: String(initial ?? spec.default),
            });
            input.addEventListener('input', () => { output.textContent = input.value; });
            return {
                node: el('div', { class: 'setting-group' },
                    el('div', { class: 'adjustment-header' },
                        el('label', { for: `opt-${spec.id}`, class: 'input-label' }, spec.label),
                        output),
                    input,
                    spec.hint ? el('div', { class: 'option-hint' }, spec.hint) : null),
                read: () => Number(input.value),
            };
        }

        case 'select': {
            const select = el('select', { class: 'format-select', id: `opt-${spec.id}` },
                ...spec.choices.map((choice) => el('option', { value: choice.value }, choice.label)));
            select.value = initial ?? spec.default;
            return {
                node: el('div', { class: 'setting-group' },
                    el('label', { for: `opt-${spec.id}`, class: 'input-label' }, spec.label),
                    select,
                    spec.hint ? el('div', { class: 'option-hint' }, spec.hint) : null),
                read: () => select.value,
            };
        }

        case 'checkbox': {
            const input = el('input', { type: 'checkbox', id: `opt-${spec.id}` });
            input.checked = Boolean(initial ?? spec.default);
            return {
                node: el('div', { class: 'setting-group' },
                    el('label', { class: 'checkbox-line', for: `opt-${spec.id}` },
                        input, el('span', {}, spec.label))),
                read: () => input.checked,
            };
        }

        case 'colour': {
            const input = el('input', {
                type: 'color',
                class: 'color-picker-input matte-picker',
                id: `opt-${spec.id}`,
                value: initial ?? spec.default,
            });
            return {
                node: el('div', { class: 'setting-group' },
                    el('label', { for: `opt-${spec.id}`, class: 'input-label' }, spec.label),
                    el('div', { class: 'matte-row' }, input,
                        spec.hint ? el('span', { class: 'matte-hint' }, spec.hint) : null)),
                read: () => input.value,
            };
        }

        case 'size': {
            const value = el('input', {
                type: 'number', class: 'input-field input-sm', id: `opt-${spec.id}`,
                min: '1', placeholder: 'e.g. 500',
            });
            const unit = el('select', { class: 'format-select input-sm', id: `opt-${spec.id}-unit` },
                el('option', { value: 'kb' }, 'KB'), el('option', { value: 'mb' }, 'MB'));

            // Declared in the registry, so a target that wants different
            // shortcuts changes a row there rather than this switch. Clicking
            // the active chip clears it, so a preset is never a one-way door.
            const chosen = (preset) => value.value === String(preset.value)
                && unit.value === preset.unit;

            let presets = null;
            const chips = [];

            function syncChips() {
                chips.forEach((chip, i) => {
                    chip.classList.toggle('is-active', chosen(spec.presets[i]));
                });
            }

            if (spec.presets?.length) {
                for (const preset of spec.presets) {
                    const chip = el('button', { type: 'button', class: 'preset-btn' }, preset.label);
                    chip.addEventListener('click', () => {
                        const clear = chosen(preset);
                        value.value = clear ? '' : String(preset.value);
                        if (!clear) unit.value = preset.unit;
                        syncChips();
                    });
                    chips.push(chip);
                }
                presets = el('div', { class: 'resize-presets' }, ...chips);
                // Typing a size by hand must light the matching chip too, or the
                // two controls disagree about the same number.
                value.addEventListener('input', syncChips);
                unit.addEventListener('change', syncChips);
            }

            return {
                node: el('div', { class: 'setting-group' },
                    el('label', { for: `opt-${spec.id}`, class: 'input-label' }, spec.label),
                    el('div', { class: 'target-size-row' }, value, unit),
                    presets,
                    spec.hint ? el('div', { class: 'option-hint' }, spec.hint) : null),
                read: () => (value.value ? { value: value.value, unit: unit.value } : null),
            };
        }

        case 'trim': {
            const start = el('input', {
                type: 'text', class: 'input-field input-sm', id: `opt-${spec.id}-start`,
                placeholder: '0:00',
            });
            const end = el('input', {
                type: 'text', class: 'input-field input-sm', id: `opt-${spec.id}-end`,
                placeholder: 'end',
            });
            return {
                node: el('div', { class: 'setting-group' },
                    el('label', { for: `opt-${spec.id}-start`, class: 'input-label' }, spec.label),
                    el('div', { class: 'target-size-row' },
                        start, el('span', { class: 'resize-x' }, '→'), end),
                    spec.hint ? el('div', { class: 'option-hint' }, spec.hint) : null),
                read: () => (start.value || end.value
                    ? { start: start.value, end: end.value }
                    : null),
            };
        }

        default:
            return null;
    }
}

/**
 * Render the controls for a target into `host`.
 *
 * Returns `readOptions()`, which collects the current values into the plain
 * object the engine contract expects.
 */
export function renderOptions(host, targetId, previous = {}) {
    const controls = new Map();
    const nodes = [];

    for (const spec of optionsFor(targetId)) {
        const control = buildControl(spec, previous[spec.id]);
        if (!control) continue;
        controls.set(spec.id, control);
        nodes.push(control.node);
    }

    host.replaceChildren(...nodes);
    host.hidden = nodes.length === 0;

    return function readOptions() {
        const values = {};
        for (const [key, control] of controls) values[key] = control.read();
        return values;
    };
}
