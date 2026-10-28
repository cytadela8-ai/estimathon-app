/** Per-question batch scoring; only confirmed valid submissions contribute to the median error. */
import { isPositiveInteger } from '#est-shared/protocol';
interface Estimate {
  participantId: string;
  text: string;
}
interface Score {
  participantId: string;
  score: number;
}
/**
 * Score a completed question with median-normalized logarithmic error.
 *
 * Args:
 *   answers: Confirmed submissions, retaining their participant IDs and integer text.
 *   correct: Positive integer correct answer, at most 100 digits.
 *
 * Returns:
 *   Integer scores in input order, with a maximum of 1000. Missing answers are not supplied.
 *
 * Throws:
 *   RangeError: An estimate or the correct answer is not a supported positive integer.
 */
export function scoreQuestion(answers: Estimate[], correct: string): Score[] {
  const correctValue = positiveNumber(correct, 'Correct answer');
  if (!answers.length) return [];
  const errors = answers.map((answer) => ({
    participantId: answer.participantId,
    error: Math.abs(
      Math.log(
        positiveNumber(answer.text, `Estimate for participant ${answer.participantId}`) /
          correctValue,
      ),
    ),
  }));
  const ordered = errors.map((answer) => answer.error).sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
  const normalization = Math.max(0.05, median);
  return errors.map((answer) => ({
    participantId: answer.participantId,
    score: Math.round(1000 / (1 + answer.error / normalization)),
  }));
}
function positiveNumber(text: string, context: string): number {
  if (!isPositiveInteger(text)) {
    throw new RangeError(`${context} must be a positive integer of at most 100 digits.`);
  }
  // The supported integer range and all possible ratios fit within finite positive doubles.
  return Number(text);
}
