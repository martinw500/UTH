// Test-time only. Lets Jest `import` the ES modules in js/shared/ and the tool
// scripts, so tests exercise the real source instead of copies of it.
//
// This is NOT a build step: the browser loads those same files directly via
// <script type="module">. Nothing here runs at deploy time.
module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
    ],
};
