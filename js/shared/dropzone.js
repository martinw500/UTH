// One dropzone implementation for every tool.
//
// Replaces two copy-pasted versions that had drifted apart, and closes a real
// hole: both validated the file TYPE on drop but not on the file-picker path,
// where the `accept` attribute is only a hint the browser may ignore.

/** Does `file` satisfy an accept list of MIME globs and/or extensions? */
export function matchesAccept(file, accept) {
    if (!accept || accept.length === 0) return true;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    return accept.some((rule) => {
        const r = rule.trim().toLowerCase();
        if (!r) return false;
        if (r.startsWith('.')) return name.endsWith(r);
        if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
        return type === r;
    });
}

/**
 * Wire up a dropzone.
 *
 * @param {object}   opts
 * @param {Element}  opts.dropzone   Drop target.
 * @param {Element}  opts.fileInput  Hidden <input type=file>.
 * @param {Element} [opts.browseBtn] Click target that opens the picker.
 * @param {string[]}[opts.accept]    MIME globs ('image/*') and/or extensions.
 * @param {boolean} [opts.multiple]  Accept more than one file.
 * @param {number}  [opts.maxBytes]  Per-file size cap.
 * @param {number}  [opts.maxFiles]  Cap on how many files are taken at once.
 * @param {(files: File[]) => void} opts.onFiles
 * @param {(rejection: {file: File|null, reason: string, message: string}) => void} [opts.onReject]
 * @param {boolean} [opts.paste]     Also accept files pasted onto the document.
 * @returns {{destroy: () => void}}
 */
export function createDropzone({
    dropzone,
    fileInput,
    browseBtn = null,
    accept = [],
    multiple = false,
    maxBytes = Infinity,
    maxFiles = Infinity,
    onFiles,
    onReject = () => {},
    paste = false,
}) {
    if (!dropzone || !fileInput) throw new Error('createDropzone needs dropzone and fileInput');

    // dragenter/dragleave fire for every child element, so a plain toggle makes
    // the highlight flicker as the pointer crosses inner nodes. Counting
    // enter/leave pairs is the standard fix.
    let dragDepth = 0;

    const setDragging = (on) => dropzone.classList.toggle('dragover', on);

    function accepted(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return [];

        const kept = [];
        for (const file of files) {
            if (!matchesAccept(file, accept)) {
                onReject({ file, reason: 'type', message: `${file.name} is not a supported file type.` });
                continue;
            }
            if (file.size > maxBytes) {
                onReject({ file, reason: 'size', message: `${file.name} is too large.` });
                continue;
            }
            kept.push(file);
        }

        const limit = multiple ? maxFiles : 1;
        if (kept.length > limit) {
            onReject({
                file: null,
                reason: 'count',
                message: `Only the first ${limit} file${limit > 1 ? 's' : ''} will be used.`,
            });
            return kept.slice(0, limit);
        }
        return kept;
    }

    function deliver(fileList) {
        const files = accepted(fileList);
        if (files.length) onFiles(files);
    }

    const onDragEnter = (e) => { e.preventDefault(); dragDepth += 1; setDragging(true); };
    const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onDragLeave = (e) => {
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) setDragging(false);
    };
    const onDrop = (e) => {
        e.preventDefault();
        dragDepth = 0;
        setDragging(false);
        deliver(e.dataTransfer?.files);
    };

    const onZoneClick = (e) => {
        // Let a real control inside the zone handle its own click.
        if (e.target.closest('button, a, input, select, textarea') && e.target !== browseBtn) return;
        fileInput.click();
    };
    const onBrowseClick = (e) => { e.preventDefault(); e.stopPropagation(); fileInput.click(); };
    const onZoneKey = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    };

    const onChange = () => {
        deliver(fileInput.files);
        // Reset so choosing the same file twice in a row still fires change.
        fileInput.value = '';
    };

    const onPaste = (e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (files.length) { e.preventDefault(); deliver(files); }
    };

    if (multiple) fileInput.multiple = true;
    if (accept.length && !fileInput.getAttribute('accept')) {
        fileInput.setAttribute('accept', accept.join(','));
    }

    dropzone.addEventListener('dragenter', onDragEnter);
    dropzone.addEventListener('dragover', onDragOver);
    dropzone.addEventListener('dragleave', onDragLeave);
    dropzone.addEventListener('drop', onDrop);
    dropzone.addEventListener('click', onZoneClick);
    dropzone.addEventListener('keydown', onZoneKey);
    fileInput.addEventListener('change', onChange);
    if (browseBtn) browseBtn.addEventListener('click', onBrowseClick);
    if (paste) document.addEventListener('paste', onPaste);

    return {
        destroy() {
            dropzone.removeEventListener('dragenter', onDragEnter);
            dropzone.removeEventListener('dragover', onDragOver);
            dropzone.removeEventListener('dragleave', onDragLeave);
            dropzone.removeEventListener('drop', onDrop);
            dropzone.removeEventListener('click', onZoneClick);
            dropzone.removeEventListener('keydown', onZoneKey);
            fileInput.removeEventListener('change', onChange);
            if (browseBtn) browseBtn.removeEventListener('click', onBrowseClick);
            if (paste) document.removeEventListener('paste', onPaste);
        },
    };
}
