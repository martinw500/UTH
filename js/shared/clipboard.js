import { announce } from './notify.js';

/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard is undefined outside a secure context, which includes
 * plain-http local dev, so the deprecated execCommand path is still needed.
 */
export async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Permission denied or not focused; fall through.
        }
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        // Keep it off-screen but still selectable; display:none would break it.
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}

/**
 * Copy, then flash confirmation on the button and announce it.
 *
 * The visual "Copied!" swap is invisible to screen readers on its own.
 */
export async function copyWithFeedback(button, text, { label = 'Copied!', ms = 1400 } = {}) {
    const ok = await copyText(text);
    if (!button) return ok;

    if (button.dataset.idleLabel === undefined) button.dataset.idleLabel = button.innerHTML;
    button.textContent = ok ? label : 'Copy failed';
    button.classList.toggle('copied', ok);
    announce(ok ? `${label} ${text}` : 'Copy failed');

    clearTimeout(Number(button.dataset.copyTimer));
    button.dataset.copyTimer = String(setTimeout(() => {
        button.innerHTML = button.dataset.idleLabel;
        delete button.dataset.idleLabel;
        delete button.dataset.copyTimer;
        button.classList.remove('copied');
    }, ms));

    return ok;
}
