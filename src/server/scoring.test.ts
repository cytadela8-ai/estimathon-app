/** Organizer formula: logarithmic errors, median normalization, a 0.05 floor and half-up rounding. */
import { describe, expect, it } from 'vitest';
import { scoreQuestion } from '#est-server/scoring';
function points(values: string[], correct = '100'): number[] {
  const answers = values.map((text, i) => ({ participantId: String(i), text }));
  return scoreQuestion(answers, correct).map((result) => result.score);
}
describe('median-normalized logarithmic scoring', () => {
  it('scores an odd-sized field using its median error', () => {
    expect(points(['100', '200', '400'])).toEqual([1000, 500, 333]);
  });
  it('averages the two middle errors for even-sized fields', () => {
    expect(points(['100', '200', '400', '800'])).toEqual([1000, 600, 429, 333]);
    expect(points(['100', '200'])).toEqual([1000, 333]);
  });
  it('applies the minimum median of 0.05 for a tightly grouped field', () => {
    expect(points(['10000', '10001', '10002'], '10000')).toEqual([1000, 998, 996]);
  });
  it('treats equal multiplicative overestimates and underestimates equally', () => {
    expect(points(['25', '100', '400'])).toEqual([500, 1000, 500]);
  });
  it('rounds half points upward with Math.round', () => {
    expect(points(['1', '2', '32768'], '1')).toEqual([1000, 500, 63]);
  });
  it('handles a single submission and a field of exact answers', () => {
    expect(points(['200'])).toEqual([500]);
    expect(points(['100'])).toEqual([1000]);
    expect(points(['100', '100', '100'])).toEqual([1000, 1000, 1000]);
  });
  it('handles the supported 100-digit integer boundary without numeric overflow', () => {
    const correct = `1${'0'.repeat(99)}`;
    expect(points(['1', correct, '9'.repeat(100)], correct)).toEqual([10, 1000, 500]);
  });
  it('handles no valid submissions without producing scores', () => {
    expect(scoreQuestion([], '100')).toEqual([]);
  });
  it('preserves participant association regardless of answer ordering', () => {
    expect(
      scoreQuestion(
        [
          { participantId: 'worst', text: '400' },
          { participantId: 'best', text: '100' },
          { participantId: 'middle', text: '200' },
        ],
        '100',
      ),
    ).toEqual([
      { participantId: 'worst', score: 333 },
      { participantId: 'best', score: 1000 },
      { participantId: 'middle', score: 500 },
    ]);
  });
  it.each(['0', '-1', '1.5', 'NaN', '', '1'.repeat(101)])('rejects invalid estimate %j', (text) => {
    expect(() => points([text])).toThrow('participant 0');
  });
  it('rejects an invalid correct answer even without submissions', () => {
    expect(() => scoreQuestion([], '0')).toThrow('Correct answer');
  });
});
