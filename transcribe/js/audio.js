// Audio in the shape Whisper reads: 16 kHz, mono, Float32.
//
// Decoded by the browser, not ffmpeg: decodeAudioData reads MP3, M4A/AAC,
// WAV, OGG/Opus, FLAC and the soundtrack of MP4/WebM video, which covers what
// people record, and needs no cross-origin isolation. What it cannot read gets
// pointed at the converter instead.

export const WHISPER_RATE = 16000;

/** Average the channels. Pure, so it is tested without Web Audio. */
export function mixToMono(channels) {
    if (channels.length === 1) return Float32Array.from(channels[0]);
    const out = new Float32Array(channels[0].length);
    for (const channel of channels) {
        for (let i = 0; i < out.length; i += 1) out[i] += channel[i] / channels.length;
    }
    return out;
}

/** @returns {Promise<{audio: Float32Array, duration: number}>} */
export async function decodeForWhisper(file) {
    // Asking the context for 16 kHz makes decodeAudioData resample for us.
    const context = new AudioContext({ sampleRate: WHISPER_RATE });
    try {
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        return { audio: mixToMono(channels), duration: buffer.duration };
    } catch {
        throw new Error(`${file.name} is in a format this browser cannot decode. `
            + 'Convert it to MP3 with the File Converter first, then bring it back here.');
    } finally {
        context.close();
    }
}
