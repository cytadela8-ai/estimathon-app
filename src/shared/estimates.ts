/** Shared scoring scale: median absolute logarithmic error with the contest's 0.05 floor. */
export function logarithmicScale(answers: string[], correct: string): number {
  const errors = answers
    .map((answer) => Math.abs(Math.log(Number(answer) / Number(correct))))
    .sort((a, b) => a - b);
  if (!errors.length) return 0.05;
  const middle = Math.floor(errors.length / 2);
  const median =
    errors.length % 2 === 0 ? (errors[middle - 1]! + errors[middle]!) / 2 : errors[middle]!;
  return Math.max(0.05, median);
}
