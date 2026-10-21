import {
  isSoundCloudRestrictedTrack,
  isFullSoundCloudTranscoding,
} from '../../utils/soundcloudPlayback.ts';
import type { Track } from '../../types/index.ts';
import {
  extractAllArtists,
  isArtistMatch,
  normalizeText,
  parseMultiArtists,
} from '../../utils/artistParser.ts';
import { fixMojibake, isMojibake } from '../../utils/formatters.ts';
import { parseSoundCloudTags } from '../../utils/genreSearch.ts';

/**
 * Converts any SoundCloud artwork/avatar URL variant to high definition 500x500
 */
export function toSoundCloudHdCover(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/-(?:large|t300x300|crop|small|badge)\./, '-t500x500.');
}

export function cleanSoundCloudPlaylistId(id?: string | number): string {
  return String(id ?? '').replace(/^(sc_alb_|sc_|yt_)/, '');
}

/**
 * Resolves HD artwork for a playlist/album by inspecting direct artwork,
 * tracks artwork, user avatar, and fallback avatar.
 */
export function extractPlaylistCover(p: any, fallbackUserAvatar?: string): string {
  if (!p) return fallbackUserAvatar ? toSoundCloudHdCover(fallbackUserAvatar) : '';

  // 1. Direct playlist artwork
  const directArt = p.artwork_url;
  if (directArt && typeof directArt === 'string') {
    return toSoundCloudHdCover(directArt);
  }

  // 2. Artwork from the first available track with artwork
  if (Array.isArray(p.tracks)) {
    for (const t of p.tracks) {
      if (t?.artwork_url && typeof t.artwork_url === 'string') {
        return toSoundCloudHdCover(t.artwork_url);
      }
    }
  }

  // 3. User avatar of the playlist uploader
  const userAvatar = p.user?.avatar_url;
  if (userAvatar && typeof userAvatar === 'string' && !userAvatar.includes('default_avatar')) {
    return toSoundCloudHdCover(userAvatar);
  }

  // 4. Fallback artist avatar
  if (
    fallbackUserAvatar &&
    typeof fallbackUserAvatar === 'string' &&
    !fallbackUserAvatar.includes('default_avatar')
  ) {
    return toSoundCloudHdCover(fallbackUserAvatar);
  }

  return '';
}

/** Fetch missing playlist track details in bounded batches and index them by ID. */
export async function fetchSoundCloudPlaylistTrackDetails(
  playlistTracks: any[],
  fetchTracks: (ids: Array<string | number>) => Promise<any>,
): Promise<Map<string, any>> {
  const uniqueStubIds = new Map<string, string | number>();
  for (const track of playlistTracks || []) {
    if (!track?.title && track?.id != null) {
      uniqueStubIds.set(String(track.id), track.id);
    }
  }

  const ids = Array.from(uniqueStubIds.values());
  const details = new Map<string, any>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const response = await fetchTracks(batch);
    if (!Array.isArray(response)) continue;

    for (const track of response) {
      if (track?.id != null) details.set(String(track.id), track);
    }
  }
  return details;
}

/** Convert a playlist payload into normalized tracks, filling SoundCloud stubs. */
export function hydrateSoundCloudPlaylistTracks(
  playlistTracks: any[],
  fullTracksById: Map<string | number, any>,
  albumInfo?: { id: number | string; title: string; cover: string },
): Track[] {
  if (!Array.isArray(playlistTracks)) return [];
  return playlistTracks
    .map((item: any) => {
      const fullItem = item?.title
        ? item
        : fullTracksById.get(item?.id) || fullTracksById.get(String(item?.id)) || item;
      const track = transformSCTrack(fullItem);
      if (track && albumInfo) {
        track.album = {
          id: albumInfo.id,
          title: albumInfo.title,
          cover: albumInfo.cover || track.album?.cover,
          cover_medium: albumInfo.cover || track.album?.cover_medium,
          cover_big: albumInfo.cover || track.album?.cover_big,
          cover_xl: albumInfo.cover || track.album?.cover_xl,
        };
      }
      return track;
    })
    .filter(Boolean) as Track[];
}

/**
 * Converts SoundCloud API item into normalized SoSo Music Track model
 */
export function transformSCTrack(item: any): Track | null {
  if (!item || !item.id || !item.title) return null;

  if (isSoundCloudRestrictedTrack(item)) return null;
  const transcodings: any[] = Array.isArray(item.media?.transcodings)
    ? item.media.transcodings
    : [];
  const fullDuration = Math.max(Number(item.full_duration) || 0, Number(item.duration) || 0);
  const supported = transcodings.filter((format) =>
    isFullSoundCloudTranscoding(format, fullDuration),
  );
  const unsupportedOnly = transcodings.length > 0 && supported.length === 0;
  const validTranscoding =
    supported.find((format) => format.format.protocol === 'progressive') || supported[0];

  const durationSec = Math.round((item.duration || 0) / 1000);
  if (durationSec <= 0) return null;

  // Clean author & title
  let artistName = fixMojibake(item.publisher_metadata?.artist?.trim() || '');
  let trackTitle = fixMojibake(item.title?.trim() || 'Untitled Track');

  // Clean ripper and file extension artifacts from track title (e.g. "- YouTube.M4A", ".mp3", "(YouTube.m4a)")
  trackTitle = trackTitle
    .replace(
      /\s*[\(\[](?:youtube|yt|audio|video)?\s*\.?(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)[\)\]]/gi,
      '',
    )
    .replace(
      /\s*[-–—_]?\s*(?:(?:official\s+)?(?:video|audio|music\s+video|lyric\s+video|visualizer)?\s*[-–—_]?\s*)?(?:youtube|yt|soundcloud|vk|y2mate|ssyoutube)?\.(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)\b/gi,
      '',
    )
    .replace(/\s*[-–—]\s*(?:YouTube|SoundCloud|VK)$/i, '')
    .replace(/\.(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)$/i, '')
    .trim();

  // If title has "Artist - Track" format, parse artist and track title accurately
  if (trackTitle.includes(' - ')) {
    const parts = trackTitle.split(' - ');
    if (parts.length >= 2) {
      const afterHyphen = parts.slice(1).join(' - ').trim();
      const isSuffixOnly =
        /^(remix|vip|edit|acoustic|mix|cover|slowed|sped up|reverb|instrumental)\b/i.test(
          afterHyphen,
        );
      const isRipperSuffix =
        /^(?:youtube|yt|audio|video|track|official\s*(?:video|audio)?)\.?(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)?$/i.test(
          afterHyphen,
        ) ||
        /^\.(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)$/i.test(afterHyphen) ||
        /^(?:m4a|mp3|wav|flac|aac|ogg|opus|webm|mp4)$/i.test(afterHyphen);

      if (isRipperSuffix) {
        trackTitle = fixMojibake(parts[0].trim());
      } else if (!isSuffixOnly) {
        if (!artistName || isMojibake(artistName)) {
          artistName = fixMojibake(parts[0].trim());
        }
        trackTitle = fixMojibake(afterHyphen);
      }
    }
  }

  const uploaderUsername = fixMojibake(item.user?.username || '').trim();

  if (!artistName || isMojibake(artistName)) {
    artistName = uploaderUsername || 'Unknown Artist';
  }

  artistName = fixMojibake(artistName);

  // Verify whether the SoundCloud uploader is actually the artist
  // (prevents third-party reposter channels from masquerading as the artist)
  const isUploaderTheArtist = Boolean(
    uploaderUsername &&
    artistName &&
    (normalizeText(uploaderUsername) === normalizeText(artistName) ||
      isArtistMatch(
        { user: { username: uploaderUsername }, artist: uploaderUsername },
        artistName,
      )),
  );

  // Convert thumbnail to HD 500x500
  const rawArtwork = item.artwork_url || (isUploaderTheArtist ? item.user?.avatar_url : '') || '';
  const hdArtwork = toSoundCloudHdCover(rawArtwork);
  const finalCover = hdArtwork || rawArtwork || '';

  const rawAlbumTitle =
    item.publisher_metadata?.album_title || item.publisher_metadata?.release_title || 'Single';
  const albumTitle = fixMojibake(rawAlbumTitle);

  return {
    id: item.id,
    title: trackTitle,
    duration: durationSec,
    preview: validTranscoding?.url || '',
    artist: {
      id:
        isUploaderTheArtist && item.user?.id
          ? `sc_art_${item.user.id}`
          : `sc_art_${artistName.toLowerCase().replace(/\s+/g, '_')}`,
      name: artistName,
      picture_medium: isUploaderTheArtist ? item.user?.avatar_url || '' : '',
      source: 'soundcloud',
    },
    album: {
      id: `sc_track_album_${item.id}`,
      title: albumTitle,
      cover: finalCover,
      cover_small: finalCover,
      cover_medium: finalCover,
      cover_big: finalCover,
      cover_xl: finalCover,
    },
    cover_url: finalCover,
    genre: typeof item.genre === 'string' ? fixMojibake(item.genre) : '',
    tags: parseSoundCloudTags(item.tag_list),
    resolvedStreamUrl: '', // Resolved instantly when played
    ...(unsupportedOnly ? { playbackUnavailable: true } : {}),
    source: 'soundcloud',
  };
}

/**
 * Validates whether a track genuinely belongs to target artist (or featuring) and eliminates random beats/covers
 */
export function isValidTrackForArtist(track: Track, targetArtist: string): boolean {
  if (!track || !targetArtist) return false;
  const targetLower = targetArtist.toLowerCase().trim();
  const targetNorm = targetLower.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  if (!targetNorm) return false;

  const trackTitle = (track.title || '').toLowerCase().trim();
  const rawArtist = (typeof track.artist === 'object' ? track.artist?.name : track.artist || '')
    .toLowerCase()
    .trim();

  // 1. Blatant non-music or third-party remake keywords
  if (
    trackTitle.includes('type beat') ||
    trackTitle.includes('тайп бит') ||
    trackTitle.includes('inspired by') ||
    trackTitle.includes('tutorial') ||
    trackTitle.includes('guitar cover') ||
    trackTitle.includes('drum cover') ||
    trackTitle.includes('piano cover') ||
    trackTitle.includes('cover by') ||
    trackTitle.includes('кавер от') ||
    trackTitle.includes('how to sound like') ||
    trackTitle.includes('reaction') ||
    trackTitle.includes('реакция') ||
    trackTitle.includes('loop 1 hour') ||
    trackTitle.includes('10 hours') ||
    trackTitle.includes('mashup') ||
    trackTitle.includes('vocal preset') ||
    trackTitle.includes('remake')
  ) {
    return false;
  }

  // 2. Direct artist exact match or multi-artist exact match
  const parsedArtists = parseMultiArtists(rawArtist).map((a) =>
    a
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]/gu, ''),
  );
  if (parsedArtists.includes(targetNorm)) {
    return true;
  }

  // 3. Featured in title exact match (e.g. "Song (feat. ThxSoMch)", "Song ft. ThxSoMch")
  const titleParsed = extractAllArtists('', trackTitle).map((a) =>
    a
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]/gu, ''),
  );
  if (titleParsed.includes(targetNorm)) {
    return true;
  }

  // 4. Track title starts with "Artist - Song" (exact artist prefix before delimiter)
  const dashMatch = trackTitle.match(/^([^-–—]+)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    const prefixNorm = dashMatch[1]
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (prefixNorm === targetNorm) {
      return true;
    }
    const prefixParsed = parseMultiArtists(dashMatch[1]).map((a) =>
      a
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]/gu, ''),
    );
    if (prefixParsed.includes(targetNorm)) {
      return true;
    }
  }

  return false;
}

export function cleanArtistForSearch(rawArtist: string): string {
  if (!rawArtist) return '';
  return rawArtist.replace(/\s+(feat\.|ft\.|featuring|with|prod\.)\s+.*/i, '').trim();
}
