export function subscribePlaylistUpdates(onUpdate: () => void): () => void {
  window.addEventListener('soso:playlists-updated', onUpdate);
  window.addEventListener('storage', onUpdate);
  return () => {
    window.removeEventListener('soso:playlists-updated', onUpdate);
    window.removeEventListener('storage', onUpdate);
  };
}
