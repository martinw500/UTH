// Tidying what OCR returns, so it pastes cleanly. Pure, so it can be tested
// without a browser; the recogniser itself is in ocr.js.
//
// Line breaks are kept: they carry addresses, lists and tables, and joining
// them is a guess about layout that is wrong as often as it is right. What is
// changed is only what is never wanted.

/**
 * - A word hyphenated across a line break is rejoined ("exam-\nple" -> "example"),
 *   but only between lowercase letters, so "COVID-\n19" and "well-\nKnown" stay.
 * - Trailing spaces go, and runs of spaces inside a line become one.
 * - More than one blank line becomes one, and the ends are trimmed.
 */
export function tidyOcrText(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\f/g, '\n')
        .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Join several pages' text into one document, headed by where each came
 * from when there is more than one.
 *
 * @param {{source: string, text: string}[]} parts
 */
export function joinOcrPages(parts) {
    const kept = parts.filter((part) => part.text.trim());
    if (kept.length <= 1 && parts.length <= 1) return kept[0]?.text ?? '';
    return parts
        .map((part) => `— ${part.source} —\n${part.text.trim() || '(no text found)'}`)
        .join('\n\n');
}
