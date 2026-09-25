import fs from 'node:fs';
import path from 'node:path';

import {
    TOOLS,
    TOOL_COUNT,
    CATEGORIES,
    toolsInCategory,
    findTool,
} from '../js/shared/tools.js';
import { searchTools } from '../js/shared/search.js';

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const home = read('index.html');

// ============================================
// The registry itself
// ============================================

describe('the registry is internally consistent', () => {
    test('ids and hrefs are unique', () => {
        expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
        expect(new Set(TOOLS.map((t) => t.href)).size).toBe(TOOLS.length);
    });

    test('every tool names a category that exists', () => {
        const known = new Set(CATEGORIES.map((c) => c.id));
        for (const tool of TOOLS) expect(known.has(tool.category)).toBe(true);
    });

    test('no category is empty', () => {
        for (const category of CATEGORIES) {
            expect(toolsInCategory(category.id).length).toBeGreaterThan(0);
        }
    });

    test('every tool page actually exists on disk', () => {
        for (const tool of TOOLS) {
            expect(fs.existsSync(path.join(ROOT, tool.href))).toBe(true);
        }
    });

    test('every tone is defined in the stylesheet', () => {
        const css = read('styles.css');
        for (const tool of TOOLS) expect(css).toContain(`.${tool.tone}`);
    });

    // 'browser' vs 'server' is the distinction users care about: browser means
    // the file never leaves the device, which is the site's main claim.
    test('every tool says where it runs', () => {
        for (const tool of TOOLS) expect(['browser', 'server']).toContain(tool.runs);
    });

    test('only the two downloaders use a server', () => {
        const server = TOOLS.filter((t) => t.runs === 'server').map((t) => t.id).sort();
        expect(server).toEqual(['instagram-downloader', 'youtube-downloader']);
    });

    test('the registry is frozen against accidental mutation', () => {
        expect(Object.isFrozen(TOOLS)).toBe(true);
        expect(Object.isFrozen(CATEGORIES)).toBe(true);
        for (const tool of TOOLS) expect(Object.isFrozen(tool)).toBe(true);
    });

    test('findTool works, and does not invent tools', () => {
        expect(findTool('convert').title).toBe('File Converter');
        expect(findTool('nope')).toBeNull();
    });
});

// ============================================
// Registry ↔ homepage parity
//
// The grid stays STATIC HTML — deployed-site.test.js fetches raw HTML with no
// JavaScript, and a crawler sees the same. So the registry does not render the
// page; this test is what stops the two drifting.
// ============================================

describe('the homepage matches the registry', () => {
    const cardCount = (home.match(/class="tool-card"/g) || []).length;

    test('there is a card for every tool and no others', () => {
        expect(cardCount).toBe(TOOL_COUNT);
    });

    test.each(TOOLS.map((t) => [t.id, t]))('%s is on the homepage', (_id, tool) => {
        expect(home).toContain(`href="${tool.href}"`);
        expect(home).toContain(tool.title);
        expect(home).toContain(tool.desc);
    });

    test.each(TOOLS.map((t) => [t.id, t]))('%s carries its keywords', (_id, tool) => {
        expect(home).toContain(`data-keywords="${tool.keywords}"`);
    });

    test.each(TOOLS.map((t) => [t.id, t]))('%s uses its registry tone', (_id, tool) => {
        const card = home.slice(home.indexOf(`href="${tool.href}"`));
        expect(card.slice(0, 600)).toContain(tool.tone);
    });

    test.each(CATEGORIES.map((c) => [c.id, c]))('the %s section exists', (_id, category) => {
        expect(home).toContain(`id="cat-${category.id}"`);
        expect(home).toContain(category.label);
    });

    // Both counters are hardcoded and script.js only recomputes #visibleCount,
    // so a stale #toolCount ships a wrong number to every visitor.
    test('both counters agree with the registry', () => {
        expect(home).toMatch(new RegExp(`id="toolCount">${TOOL_COUNT}<`));
        expect(home).toMatch(new RegExp(`id="visibleCount">${TOOL_COUNT} tools<`));
    });

    test('each category count in the rail is right', () => {
        for (const category of CATEGORIES) {
            const link = home.slice(home.indexOf(`data-cat-link="${category.id}"`));
            expect(link.slice(0, 200)).toContain(`>${toolsInCategory(category.id).length}<`);
        }
    });

    test('the grid is real HTML, not a placeholder for JS to fill', () => {
        const grid = home.slice(home.indexOf('id="toolsGrid"'));
        expect(grid).toContain('<a href=');
        expect(grid).toContain('tool-card-title');
    });
});

// ============================================
// Search
// ============================================

describe('search', () => {
    // Against the ranked search the homepage really uses. This file used to
    // test matchesQuery, an old substring filter nothing called any more.
    test.each([
        ['webp', 'convert'],
        ['mp3', 'audio-converter'],
        ['favicon', 'favicon-generator'],
        ['reel', 'instagram-downloader'],
        ['hex', 'color-converter'],
        ['crop', 'image-converter'],
        ['merge', 'pdf-tools'],
    ])('searching %p finds %s', (query, id) => {
        expect(searchTools(query).direct.map((entry) => entry.tool.id)).toContain(id);
    });

    test('each homepage card carries its registry keywords', () => {
        for (const tool of TOOLS) {
            const card = home.slice(
                home.indexOf(`href="${tool.href}"`),
                home.indexOf(`href="${tool.href}"`) + 1200,
            );
            expect(card).toContain(tool.keywords);
        }
    });
});
