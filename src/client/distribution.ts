/** Correct-answer-centered log histogram. Overflow bins retain every submitted estimate. */
import { logarithmicScale } from '#est-shared/estimates';

export function answerDistribution(answers: string[], correct: string) {
  const scale = logarithmicScale(answers, correct);
  const radius = 3 * scale;
  const bins = Array<number>(14).fill(0);
  for (const answer of answers) {
    const offset = Math.log(Number(answer) / Number(correct));
    let index = Math.min(12, 1 + Math.floor(((offset + radius) / (2 * radius)) * 12));
    if (offset < -radius) index = 0;
    if (offset > radius) index = 13;
    bins[index]! += 1;
  }
  return {
    scale,
    bins,
    ticks: [-1, 0, 1].map(
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
