// Signing: make a signature (draw, type or upload), then drag it onto the
// page as it is displayed. The placement is kept normalised (0..1) against
// the rendered page, like the image editor's crop -- measured in whatever
// pixels the stage happens to have, it would land somewhere else on a phone.
// pdf-ops.js turns it into PDF points through placeOnPage.

import { renderPage } from '../../js/shared/pdf-render.js';
import { decodeImageFile, canvasToBlob } from '../../js/shared/image.js';
import { createUrlSlot } from '../../js/shared/objecturl.js';
import { getString, setString, remove } from '../../js/shared/storage.js';
import { clamp } from '../../js/shared/format.js';

const REMEMBER_KEY = 'uth-signature';
const INK = '#111827';
const SCRIPT_FONT = 'italic 72px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive';
const MIN_WIDTH = 0.05;

/** Crop a canvas to its ink, with a little margin. Null when it is blank. */
function trimToInk(canvas) {
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let top = height; let left = width; let right = -1; let bottom = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (data[(y * width + x) * 4 + 3] > 16) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    if (right < 0) return null;
    const pad = 4;
    const out = document.createElement('canvas');
    out.width = right - left + 1 + pad * 2;
    out.height = bottom - top + 1 + pad * 2;
    out.getContext('2d').drawImage(canvas, left - pad, top - pad, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}

export function createSigner({ ui, docFor, onChange }) {
    const imgUrl = createUrlSlot();
    let signature = null; // { png: Uint8Array, aspect: h / w, dataUrl }
    let box = null; // { u, v, w, h } on the displayed page
    let pageAspect = 1; // displayed width / height
    let shown = null;
    let renderToken = 0;

    // ---- The pad ----
    const pad = ui.signPad;
    let padReady = false;
    let drawing = false;

    function sizePad() {
        const dpr = globalThis.devicePixelRatio || 1;
        pad.width = Math.max(1, Math.round(pad.clientWidth * dpr));
        pad.height = Math.max(1, Math.round(pad.clientHeight * dpr));
        const ctx = pad.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = INK;
        padReady = pad.clientWidth > 0;
    }

    const padPoint = (event) => {
        const rect = pad.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };

    pad.addEventListener('pointerdown', (event) => {
        if (!padReady) sizePad();
        drawing = true;
        pad.setPointerCapture(event.pointerId);
        const ctx = pad.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(...padPoint(event));
        ctx.lineTo(...padPoint(event)); // a tap leaves a dot
        ctx.stroke();
    });
    pad.addEventListener('pointermove', (event) => {
        if (!drawing) return;
        const ctx = pad.getContext('2d');
        ctx.lineTo(...padPoint(event));
        ctx.stroke();
    });
    const endStroke = () => {
        if (!drawing) return;
        drawing = false;
        const ink = trimToInk(pad);
        if (ink) { ui.signText.value = ''; use(ink); }
    };
    pad.addEventListener('pointerup', endStroke);
    pad.addEventListener('pointercancel', endStroke);

    function clearPad() {
        if (padReady) pad.getContext('2d').clearRect(0, 0, pad.width, pad.height);
    }

    // ---- The signature itself ----
    async function use(canvas, { store = true } = {}) {
        const blob = await canvasToBlob(canvas, 'image/png');
        signature = {
            png: new Uint8Array(await blob.arrayBuffer()),
            aspect: canvas.height / canvas.width,
            dataUrl: canvas.toDataURL('image/png'),
        };
        ui.signImg.src = imgUrl.set(blob);
        if (store && ui.signRemember.checked) setString(REMEMBER_KEY, signature.dataUrl);
        placeDefault();
        onChange();
    }

    function typed() {
        const text = ui.signText.value.trim();
        if (!text) return;
        const measure = document.createElement('canvas').getContext('2d');
        measure.font = SCRIPT_FONT;
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(measure.measureText(text).width) + 40;
        canvas.height = 110;
        const ctx = canvas.getContext('2d');
        ctx.font = SCRIPT_FONT;
        ctx.fillStyle = INK;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 20, 55);
        clearPad();
        use(trimToInk(canvas) ?? canvas);
    }

    async function uploaded(file) {
        const source = await decodeImageFile(file);
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d').drawImage(source, 0, 0);
        source.close?.();
        clearPad();
        ui.signText.value = '';
        use(canvas);
    }

    function clear() {
        clearPad();
        ui.signText.value = '';
        signature = null;
        box = null;
        imgUrl.revoke();
        ui.signBox.hidden = true;
        onChange();
    }

    // ---- Placement ----
    // Height follows width through the image's shape and the page's.
    const ratio = () => signature.aspect * pageAspect;

    function layout() {
        if (!signature || !box) { ui.signBox.hidden = true; return; }
        Object.assign(ui.signBox.style, {
            left: `${box.u * 100}%`, top: `${box.v * 100}%`,
            width: `${box.w * 100}%`, height: `${box.h * 100}%`,
        });
        ui.signBox.hidden = false;
    }

    function setBox({ u = box.u, v = box.v, w = box.w }) {
        let width = clamp(w, MIN_WIDTH, 1);
        let height = width * ratio();
        if (height > 1) { height = 1; width = height / ratio(); }
        box = {
            u: clamp(u, 0, 1 - width), v: clamp(v, 0, 1 - height), w: width, h: height,
        };
        layout();
    }

    function placeDefault() {
        if (!signature) return;
        if (box) { setBox({}); return; }
        // Bottom right, where a signature usually goes.
        const w = 0.3;
        box = { u: 0.62, v: 0.9 - w * ratio(), w, h: w * ratio() };
        setBox({});
    }

    let drag = null;
    ui.signBox.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        ui.signBox.setPointerCapture(event.pointerId);
        drag = { x: event.clientX, y: event.clientY, start: { ...box }, resize: event.target === ui.signHandle };
    });
    ui.signBox.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const rect = ui.signStage.getBoundingClientRect();
        const du = (event.clientX - drag.x) / rect.width;
        const dv = (event.clientY - drag.y) / rect.height;
        if (drag.resize) setBox({ ...drag.start, w: drag.start.w + du });
        else setBox({ ...drag.start, u: drag.start.u + du, v: drag.start.v + dv });
    });
    const endDrag = () => { drag = null; };
    ui.signBox.addEventListener('pointerup', endDrag);
    ui.signBox.addEventListener('pointercancel', endDrag);
    ui.signBox.addEventListener('keydown', (event) => {
        const step = 0.01;
        const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (!move || !box) return;
        event.preventDefault();
        if (event.shiftKey) setBox({ w: box.w + (move[0] || -move[1]) });
        else setBox({ u: box.u + move[0], v: box.v + move[1] });
    });

    // ---- The page ----
    async function renderStage() {
        if (!shown) return;
        const token = ++renderToken;
        const pageNumber = clamp(Math.round(Number(ui.signPage.value) || 1), 1, shown.pageCount);
        ui.signPage.value = String(pageNumber);
        const canvas = await renderPage(await docFor(shown), pageNumber, { width: ui.signStage.clientWidth || 480 });
        if (token !== renderToken) return;
        const target = ui.signPageCanvas;
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext('2d').drawImage(canvas, 0, 0);
        pageAspect = canvas.width / canvas.height;
        placeDefault();
    }

    function show(item) {
        if (!padReady) sizePad();
        if (shown === item) return;
        shown = item;
        ui.signPage.max = String(item.pageCount);
        ui.signPage.value = '1';
        renderStage().catch(() => {});
    }

    function hide() {
        shown = null;
        renderToken += 1;
    }

    // ---- Wiring ----
    ui.signText.addEventListener('change', typed);
    ui.signUploadBtn.addEventListener('click', () => ui.signUpload.click());
    ui.signUpload.addEventListener('change', () => {
        const [file] = ui.signUpload.files;
        if (file) uploaded(file).catch(() => {});
        ui.signUpload.value = '';
    });
    ui.signClearBtn.addEventListener('click', clear);
    ui.signPage.addEventListener('change', () => renderStage().catch(() => {}));
    ui.signRemember.addEventListener('change', () => {
        if (!ui.signRemember.checked) remove(REMEMBER_KEY);
        else if (signature) setString(REMEMBER_KEY, signature.dataUrl);
    });

    // A remembered signature comes back only because someone ticked the box.
    const remembered = getString(REMEMBER_KEY);
    if (remembered) {
        ui.signRemember.checked = true;
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            use(canvas, { store: false });
        };
        img.src = remembered;
    }

    return {
        show,
        hide,
        get ready() { return Boolean(signature && box); },
        value: () => ({ pageIndex: Number(ui.signPage.value) - 1, box: { ...box }, png: signature.png }),
    };
}
