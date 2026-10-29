/** Correct-answer-centered log histogram. Overflow bins retain every submitted estimate. */
import { logarithmicScale } from '#est-shared/estimates';

export function answerDistribution(answers: string[], correct: string) {
  const scale = logarithmicScale(answers, correct);
  const radius = 2 * scale;
  const bucketCount = 48;
  const bins = Array<number>(bucketCount + 2).fill(0);
  for (const answer of answers) {
    const offset = Math.log(Number(answer) / Number(correct));
    let index = Math.min(
      bucketCount,
      1 + Math.floor(((offset + radius) / (2 * radius)) * bucketCount),
    );
    if (offset < -radius) index = 0;
    if (offset > radius) index = bucketCount + 1;
    bins[index]! += 1;
  }
  return {
    scale,
    bins,
    ticks: Array.from({ length: 9 }, (_, index) => -1 + index / 4).map(
      (direction) => Math.log10(Number(correct)) + (direction * radius) / Math.LN10,
    ),
  };
}

/** Format base-ten logarithmic ticks without overflowing even beyond the 100-digit input range. */
export function formatAxis(logarithm: number): string {
  if (logarithm >= 7 || logarithm < -2) {
    const exponent = Math.floor(logarithm);
    const mantissa = 10 ** (logarithm - exponent);
    return `${mantissa.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}e${exponent}`;
  }
  return (10 ** logarithm).toLocaleString('pl-PL', { maximumSignificantDigits: 4 });
}
