/** Distribution tests cover scoring alignment, symmetric bounds, outliers and numeric extremes. */
import { describe, expect, it } from 'vitest';
import { answerDistribution, formatAxis } from '#est-client/distribution';

describe('correct-centered answer histogram', () => {
  it('uses the scoring median and equal logarithmic distances around the correct answer', () => {
    const result = answerDistribution(['100', '200', '400'], '100');
    expect(result.scale).toBeCloseTo(Math.log(2));
    expect(result.bins).toHaveLength(50);
    expect(result.ticks).toHaveLength(5);
    expect(result.ticks[2]).toBe(2);
    expect(result.ticks[1]).toBeCloseTo(Math.log10(50));
    expect(result.ticks[3]).toBeCloseTo(Math.log10(200));
    expect(result.ticks[0]).toBeCloseTo(Math.log10(25));
    expect(result.ticks[4]).toBeCloseTo(Math.log10(400));
    expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(3);
  });
  it('keeps far outliers in separate buckets without stretching a tightly grouped field', () => {
    const result = answerDistribution(['1', '100', '100', '100', '1000000'], '100');
    expect(result.scale).toBe(0.05);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[49]).toBe(1);
    expect(result.bins[25]).toBe(3);
    expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(5);
  });
  it('includes exact boundary answers in the central range', () => {
    const result = answerDistribution(['250', '500', '1000', '1000', '2000', '4000'], '1000');
    expect(result.scale).toBeCloseTo(Math.log(2));
    expect(result.bins[0]).toBe(0);
    expect(result.bins[49]).toBe(0);
    expect(result.bins[1]).toBe(1);
    expect(result.bins[48]).toBe(1);
  });
  it.each([[], ['100'], ['100', '100']].map((answers) => ({ answers })))(
    'handles an empty or exact field %j',
    ({ answers }) => {
      const result = answerDistribution(answers, '100');
      expect(result.scale).toBe(0.05);
      expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(answers.length);
      expect(result.bins[25]).toBe(answers.length);
    },
  );
  it('renders finite axis labels for estimates and correct answers at the supported 100-digit boundary', () => {
    const result = answerDistribution(['1'], '1' + '0'.repeat(99));
    expect(result.ticks.every(Number.isFinite)).toBe(true);
    const labels = result.ticks.map(formatAxis);
    expect(labels.join(' ')).not.toMatch(/Infinity|NaN/);
    expect(labels[4]).toMatch(/e297$/);
  });
  it('retains all 80 contestants across the denser buckets and overflow bins', () => {
    const answers = Array.from({ length: 80 }, (_, i) => String(i + 1));
    const result = answerDistribution(answers, '40');
    expect(result.bins).toHaveLength(50);
    expect(result.bins.reduce((sum, count) => sum + count, 0)).toBe(80);
    expect(result.bins.filter((count) => count > 0).length).toBeGreaterThan(24);
  });
  it('formats typical, fractional and huge values for readable labels', () => {
    expect(formatAxis(2)).toBe('100');
    expect(formatAxis(-1)).toBe('0,1');
    expect(formatAxis(20)).toBe('1e20');
  });
});
