/** Replace a stale SoundCloud client_id or add one to a request URL. */
export function withSoundCloudClientId(url: string, clientId: string): string {
  const encodedClientId = encodeURIComponent(clientId);
  if (/[?&]client_id=/.test(url)) {
    return url.replace(/([?&])client_id=[^&]*/, `$1client_id=${encodedClientId}`);
  }
  return `${url}${url.includes('?') ? '&' : '?'}client_id=${encodedClientId}`;
}
