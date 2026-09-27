import { mixToMono } from '../transcribe/js/audio.js';

describe('mixToMono', () => {
    test('one channel is copied, not aliased', () => {
        const left = new Float32Array([0.5, -0.5]);
        const out = mixToMono([left]);
        expect(Array.from(out)).toEqual([0.5, -0.5]);
        expect(out).not.toBe(left);
    });

    // A stereo interview with each speaker on one side must keep both.
    test('channels are averaged, so a voice on one side survives', () => {
        const out = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
        expect(Array.from(out)).toEqual([0.5, 0.5]);
    });
});
