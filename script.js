// ============================================
// Useful Tool Hub — homepage
//
// A CLASSIC script, not a module: the grid is static HTML that must work with
// JavaScript off (a crawler, or a failed request), and this only enhances it.
// The matching logic itself lives in js/shared/tools.js so the search and the
// registry cannot disagree about what a tool is searchable by — but it is
// duplicated below rather than imported, because importing would make this
// page a module and defer it.
// ============================================

(function () {
    'use strict';

    var searchInput = document.getElementById('searchInput');
    var toolsGrid = document.getElementById('toolsGrid');
    var visibleCount = document.getElementById('visibleCount');
    var noResults = document.getElementById('noResults');
    if (!toolsGrid) return;

    var cards = Array.prototype.slice.call(toolsGrid.querySelectorAll('.tool-card'));
    var sections = Array.prototype.slice.call(toolsGrid.querySelectorAll('.cat-section'));
    var catLinks = Array.prototype.slice.call(document.querySelectorAll('[data-cat-link]'));

    /** Everything a card can be matched against, computed once. */
    var haystacks = cards.map(function (card) {
        var title = card.querySelector('.tool-card-title');
        var desc = card.querySelector('.tool-card-desc');
        return [
            title ? title.textContent : '',
            desc ? desc.textContent : '',
            card.dataset.keywords || '',
        ].join(' ').toLowerCase();
    });

    /**
     * Every term must appear somewhere in the card's text.
     *
     * The old version matched the whole query as one substring against title,
     * description and keywords SEPARATELY, so "image convert" found nothing —
     * those two words never sit next to each other in any single field.
     */
    function matches(index, terms) {
        for (var i = 0; i < terms.length; i += 1) {
            if (haystacks[index].indexOf(terms[i]) === -1) return false;
        }
        return true;
    }

    function filterTools(query) {
        var terms = query.split(/\s+/).filter(Boolean);
        var visible = 0;

        cards.forEach(function (card, i) {
            var show = terms.length === 0 || matches(i, terms);
            // `hidden` rather than style.display, so nothing has to remember
            // which display value the element started with.
            card.hidden = !show;
            if (show) visible += 1;
        });

        // A category heading with no cards under it reads as an empty promise.
        sections.forEach(function (section) {
            var any = Array.prototype.some.call(
                section.querySelectorAll('.tool-card'),
                function (card) { return !card.hidden; },
            );
            section.hidden = !any;
        });

        if (visibleCount) {
            visibleCount.textContent = visible + ' tool' + (visible === 1 ? '' : 's');
        }
        if (noResults) noResults.hidden = visible !== 0;
    }

    // --- Category rail ---
    //
    // The links are real anchors and scroll on their own; this only moves the
    // active marker, so the rail still works if the script never runs.
    function markActive(id) {
        catLinks.forEach(function (link) {
            link.classList.toggle('is-active', link.dataset.catLink === id);
        });
    }

    catLinks.forEach(function (link) {
        if (!link.getAttribute('href') || link.getAttribute('href').charAt(0) !== '#') return;
        link.addEventListener('click', function () { markActive(link.dataset.catLink); });
    });

    // Follow the rail to whichever category is on screen. Guarded because
    // IntersectionObserver is absent in some embedded webviews.
    if (window.IntersectionObserver && sections.length) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) markActive(entry.target.dataset.category);
            });
        }, { rootMargin: '-96px 0px -70% 0px' });
        sections.forEach(function (section) { observer.observe(section); });
    }

    // --- Search wiring ---
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            filterTools(searchInput.value.trim().toLowerCase());
        });

        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.value = '';
                filterTools('');
                searchInput.blur();
            }
        });

        // A browser restoring a typed query on back/forward would otherwise
        // show the full list under a non-empty search box.
        if (searchInput.value) filterTools(searchInput.value.trim().toLowerCase());
    }
})();
