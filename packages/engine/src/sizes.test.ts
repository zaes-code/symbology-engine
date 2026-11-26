import {mapScaleOf, pointZoomFactor} from './sizes';

describe('point symbols shrinking as the map zooms out', () => {
    // 1:1,000,000 at 96 pixels an inch is 264.58 meters a pixel.
    const at = (scale: number) => scale / mapScaleOf(1);

    it('reads the map scale at 96 pixels an inch', () => {
        expect(mapScaleOf(at(1_000_000))).toBeCloseTo(1_000_000);
    });

    it('is full size at the threshold scale and closer in', () => {
        expect(pointZoomFactor(at(1_000_000), 1_000_000)).toBe(1);
        expect(pointZoomFactor(at(50_000), 1_000_000)).toBe(1);
    });

    it('shrinks by the square root of how far out, never below the minimum', () => {
        expect(pointZoomFactor(at(4_000_000), 1_000_000)).toBeCloseTo(0.5);
        expect(pointZoomFactor(at(100_000_000), 1_000_000)).toBe(0.4);
        expect(pointZoomFactor(at(100_000_000), 1_000_000, 0.2)).toBeCloseTo(0.2);
    });

    it('never shrinks without a threshold', () => {
        expect(pointZoomFactor(at(100_000_000))).toBe(1);
        expect(pointZoomFactor(at(100_000_000), 0)).toBe(1);
    });
});
