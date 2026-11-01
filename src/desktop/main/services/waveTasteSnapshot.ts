import type { DatabaseManager } from '../db/index.ts';
import { buildWaveTasteSeeds } from '../../../shared/utils/waveTaste.ts';
import { shuffled } from '../../../shared/utils/concurrentTasks.ts';

function read(db: DatabaseManager) {
  const likes = db.getTasteLikedTracks();
  const disliked = db.getDislikedTrackIds();
  const history = db
    .getWaveTasteTracks(30)
    .map((track) => ({ ...track, artist: { name: track.artist } }));
  const artists = [
    ...db.getFollowedArtists(),
    ...db.getScrobbledTopArtists(30).filter((artist) => artist.score > 0),
  ];
  return {
    revision: db.getTastePolicy().revision,
    likes,
    artists,
    disliked,
    waveSeeds: buildWaveTasteSeeds(
      shuffled(likes),
      [],
      history,
      db.getPlaylistWaveTracks(),
      disliked,
    ),
  };
}
type Snapshot = ReturnType<typeof read>;
const cache = new WeakMap<DatabaseManager, { revision: number; at: number; value: Snapshot }>();
/** Invalidate on every database mutation; recency weights also refresh during idle sessions. */
export function waveTasteSnapshot(db: DatabaseManager): Snapshot {
  const revision = db.getChangeRevision?.();
  const previous = cache.get(db);
  if (
    revision !== undefined &&
    previous?.revision === revision &&
    Date.now() - previous.at < 30_000
  )
    return previous.value;
  const value = read(db);
  if (revision !== undefined) cache.set(db, { revision, at: Date.now(), value });
  return value;
}
