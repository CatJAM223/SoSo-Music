type SearchableTrack = {
  title?: string;
  artist?: string | { name?: string };
  album?: string | { title?: string };
};
export function filterLibraryTracks<TrackType extends SearchableTrack>(
  tracks: TrackType[],
  query: string,
): TrackType[] {
  if (!query) return tracks;
  return tracks.filter((track) => {
    const artist = typeof track.artist === 'object' ? track.artist?.name : track.artist;
    const album = typeof track.album === 'object' ? track.album?.title : track.album;
    return [track.title, artist, album].some((value) => value?.toLowerCase().includes(query));
  });
}
