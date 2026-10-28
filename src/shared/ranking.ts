/** Competition places preserve ties and skip occupied positions: 1, 1, 3. */
export function competitionPlaces<T extends { score: number }>(
  ordered: T[],
): (T & { place: number })[] {
  let place = 0;
  return ordered.map((entry, index) => {
    if (index === 0 || entry.score !== ordered[index - 1]?.score) place = index + 1;
    return { ...entry, place };
  });
}
