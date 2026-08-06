// Thin DOM helpers. Deliberately small -- this is not a framework.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
export const byId = (id) => document.getElementById(id);

/**
 * Look up several elements by id at once.
 *
 * Tool scripts used to grab ~40 elements with bare getElementById calls, so a
 * single renamed id threw a TypeError on page load with no clue which one.
 * Missing ids are reported together, by name.
 */
export function requireIds(...ids) {
    const found = {};
    const missing = [];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) found[id] = el;
        else missing.push(id);
    }
    if (missing.length) {
        throw new Error(`Missing required element(s): #${missing.join(', #')}`);
    }
    return found;
}

/** Create an element with attributes and children in one call. */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key in node && key !== 'list') node[key] = value;
        else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child);
    }
    return node;
}

export const show = (node) => { if (node) node.hidden = false; };
export const hide = (node) => { if (node) node.hidden = true; };

/** Mark a control busy: disabled, aria-busy, and an optional label swap. */
export function setBusy(button, busy, busyLabel) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busyLabel === undefined) return;
    if (busy) {
        if (button.dataset.idleLabel === undefined) button.dataset.idleLabel = button.innerHTML;
        button.textContent = busyLabel;
    } else if (button.dataset.idleLabel !== undefined) {
        button.innerHTML = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
    }
}

/** Trailing-edge debounce. */
export function debounce(fn, wait = 150) {
    let timer = null;
    const debounced = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
}
