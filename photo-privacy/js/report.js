// What a photo gives away, in plain words. Pure, so the wording and ordering
// can be tested without a DOM; the page only renders what this returns.

import { presentTags, mapsUrl } from '../../js/shared/metadata.js';

/** Fields worth a line of their own, in the order a person cares about them. */
const HEADLINE_FIELDS = [
    ['Taken', 'Taken'],
    ['Camera', null], // composed from make + model below
    ['Body serial number', 'Camera serial number'],
    ['Lens serial number', 'Lens serial number'],
    ['Camera owner', 'Owner'],
    ['Artist', 'Artist'],
    ['Copyright', 'Copyright'],
    ['Description', 'Description'],
    ['User comment', 'Comment'],
    ['Software', 'Edited with'],
];

/** Identify a person, a place or one physical camera. */
const SENSITIVE = new Set([
    'Location', 'Taken', 'Camera serial number', 'Lens serial number', 'Owner', 'Artist',
    'Description', 'Comment',
]);

/**
 * @param {{format: string, tags: object, gps: object|null, found: {kind: string, bytes: number}[]}|null} meta
 *        what readMetadata returned
 * @returns {{
 *   headline: string,
 *   level: 'location'|'details'|'none',
 *   facts: {label: string, value: string, sensitive: boolean, href?: string}[],
 *   allTags: [string, string][],
 *   blocks: {kind: string, bytes: number}[],
 * }}
 */
export function privacyReport(meta) {
    const tags = presentTags(meta?.tags ?? {});
    const facts = [];

    if (meta?.gps) {
        const { latitude, longitude, altitude } = meta.gps;
        facts.push({
            label: 'Location',
            value: `${latitude}, ${longitude}${typeof altitude === 'number' ? ` · ${altitude} m` : ''}`,
            href: mapsUrl(meta.gps),
        });
    }

    const make = tags['Camera make'];
    const model = tags['Camera model'];
    for (const [key, label] of HEADLINE_FIELDS) {
        if (key === 'Camera') {
            // Most models already start with the make ("Apple" + "iPhone 15" is
            // fine, "Canon" + "Canon EOS R5" is not).
            const camera = model && make && !model.toLowerCase().startsWith(make.toLowerCase())
                ? `${make} ${model}` : (model || make);
            if (camera) facts.push({ label: 'Camera', value: camera });
        } else if (tags[key]) {
            facts.push({ label, value: tags[key] });
        }
    }
    for (const fact of facts) fact.sensitive = SENSITIVE.has(fact.label);

    const blocks = meta?.found ?? [];
    const level = meta?.gps ? 'location' : (facts.length || blocks.length ? 'details' : 'none');
    const headline = {
        location: 'This photo says where it was taken.',
        details: facts.length
            ? 'This photo carries details about the camera and when it was taken.'
            : 'This photo carries hidden metadata.',
        none: 'Nothing found. This photo carries no metadata.',
    }[level];

    return { headline, level, facts, allTags: Object.entries(tags), blocks };
}
