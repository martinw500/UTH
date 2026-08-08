// Tool search: ranking, synonyms and near misses.
//
// The point of this module is that a query which does not match exactly should
// still show something useful. People type what they want to *do* ("make my
// photo smaller"), not the name of the tool that does it, and they typo. A
// binary substring filter answers all of that with an empty page.
//
// Pure and DOM-free, so every rule below is unit-testable.

import { TOOLS } from './tools.js';

/**
 * What people type -> what the registry actually says.
 *
 * Deliberately one-directional and generous: an entry costs nothing if it is
 * never typed, but a missing one is an empty result page. British and American
 * spellings both appear because the site uses British and users do not.
 */
export const SYNONYMS = Object.freeze({
    // intent
    shrink: ['compress', 'resize'],
    smaller: ['compress', 'resize'],
    reduce: ['compress', 'resize'],
    compress: ['compress', 'quality'],
    optimise: ['compress'],
    optimize: ['compress'],
    scale: ['resize'],
    dimensions: ['resize'],
    quality: ['compress', 'quality'],
    change: ['convert'],
    turn: ['convert', 'rotate'],
    export: ['convert', 'save'],
    save: ['download', 'save'],
    extract: ['extract'],
    combine: ['merge'],
    join: ['merge'],
    cut: ['trim', 'crop'],
    split: ['split'],

    // things
    picture: ['image', 'photo'],
    pic: ['image', 'photo'],
    pics: ['image', 'photo'],
    photo: ['image', 'photo'],
    photos: ['image', 'photo'],
    screenshot: ['image', 'png'],
    movie: ['video'],
    film: ['video'],
    clip: ['video'],
    song: ['audio', 'music'],
    music: ['audio', 'music'],
    sound: ['audio'],
    track: ['audio'],
    soundtrack: ['audio', 'extract'],
    doc: ['pdf', 'document'],
    document: ['pdf', 'document'],
    logo: ['favicon', 'icon'],
    brand: ['favicon', 'icon'],
    thumbnail: ['image', 'resize'],
    barcode: ['qr'],

    // formats and spellings
    jpeg: ['jpg', 'jpeg'],
    jpg: ['jpg', 'jpeg'],
    transparent: ['png'],
    transparency: ['png'],
    color: ['colour', 'color'],
    colors: ['colour', 'color'],
    colour: ['colour', 'color'],
    colours: ['colour', 'color'],
    grayscale: ['greyscale', 'grayscale'],
    greyscale: ['greyscale', 'grayscale'],

    // shorthand
    yt: ['youtube'],
    ig: ['instagram'],
    insta: ['instagram'],
    vid: ['video'],
    pdfs: ['pdf'],
    ico: ['favicon', 'icon'],
});

/** Noise words that would otherwise match everything. */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'to', 'of', 'my', 'me', 'i', 'is', 'it', 'for', 'from',
    'into', 'in', 'on', 'and', 'or', 'with', 'how', 'do', 'can', 'want', 'need',
    'make', 'get', 'file', 'files', 'online', 'free', 'tool',
]);

const WORD_RE = /[a-z0-9]+/g;

export function tokenise(text) {
    return String(text ?? '').toLowerCase().match(WORD_RE) ?? [];
}

/**
 * Query -> the terms actually searched for.
 *
 * Each token keeps itself and gains any synonyms, so "shrink photo" searches
 * for shrink/compress/resize/smaller and photo/image. Stop words are dropped
 * unless that would leave nothing — "the" alone should still do something.
 */
export function expandQuery(query) {
    const raw = tokenise(query);
    const meaningful = raw.filter((word) => !STOP_WORDS.has(word));
    const base = meaningful.length ? meaningful : raw;

    return base.map((word) => {
        const expansions = SYNONYMS[word] ?? [];
        return Object.freeze({
            word,
            variants: Object.freeze([...new Set([word, ...expansions])]),
        });
    });
}

/**
 * Levenshtein distance, capped.
 *
 * Bailing out once the best possible result exceeds `max` keeps this cheap;
 * we only ever care whether a word is *nearly* right.
 */
export function editDistance(a, b, max = 2) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        let rowBest = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
            if (current[j] < rowBest) rowBest = current[j];
        }
        if (rowBest > max) return max + 1;
        previous = current;
    }
    return previous[b.length];
}

/**
 * How much typo tolerance a word of this length earns.
 *
 * Short words get none: at three letters, one edit reaches half the dictionary,
 * so "gif" would match "if", "git" and "of".
 */
export function typoBudget(word) {
    if (word.length <= 3) return 0;
    if (word.length <= 6) return 1;
    return 2;
}

/** Field weights. Title beats keywords beats description. */
const WEIGHT = Object.freeze({
    titleExact: 12,
    titlePrefix: 8,
    keywordExact: 7,
    keywordPrefix: 4,
    descExact: 4,
    descPrefix: 2,
    fuzzy: 2,
});

/** The searchable fields of a tool, tokenised once. */
function fieldsOf(tool) {
    return {
        title: tokenise(tool.title),
        keywords: tokenise(tool.keywords),
        desc: tokenise(tool.desc),
    };
}

const fieldCache = new WeakMap();
function cachedFields(tool) {
    if (!fieldCache.has(tool)) fieldCache.set(tool, fieldsOf(tool));
    return fieldCache.get(tool);
}

/**
 * Best score for a single query term against one tool.
 *
 * Returns `{ score, fuzzy }` — `fuzzy` marks a match that only landed because
 * of typo tolerance, so the caller can present it as a suggestion rather than
 * a confident hit.
 */
export function scoreTerm(tool, term) {
    const fields = cachedFields(tool);
    let best = 0;
    let bestFuzzy = false;

    const consider = (score, isFuzzy) => {
        if (score > best) { best = score; bestFuzzy = isFuzzy; }
    };

    for (const variant of term.variants) {
        for (const [field, exact, prefix] of [
            [fields.title, WEIGHT.titleExact, WEIGHT.titlePrefix],
            [fields.keywords, WEIGHT.keywordExact, WEIGHT.keywordPrefix],
            [fields.desc, WEIGHT.descExact, WEIGHT.descPrefix],
        ]) {
            for (const word of field) {
                if (word === variant) consider(exact, false);
                else if (word.startsWith(variant)) consider(prefix, false);
            }
        }
    }

    // Only reach for typo tolerance if nothing matched outright.
    if (best === 0) {
        const budget = typoBudget(term.word);
        if (budget > 0) {
            for (const field of [fields.title, fields.keywords, fields.desc]) {
                for (const word of field) {
                    if (word.length <= 3) continue;
                    if (editDistance(term.word, word, budget) <= budget) {
                        consider(WEIGHT.fuzzy, true);
                    }
                }
            }
        }
    }

    return { score: best, fuzzy: bestFuzzy };
}

/** Below this, a term is treated as not found at all. */
const MATCH_THRESHOLD = 1;

/**
 * Score one tool against an expanded query.
 *
 * `matched` counts how many query terms landed. A result where every term
 * landed is a direct hit; one where only some did is *related*, and worth
 * showing separately rather than discarding.
 */
export function scoreTool(tool, terms) {
    if (!terms.length) return { score: 0, matched: 0, total: 0, fuzzy: false };

    let score = 0;
    let matched = 0;
    let fuzzy = false;

    for (const term of terms) {
        const result = scoreTerm(tool, term);
        if (result.score >= MATCH_THRESHOLD) {
            matched += 1;
            score += result.score;
            if (result.fuzzy) fuzzy = true;
        }
    }

    // Reward covering more of what was asked for, so a tool matching both words
    // of "compress image" beats one matching "image" twice as strongly.
    const coverage = matched / terms.length;
    return { score: score * (0.5 + 0.5 * coverage), matched, total: terms.length, fuzzy };
}

/**
 * Search, split into confident hits and near misses.
 *
 * `direct` — every term matched, and none of them only via typo tolerance.
 * `related` — some terms matched, or a term only matched fuzzily. These are
 *   what turn an empty page into a useful one; the UI should label them as
 *   suggestions rather than results.
 */
/** A suggestion has to cover at least this much of the query to be worth making. */
export const RELATED_COVERAGE = 0.5;

/** More than a handful of "you might also want" is just the full list again. */
export const MAX_RELATED = 4;

export function searchTools(query, tools = TOOLS) {
    const terms = expandQuery(query);
    if (!terms.length) {
        return { terms, direct: tools.map((tool) => ({ tool, score: 0 })), related: [] };
    }

    const scored = tools
        .map((tool) => ({ tool, ...scoreTool(tool, terms) }))
        .filter((entry) => entry.matched > 0)
        .sort((a, b) => b.score - a.score || a.tool.title.localeCompare(b.tool.title));

    const direct = scored.filter((entry) => entry.matched === entry.total && !entry.fuzzy);
    const directSet = new Set(direct);

    // Matching one word of a five-word query is not a suggestion, it is noise:
    // "pull the song out of a video" would otherwise "also suggest" every tool
    // that happens to mention video.
    const related = scored
        .filter((entry) => !directSet.has(entry))
        .filter((entry) => entry.matched / entry.total >= RELATED_COVERAGE)
        .slice(0, MAX_RELATED);

    return { terms, direct, related };
}

/**
 * A short "did you mean" for a term that only matched fuzzily.
 *
 * Returns null when the term was fine as typed — suggesting a correction for a
 * word the user got right is worse than saying nothing.
 */
export function suggestSpelling(query, tools = TOOLS) {
    for (const term of expandQuery(query)) {
        let exact = false;
        let best = null;
        let bestDistance = Infinity;

        for (const tool of tools) {
            const fields = cachedFields(tool);
            for (const word of [...fields.title, ...fields.keywords]) {
                if (word === term.word || word.startsWith(term.word)) { exact = true; break; }
                const budget = typoBudget(term.word);
                if (budget === 0 || word.length <= 3) continue;
                const distance = editDistance(term.word, word, budget);
                if (distance <= budget && distance < bestDistance) {
                    bestDistance = distance;
                    best = word;
                }
            }
            if (exact) break;
        }

        if (!exact && best) return { from: term.word, to: best };
    }
    return null;
}
