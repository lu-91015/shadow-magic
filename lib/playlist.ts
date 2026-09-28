export type { Song, PlaylistData } from './db';
import { queryPlaylist } from './db';

export async function readPlaylist() {
  return queryPlaylist();
}
