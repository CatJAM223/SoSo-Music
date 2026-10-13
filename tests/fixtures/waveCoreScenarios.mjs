import { createHash } from 'node:crypto';
import { WaveEngine } from '../../src/desktop/main/services/waveEngine.ts';
import { SoundCloudService } from '../../src/desktop/main/services/soundcloud.ts';
import { YouTubeMusicService } from '../../src/desktop/main/services/youtubeMusic.ts';
import { LastFmService } from '../../src/desktop/main/services/lastfm.ts';

export async function waveCoreScenarios() {
  const originalRandom = Math.random,
    memory = WaveEngine.sessionPrints,
    anchors = WaveEngine.relatedAnchorIds;
  const originals = [
    SoundCloudService.search,
    YouTubeMusicService.search,
    LastFmService.getSimilarArtists,
    SoundCloudService.getRelatedTracks,
    YouTubeMusicService.getRadioTracks,
  ];
  const results = {};
  let counters,
    unavailable = false;
  Math.random = () => 0.37;
  const recording = (artist, index, source) => {
    const hash = createHash('sha256')
      .update(artist + ':' + index)
      .digest('hex');
    return {
      id: source === 'youtube' ? 'yt_' + hash.slice(0, 11) : 'sc_' + parseInt(hash.slice(0, 8), 16),
      title: 'Signal ' + String.fromCharCode(65 + index) + ' ' + artist,
      artist: { name: artist },
      album: { title: 'Album' },
      duration: 180 + index,
      preview: '',
      source,
    };
  };
  const search = (source) => async (query) => {
    counters[source]++;
    if (unavailable) throw new Error('Local unavailable provider fixture');
    const artist = query.replace(/ (radio|similar|energetic|chill)$/, '');
    return { data: Array.from({ length: 7 }, (_, index) => recording(artist, index, source)) };
  };
  SoundCloudService.search = search('soundcloud');
  YouTubeMusicService.search = search('youtube');
  LastFmService.getSimilarArtists = async (artist) => {
    counters.similar++;
    return unavailable ? [] : [{ name: 'Nearby ' + artist }];
  };
  const radio = async (id) => {
    counters.radio++;
    return unavailable
      ? []
      : Array.from({ length: 4 }, (_, index) =>
          recording('Radio ' + id + ' ' + index, index, 'soundcloud'),
        );
  };
  SoundCloudService.getRelatedTracks = radio;
  YouTubeMusicService.getRadioTracks = radio;
  try {
    for (const profile of ['taste', 'empty', 'unavailable'])
      for (const mood of ['default', 'mix', 'favorites', 'energy', 'chill', 'discover']) {
        WaveEngine.sessionPrints = [];
        WaveEngine.relatedAnchorIds = [];
        counters = { soundcloud: 0, youtube: 0, similar: 0, radio: 0 };
        unavailable = profile === 'unavailable';
        const seeds =
          profile === 'empty'
            ? []
            : ['Arbor', 'Cobalt', 'Velvet'].map((artist, index) => ({
                ...recording(artist, index, 'soundcloud'),
                waveSeedWeight: 2,
              }));
        const excluded = seeds[0] ? [recording('Arbor', 4, 'soundcloud').id] : [];
        const disliked = seeds[0]
          ? [
              {
                id: 'other-upload',
                title: recording('Cobalt', 3, 'soundcloud').title,
                artist: 'Cobalt',
              },
            ]
          : [];
        const context = {
          recentTracks: seeds.slice(0, 1),
          offeredTracks: seeds.slice(1, 2),
          artistFeedback: { cobalt: -0.5 },
        };
        const tracks = await WaveEngine.getWaveBatch(
          mood,
          seeds,
          excluded,
          [],
          disliked,
          context,
          false,
        );
        results[profile + ':' + mood] = {
          ids: tracks.map((track) => track.id),
          counters: { ...counters },
        };
      }
    return results;
  } finally {
    Math.random = originalRandom;
    WaveEngine.sessionPrints = memory;
    WaveEngine.relatedAnchorIds = anchors;
    [
      SoundCloudService.search,
      YouTubeMusicService.search,
      LastFmService.getSimilarArtists,
      SoundCloudService.getRelatedTracks,
      YouTubeMusicService.getRadioTracks,
    ] = originals;
  }
}
