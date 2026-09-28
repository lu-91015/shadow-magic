export type { LiveStatsData } from './db';
export type { LiveCategory } from './bilibili';
import { queryLiveStats } from './db';

export async function readLiveStats() {
  return queryLiveStats();
}
