// color-converter/js/color-converter.js — the page wiring, against its real markup.
//
// The history is debounced, so these run on fake timers.

import fs from 'fs';
import path from 'path';

const HTML = fs.readFileSync(path.join(__dirname, '..', 'color-converter', 'index.html'), 'utf8');
const $ = (id) => document.getElementById(id);

function type(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
}

beforeAll(async () => {
    jest.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    // jsdom has no canvas; the eyedropper only needs a context object to exist.
    HTMLCanvasElement.prototype.getContext = () => ({});
    await import('../color-converter/js/color-converter.js');
    jest.advanceTimersByTime(1000);
});

afterAll(() => jest.useRealTimers());

// The starting colour went into the history on every visit, so it was always
// the first swatch whatever the user had picked.
test('opening the page does not add to the history', () => {
    expect(localStorage.getItem('colorHistory')).toBeNull();
    expect($('colorHistory').children).toHaveLength(0);
});

test('a picked colour is added to the history', () => {
    type($('hexInput'), '#ff0000');
    jest.advanceTimersByTime(400);
    expect(JSON.parse(localStorage.getItem('colorHistory'))).toEqual(['#ff0000']);
});

// Clear ran while the debounced add was still pending, which then wrote the
// history straight back.
test('Clear sticks even with an add still pending', () => {
    type($('hexInput'), '#00ff00');
    $('clearHistory').click();
    jest.advanceTimersByTime(400);
    expect(localStorage.getItem('colorHistory')).toBeNull();
    expect($('colorHistory').children).toHaveLength(0);
});

// parseInt('') || 0 made an emptied field read as 0, so backspacing R turned
// the colour black before the user could type the new value.
test('emptying a channel mid-edit leaves the colour alone', () => {
    type($('hexInput'), '#336699');
    type($('rInput'), '');
    expect($('hexInput').value).toBe('#336699');
    type($('rInput'), '255');
    expect($('hexInput').value).toBe('#ff6699');
});

test('an out-of-range channel is clamped, and the field shows it once left', () => {
    type($('rInput'), '300');
    expect($('rgbText').textContent).toBe('rgb(255, 102, 153)');
    $('rInput').dispatchEvent(new Event('change'));
    expect($('rInput').value).toBe('255');
});
