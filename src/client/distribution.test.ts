/** Distribution tests cover scoring alignment, symmetric bounds, outliers and numeric extremes. */
import { describe, expect, it } from 'vitest';
import { answerDistribution, formatAxis } from '#est-client/distribution';

describe('correct-centered answer histogram', () => {
  it('uses the scoring median and equal logarithmic distances around the correct answer', () => {
    const result = answerDistribution(['100', '200', '400'], '100');
    expect(result.scale).toBeCloseTo(Math.log(2));
    expect(result.ticks[1]).toBe(2);
    expect(result.ticks[0]).toBeCloseTo(Math.log10(12.5));
    expect(result.ticks[2]).toBeCloseTo(Math.log10(800));
    expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(3);
  });
  it('keeps far outliers in separate buckets without stretching a tightly grouped field', () => {
    const result = answerDistribution(['1', '100', '100', '100', '1000000'], '100');
    expect(result.scale).toBe(0.05);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[13]).toBe(1);
    expect(result.bins[7]).toBe(3);
    expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(5);
  });
  it('includes exact boundary answers in the central range', () => {
    const result = answerDistribution(['125', '500', '1000', '1000', '2000', '8000'], '1000');
    expect(result.scale).toBeCloseTo(Math.log(2));
    expect(result.bins[0]).toBe(0);
    expect(result.bins[13]).toBe(0);
    expect(result.bins[1]).toBe(1);
    expect(result.bins[12]).toBe(1);
  });
  it.each([[], ['100'], ['100', '100']].map((answers) => ({ answers })))(
    'handles an empty or exact field %j',
    ({ answers }) => {
      const result = answerDistribution(answers, '100');
      expect(result.scale).toBe(0.05);
      expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(answers.length);
      expect(result.bins[7]).toBe(answers.length);
    },
  );
  it('renders finite axis labels even when ±3M exceeds floating-point number bounds', () => {
    const result = answerDistribution(['1'], '1' + '0'.repeat(99));
    expect(result.ticks.every(Number.isFinite)).toBe(true);
    const labels = result.ticks.map(formatAxis);
    expect(labels.join(' ')).not.toMatch(/Infinity|NaN/);
    expect(labels[2]).toMatch(/e396$/);
  });
  it('formats typical, fractional and huge values for readable labels', () => {
    expect(formatAxis(2)).toBe('100');
    expect(formatAxis(-1)).toBe('0,1');
    expect(formatAxis(20)).toBe('1e20');
  });
});
