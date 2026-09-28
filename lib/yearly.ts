export type { YearBucket, YearlyTotals, YearlyData } from './db';
import { queryYearly } from './db';

export async function readYearly() {
  return queryYearly();
}
