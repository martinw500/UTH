// Inline, announced status messages.
//
// Replaces the mix of alert() (image editor), silent `return` (colour picker)
// and per-tool showError implementations. Screen readers get the message
// because the host element is a live region.

const LEVEL_CLASS = {
    error: 'notice-error',
    success: 'notice-success',
    info: 'notice-info',
};

function prepare(host) {
    if (!host || host.dataset.noticeReady === 'true') return host;
    // assertive would interrupt whatever the user is doing mid-task; polite
    // still announces, just at the next natural pause.
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.dataset.noticeReady = 'true';
    return host;
}

/**
 * Show a message in `host`.
 *
 * `html` is opt-in and must only ever be used with strings this codebase
 * controls -- never with an API response or a filename.
 */
export function notify(host, message, { level = 'info', html = false } = {}) {
    if (!prepare(host)) return;
    for (const cls of Object.values(LEVEL_CLASS)) host.classList.remove(cls);
    host.classList.add(LEVEL_CLASS[level] || LEVEL_CLASS.info, 'active');
    if (html) host.innerHTML = message;
    else host.textContent = message;
    host.hidden = false;
}

export const showError = (host, message, opts = {}) =>
    notify(host, message, { ...opts, level: 'error' });

export const showSuccess = (host, message, opts = {}) =>
    notify(host, message, { ...opts, level: 'success' });

export function clearNotice(host) {
    if (!host) return;
    host.classList.remove('active', ...Object.values(LEVEL_CLASS));
    host.textContent = '';
    host.hidden = true;
}

/**
 * Announce something without displaying it, for state changes that are obvious
 * visually but silent to a screen reader (e.g. "Copied!", "12 tools shown").
 */
export function announce(message) {
    let region = document.getElementById('uth-live-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'uth-live-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        region.className = 'visually-hidden';
        document.body.appendChild(region);
    }
    // Re-setting identical text is not re-announced; the clear forces it.
    region.textContent = '';
    setTimeout(() => { region.textContent = message; }, 50);
}
