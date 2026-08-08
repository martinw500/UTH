// Homepage: search and the category rail.
//
// A MODULE, so it can import the real ranking from js/shared/search.js rather
// than carry a copy. That logic is now large enough that a duplicate would
// certainly drift, and a drifted copy is exactly the failure this project has
// hit before.
//
// Being a module means this is deferred, which is fine: the grid is static HTML
// and complete before any of this runs. With JavaScript off you get every tool,
// grouped by category, and working links — just no filtering.

import { searchTools, suggestSpelling } from './js/shared/search.js';
import { TOOLS } from './js/shared/tools.js';

const searchInput = document.getElementById('searchInput');
const toolsGrid = document.getElementById('toolsGrid');
const visibleCount = document.getElementById('visibleCount');
const noResults = document.getElementById('noResults');
const resultsPane = document.getElementById('searchResults');
const resultsList = document.getElementById('resultsList');
const resultsHeading = document.getElementById('resultsHeading');
const relatedBlock = document.getElementById('relatedBlock');
const relatedList = document.getElementById('relatedList');
const spellingHint = document.getElementById('spellingHint');

if (toolsGrid) {
    /**
     * Cards, indexed by tool id, plus where each one lives.
     *
     * Searching moves cards into a single ranked list, because ranking across
     * category sections is impossible while they stay in separate containers.
     * Clearing the query puts them back — hence remembering the home.
     */
    const cards = new Map();
    for (const card of toolsGrid.querySelectorAll('.tool-card')) {
        cards.set(card.dataset.tool, { node: card, home: card.parentElement });
    }

    const sections = [...toolsGrid.querySelectorAll('.cat-section')];
    const catLinks = [...document.querySelectorAll('[data-cat-link]')];

    function restoreBrowse() {
        // Re-append in registry order so each section's original order returns.
        for (const tool of TOOLS) {
            const entry = cards.get(tool.id);
            if (entry && entry.node.parentElement !== entry.home) entry.home.append(entry.node);
        }
        for (const entry of cards.values()) entry.node.hidden = false;
        for (const section of sections) section.hidden = false;

        toolsGrid.hidden = false;
        if (resultsPane) resultsPane.hidden = true;
        if (noResults) noResults.hidden = true;
        if (spellingHint) spellingHint.hidden = true;
        if (visibleCount) visibleCount.textContent = `${TOOLS.length} tools`;
    }

    function showRanked(entries, host) {
        for (const entry of entries) {
            const card = cards.get(entry.tool.id);
            if (!card) continue;
            card.node.hidden = false;
            host.append(card.node);
        }
    }

    function runSearch(query) {
        if (!query) { restoreBrowse(); return; }

        const { direct, related } = searchTools(query);

        // Everything is hidden first; the two lists below un-hide what they take.
        for (const entry of cards.values()) entry.node.hidden = true;

        toolsGrid.hidden = true;
        if (resultsPane) resultsPane.hidden = false;
        if (resultsList) { resultsList.replaceChildren(); showRanked(direct, resultsList); }
        if (relatedList) { relatedList.replaceChildren(); showRanked(related, relatedList); }

        if (resultsHeading) {
            resultsHeading.hidden = direct.length === 0;
            resultsHeading.textContent = direct.length === 1 ? '1 match' : `${direct.length} matches`;
        }

        // The whole point of the two-tier result: a near miss should suggest
        // something rather than showing a blank page.
        if (relatedBlock) {
            relatedBlock.hidden = related.length === 0;
            const label = relatedBlock.querySelector('[data-related-label]');
            if (label) {
                label.textContent = direct.length
                    ? 'You might also want'
                    : 'No exact match — you might want';
            }
        }

        if (spellingHint) {
            const suggestion = suggestSpelling(query);
            spellingHint.hidden = !suggestion;
            if (suggestion) {
                spellingHint.replaceChildren(
                    document.createTextNode('Showing results for '),
                    Object.assign(document.createElement('strong'), { textContent: suggestion.to }),
                    document.createTextNode(` instead of “${suggestion.from}”.`),
                );
            }
        }

        const total = direct.length + related.length;
        if (visibleCount) visibleCount.textContent = total === 1 ? '1 tool' : `${total} tools`;
        if (noResults) noResults.hidden = total !== 0;
    }

    // --- Category rail ---
    function markActive(id) {
        for (const link of catLinks) {
            link.classList.toggle('is-active', link.dataset.catLink === id);
        }
    }

    for (const link of catLinks) {
        const href = link.getAttribute('href') || '';
        if (href.charAt(0) !== '#') continue;
        link.addEventListener('click', () => {
            // A category is meaningless while a search is filtering the list.
            if (searchInput && searchInput.value) {
                searchInput.value = '';
                runSearch('');
            }
            markActive(link.dataset.catLink);
        });
    }

    if (window.IntersectionObserver && sections.length) {
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) markActive(entry.target.dataset.category);
            }
        }, { rootMargin: '-96px 0px -70% 0px' });
        for (const section of sections) observer.observe(section);
    }

    // --- Wiring ---
    if (searchInput) {
        searchInput.addEventListener('input', () => runSearch(searchInput.value.trim()));

        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
                event.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
            if (event.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.value = '';
                runSearch('');
                searchInput.blur();
            }
        });

        // A browser restoring a typed query on back/forward would otherwise
        // show the full list under a non-empty search box.
        if (searchInput.value) runSearch(searchInput.value.trim());
    }
}
