import { privacyReport } from '../photo-privacy/js/report.js';

const meta = (over = {}) => ({ format: 'JPEG', tags: {}, gps: null, found: [], ...over });

describe('privacyReport', () => {
    test('a location leads, with a map link, and is marked sensitive', () => {
        const report = privacyReport(meta({
            tags: { 'Camera make': 'Apple', 'Camera model': 'iPhone 15' },
            gps: { latitude: 51.5007, longitude: -0.1246, altitude: 12 },
            found: [{ kind: 'Exif', bytes: 900 }],
        }));
        expect(report.level).toBe('location');
        expect(report.headline).toMatch(/where it was taken/);
        expect(report.facts[0]).toMatchObject({
            label: 'Location', value: '51.5007, -0.1246 · 12 m', sensitive: true,
        });
        expect(report.facts[0].href).toContain('mlat=51.5007');
    });

    test('make and model are joined, without repeating the make', () => {
        const camera = (make, model) => privacyReport(meta({ tags: { 'Camera make': make, 'Camera model': model } }))
            .facts.find((f) => f.label === 'Camera').value;
        expect(camera('Apple', 'iPhone 15')).toBe('Apple iPhone 15');
        expect(camera('Canon', 'Canon EOS R5')).toBe('Canon EOS R5');
    });

    test('dates are readable and serial numbers count as sensitive', () => {
        const { facts } = privacyReport(meta({
            tags: { Taken: '2024:03:11 14:05:09', 'Body serial number': 'SN-1' },
        }));
        expect(facts).toEqual([
            { label: 'Taken', value: '2024-03-11 14:05:09', sensitive: true },
            { label: 'Camera serial number', value: 'SN-1', sensitive: true },
        ]);
    });

    test('the camera alone is a detail, not a location', () => {
        const report = privacyReport(meta({ tags: { 'Camera model': 'Pixel 8' } }));
        expect(report.level).toBe('details');
        expect(report.facts[0].sensitive).toBe(false);
    });

    // An XMP packet with no fields we can name is still something being shared.
    test('blocks with nothing readable still count', () => {
        const report = privacyReport(meta({ found: [{ kind: 'XMP', bytes: 3000 }] }));
        expect(report.level).toBe('details');
        expect(report.headline).toBe('This photo carries hidden metadata.');
    });

    test('a clean photo says so', () => {
        expect(privacyReport(meta()).level).toBe('none');
        expect(privacyReport(null).headline).toMatch(/Nothing found/);
    });
});
