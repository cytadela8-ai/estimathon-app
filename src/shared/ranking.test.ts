/** Ranking behavior, including podium ties and all-zero fields. */
import { expect, it } from 'vitest';
import { competitionPlaces } from '#est-shared/ranking';
it.each([
  [
    [1000, 1000, 500],
    [1, 1, 3],
  ],
  [
    [1000, 500, 500, 0],
    [1, 2, 2, 4],
  ],
  [
    [0, 0, 0],
    [1, 1, 1],
  ],
  [[], []],
])('assigns competition places for %j', (scores, places) => {
  expect(competitionPlaces(scores.map((score) => ({ score }))).map((s) => s.place)).toEqual(places);
});
