// Site chrome: the theme toggle and the mobile nav.
//
// A CLASSIC script on purpose, not a module. Half the pages are still classic
// scripts, and a module is deferred — the toggle would then appear dead for a
// moment on slow loads. This works identically on every page.
//
// The part that must not be deferred (reading the stored choice and setting
// data-theme before first paint) is a separate inline snippet in every page's
// <head>. It cannot live here: an external script, even a synchronous one, can
// still paint before it arrives, and the page would flash the wrong theme.

(function () {
    'use strict';

    var STORAGE_KEY = 'uth-theme';
    var root = document.documentElement;

    function stored() {
        try {
            var value = localStorage.getItem(STORAGE_KEY);
            return value === 'light' || value === 'dark' ? value : null;
        } catch (e) {
            // Safari private mode and file:// both throw on localStorage.
            return null;
        }
    }

    function systemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark';
    }

    /** What the page is showing right now, whether chosen or inherited. */
    function current() {
        return root.getAttribute('data-theme') || systemTheme();
    }

    function apply(theme, persist) {
        root.setAttribute('data-theme', theme);
        if (persist) {
            try {
                localStorage.setItem(STORAGE_KEY, theme);
            } catch (e) { /* not fatal; the choice just will not survive a reload */ }
        }
        syncButtons(theme);
    }

    function syncButtons(theme) {
        var buttons = document.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < buttons.length; i += 1) {
            var button = buttons[i];
            var next = theme === 'light' ? 'dark' : 'light';
            button.setAttribute('aria-label', 'Switch to ' + next + ' theme');
            button.setAttribute('title', 'Switch to ' + next + ' theme');
            // aria-pressed would claim the button is a light-mode checkbox; it
            // is a switch between two states, so the label carries the meaning.
            button.setAttribute('data-active-theme', theme);
        }
    }

    function onClick() {
        apply(current() === 'light' ? 'dark' : 'light', true);
    }

    // ============================================
    // Mobile navigation
    //
    // The nav links were simply `display: none` below 768px with no way to
    // reveal them, so Feedback and GitHub were unreachable on any phone.
    // ============================================

    function initNav() {
        var toggle = document.querySelector('[data-nav-toggle]');
        var links = document.getElementById('navLinks');
        if (!toggle || !links) return;

        function setOpen(open) {
            toggle.setAttribute('aria-expanded', String(open));
            links.classList.toggle('open', open);
        }

        toggle.addEventListener('click', function () {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        // Following a link should close the drawer, or going "back" to a page
        // already open leaves it covering the content.
        links.addEventListener('click', function (event) {
            if (event.target.closest('a')) setOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setOpen(false);
        });

        document.addEventListener('click', function (event) {
            if (!links.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
        });

        // Resizing past the breakpoint must clear the open state, or the
        // desktop nav inherits a stale class.
        if (window.matchMedia) {
            var wide = window.matchMedia('(min-width: 769px)');
            var onWide = function (e) { if (e.matches) setOpen(false); };
            if (wide.addEventListener) wide.addEventListener('change', onWide);
            else if (wide.addListener) wide.addListener(onWide);
        }
    }

    function init() {
        syncButtons(current());
        var buttons = document.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < buttons.length; i += 1) {
            buttons[i].addEventListener('click', onClick);
        }
        initNav();
    }

    // Follow the OS while the user has not chosen explicitly. Once they have,
    // their choice wins and the system no longer overrides it.
    if (window.matchMedia) {
        var query = window.matchMedia('(prefers-color-scheme: light)');
        var onSystemChange = function () {
            if (!stored()) {
                root.removeAttribute('data-theme');
                syncButtons(systemTheme());
            }
        };
        if (query.addEventListener) query.addEventListener('change', onSystemChange);
        else if (query.addListener) query.addListener(onSystemChange);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
