import {
    SYNONYMS,
    tokenise,
    expandQuery,
    editDistance,
    typoBudget,
    scoreTerm,
    scoreTool,
    searchTools,
    suggestSpelling,
    RELATED_COVERAGE,
    MAX_RELATED,
} from '../js/shared/search.js';

import { TOOLS, findTool } from '../js/shared/tools.js';

/** Ids of the direct hits, in rank order. */
const direct = (query) => searchTools(query).direct.map((e) => e.tool.id);
const related = (query) => searchTools(query).related.map((e) => e.tool.id);
const top = (query) => direct(query)[0];

describe('tokenise', () => {
    test('splits on anything that is not a letter or digit', () => {
        expect(tokenise('MP4, WEBM — and GIF!')).toEqual(['mp4', 'webm', 'and', 'gif']);
    });

    test('handles empty and missing input', () => {
        expect(tokenise('')).toEqual([]);
        expect(tokenise(null)).toEqual([]);
        expect(tokenise(undefined)).toEqual([]);
    });
});

describe('expandQuery', () => {
    test('a word always searches for itself', () => {
        expect(expandQuery('convert')[0].variants).toContain('convert');
    });

    test('synonyms are added, not substituted', () => {
        const [term] = expandQuery('shrink');
        expect(term.word).toBe('shrink');
        expect(term.variants).toContain('shrink');
        expect(term.variants).toContain('compress');
    });

    // "make my photo smaller" is four stop words away from being a search.
    test('noise words are dropped', () => {
        expect(expandQuery('make my photo smaller').map((t) => t.word))
            .toEqual(['photo', 'smaller']);
    });

    // Dropping everything would turn a query into "show all", which reads as
    // the search being broken.
    test('a query of nothing but noise still searches for something', () => {
        expect(expandQuery('the a of').length).toBeGreaterThan(0);
    });

    test('variants are de-duplicated', () => {
        const [term] = expandQuery('jpg');
        expect(new Set(term.variants).size).toBe(term.variants.length);
    });

    test('an empty query expands to nothing', () => {
        expect(expandQuery('')).toEqual([]);
        expect(expandQuery('   ')).toEqual([]);
    });
});

describe('editDistance', () => {
    test.each([
        ['convert', 'convert', 0],
        ['convrt', 'convert', 1],
        ['covnert', 'convert', 2],
        ['image', 'imag', 1],
        ['png', 'jpg', 2],
    ])('%s -> %s is %i', (a, b, expected) => {
        expect(editDistance(a, b, 3)).toBe(expected);
    });

    // The cap is what keeps this cheap; past it the exact number is useless.
    test('it stops counting past the cap', () => {
        expect(editDistance('completely', 'different', 2)).toBeGreaterThan(2);
    });

    test('a big length difference is rejected immediately', () => {
        expect(editDistance('a', 'abcdefgh', 2)).toBeGreaterThan(2);
    });
});

describe('typoBudget', () => {
    // At three letters one edit reaches half the dictionary: "gif" would match
    // "if", "git" and "of".
    test('short words get no tolerance', () => {
        expect(typoBudget('gif')).toBe(0);
        expect(typoBudget('qr')).toBe(0);
    });

    test('medium words get one edit', () => {
        expect(typoBudget('image')).toBe(1);
    });

    test('long words get two', () => {
        expect(typoBudget('instagram')).toBe(2);
    });
});

describe('scoring', () => {
    test('a title match outranks a keyword match', () => {
        const [term] = expandQuery('favicon');
        const inTitle = scoreTerm(findTool('favicon-generator'), term).score;
        const inKeywords = scoreTerm(findTool('image-converter'), term).score;
        expect(inTitle).toBeGreaterThan(inKeywords);
    });

    test('a prefix scores lower than a whole word', () => {
        const whole = scoreTerm(findTool('pdf-tools'), expandQuery('merge')[0]).score;
        const prefix = scoreTerm(findTool('pdf-tools'), expandQuery('merg')[0]).score;
        expect(whole).toBeGreaterThan(prefix);
        expect(prefix).toBeGreaterThan(0);
    });

    test('a typo match is weaker than any real match, and is flagged', () => {
        const real = scoreTerm(findTool('pdf-tools'), expandQuery('merge')[0]);
        const typo = scoreTerm(findTool('pdf-tools'), expandQuery('merje')[0]);
        expect(typo.score).toBeGreaterThan(0);
        expect(typo.score).toBeLessThan(real.score);
        expect(typo.fuzzy).toBe(true);
        expect(real.fuzzy).toBe(false);
    });

    test('an unrelated term scores nothing', () => {
        expect(scoreTerm(findTool('qr-generator'), expandQuery('spreadsheet')[0]).score).toBe(0);
    });

    // Matching both words of "compress image" should beat matching one twice.
    test('covering more of the query scores higher', () => {
        const terms = expandQuery('compress image');
        const both = scoreTool(findTool('image-converter'), terms);
        const one = scoreTool(findTool('qr-generator'), terms);
        expect(both.matched).toBe(2);
        expect(both.score).toBeGreaterThan(one.score);
    });

    test('an empty query scores nothing rather than dividing by zero', () => {
        const result = scoreTool(findTool('convert'), []);
        expect(result.score).toBe(0);
        expect(Number.isFinite(result.score)).toBe(true);
    });
});

describe('finding the obvious thing', () => {
    test.each([
        ['favicon', 'favicon-generator'],
        ['qr code', 'qr-generator'],
        ['merge pdf', 'pdf-tools'],
        ['youtube', 'youtube-downloader'],
        ['instagram reel', 'instagram-downloader'],
        ['hex rgb', 'color-converter'],
        ['crop', 'image-converter'],
    ])('%p puts %s first', (query, id) => {
        expect(top(query)).toBe(id);
    });

    test('an empty query returns everything, unranked', () => {
        const { direct: all, related: none } = searchTools('');
        expect(all).toHaveLength(TOOLS.length);
        expect(none).toEqual([]);
    });
});

describe('describing an intent rather than a name', () => {
    // The reason synonyms exist: people say what they want to do.
    test.each([
        ['shrink my photo', 'image-converter'],
        ['make picture smaller', 'image-converter'],
        ['logo icon', 'favicon-generator'],
        ['pull the song out of a video', 'audio-converter'],
        ['combine documents', 'pdf-tools'],
    ])('%p finds %s', (query, id) => {
        expect([...direct(query), ...related(query)]).toContain(id);
    });

    test('British and American spellings both work', () => {
        expect(top('color picker')).toBe('color-converter');
        expect(top('colour picker')).toBe('color-converter');
    });

    test('shorthand works', () => {
        expect(top('yt')).toBe('youtube-downloader');
        expect(top('insta')).toBe('instagram-downloader');
    });

    test('every synonym target actually appears somewhere in the registry', () => {
        const corpus = TOOLS
            .map((t) => `${t.title} ${t.desc} ${t.keywords}`.toLowerCase())
            .join(' ');
        const missing = [];
        for (const targets of Object.values(SYNONYMS)) {
            for (const target of targets) {
                if (!corpus.includes(target)) missing.push(target);
            }
        }
        expect([...new Set(missing)]).toEqual([]);
    });
});

describe('typos', () => {
    test.each([
        ['convrt', 'convert'],
        ['favicn', 'favicon-generator'],
        ['instgram', 'instagram-downloader'],
    ])('%p still finds something', (query) => {
        const { direct: hits, related: near } = searchTools(query);
        expect([...hits, ...near].length).toBeGreaterThan(0);
    });

    // A typo match is a guess, so it belongs under "related", not presented as
    // confidently as an exact hit.
    test('a typo-only match is offered as related, not direct', () => {
        const { direct: hits, related: near } = searchTools('merje');
        expect(hits).toEqual([]);
        expect(near.map((e) => e.tool.id)).toContain('pdf-tools');
    });
});

describe('near misses', () => {
    // The whole point: a partly-matching query used to produce a blank page.
    test('a query where only some terms match still returns suggestions', () => {
        const { direct: hits, related: near } = searchTools('compress spreadsheet');
        expect(hits).toEqual([]);
        expect(near.length).toBeGreaterThan(0);
        expect(near.map((e) => e.tool.id)).toContain('image-converter');
    });

    test('direct hits and related results never overlap', () => {
        for (const query of ['convert image', 'merje', 'compress spreadsheet', 'pdf']) {
            const { direct: hits, related: near } = searchTools(query);
            const ids = new Set(hits.map((e) => e.tool.id));
            for (const entry of near) expect(ids.has(entry.tool.id)).toBe(false);
        }
    });

    test('genuine nonsense returns nothing at all', () => {
        const { direct: hits, related: near } = searchTools('xylophone quarterly');
        expect(hits).toEqual([]);
        expect(near).toEqual([]);
    });

    test('results are ordered best first', () => {
        const { direct: hits } = searchTools('convert');
        const scores = hits.map((e) => e.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
});

describe('suggestSpelling', () => {
    test('offers a correction for a misspelling', () => {
        expect(suggestSpelling('favicn')).toEqual({ from: 'favicn', to: 'favicon' });
    });

    // Suggesting a correction for a word the user got right is worse than
    // saying nothing.
    test('says nothing when the word was already right', () => {
        expect(suggestSpelling('favicon')).toBeNull();
        expect(suggestSpelling('merge pdf')).toBeNull();
    });

    test('says nothing when it has no idea', () => {
        expect(suggestSpelling('xylophone')).toBeNull();
    });

    test('says nothing for an empty query', () => {
        expect(suggestSpelling('')).toBeNull();
    });
});

describe('suggestion quality', () => {
    // Matching one word of a five-word query is noise, not a suggestion:
    // "pull the song out of a video" would otherwise also suggest every tool
    // that merely mentions video.
    test('a suggestion has to cover a fair share of the query', () => {
        const { related: near } = searchTools('pull the song out of a video');
        for (const entry of near) {
            expect(entry.matched / entry.total).toBeGreaterThanOrEqual(RELATED_COVERAGE);
        }
    });

    test('suggestions are capped, or they are just the full list again', () => {
        for (const query of ['image video audio', 'convert', 'photo']) {
            expect(searchTools(query).related.length).toBeLessThanOrEqual(MAX_RELATED);
        }
    });

    test('a half-matched two-word query still suggests something', () => {
        expect(searchTools('compress spreadsheet').related.length).toBeGreaterThan(0);
    });
});
