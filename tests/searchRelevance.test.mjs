import test from 'node:test';
import assert from 'node:assert/strict';

import { MusicAggregatorService } from '../src/desktop/main/services/musicAggregator.ts';
const rankSearchTracks = MusicAggregatorService.rankSearchTracks;

test('Search Relevance: Ranks exact artist or track title match highest', () => {
  const query = 'Гражданская Оборона';
  const candidates = [
    {
      id: 'sc_1',
      title: 'Random Track by Someone',
      artist: { name: 'DJ Fan' },
      album: { title: 'Single' },
      duration: 180,
      source: 'soundcloud',
    },
    {
      id: 'sc_2',
      title: 'Все идет по плану',
      artist: { name: 'Гражданская Оборона' },
      album: { title: 'Все идет по плану' },
      duration: 210,
      source: 'soundcloud',
    },
    {
      id: 'sc_3',
      title: 'Гражданская Оборона 10 hours loop',
      artist: { name: 'Memes' },
      album: { title: 'Single' },
      duration: 36000,
      source: 'soundcloud',
    },
    {
      id: 'yt_1',
      title: 'Гражданская Оборона',
      artist: { name: 'Гражданская Оборона' },
      album: { title: 'Дискография' },
      duration: 195,
      source: 'youtube',
    },
  ];

  const ranked = rankSearchTracks(candidates, query);

  assert.equal(ranked[0].id, 'yt_1');
  assert.equal(ranked[0].source, 'youtube');
  assert.equal(ranked[1].id, 'sc_2');
  assert.equal(ranked[1].source, 'soundcloud');
  assert.equal(ranked[ranked.length - 1].title, 'Гражданская Оборона 10 hours loop');
});

test('Search Relevance: Heavily penalizes 1-hour loops, podcasts, karaoke, and type beats', () => {
  const query = 'Miyagi Captain';
  const candidates = [
    {
      id: 'sc_loop',
      title: 'Miyagi Captain 1 hour loop',
      artist: { name: 'Looper' },
      album: { title: 'Single' },
      duration: 3600,
      source: 'soundcloud',
    },
    {
      id: 'sc_podcast',
      title: 'Miyagi Captain discussion podcast review',
      artist: { name: 'HipHop Podcast' },
      album: { title: 'Single' },
      duration: 1200,
      source: 'soundcloud',
    },
    {
      id: 'sc_typebeat',
      title: 'Miyagi type beat - Captain style',
      artist: { name: 'Beatmaker' },
      album: { title: 'Single' },
      duration: 150,
      source: 'soundcloud',
    },
    {
      id: 'sc_karaoke',
      title: 'Miyagi - Captain (Караоке / Минусовка)',
      artist: { name: 'Karaoke Channel' },
      album: { title: 'Single' },
      duration: 180,
      source: 'soundcloud',
    },
    {
      id: 'sc_official',
      title: 'Captain',
      artist: { name: 'Miyagi' },
      album: { title: 'Buster Keaton' },
      duration: 215,
      source: 'soundcloud',
    },
  ];

  const ranked = rankSearchTracks(candidates, query);

  assert.equal(ranked[0].id, 'sc_official');
  assert.equal(ranked[0].title, 'Captain');

  const officialIdx = ranked.findIndex((t) => t.id === 'sc_official');
  const loopIdx = ranked.findIndex((t) => t.id === 'sc_loop');
  const podcastIdx = ranked.findIndex((t) => t.id === 'sc_podcast');
  const beatIdx = ranked.findIndex((t) => t.id === 'sc_typebeat');
  const karaokeIdx = ranked.findIndex((t) => t.id === 'sc_karaoke');

  assert.ok(officialIdx < loopIdx);
  assert.ok(officialIdx < podcastIdx);
  assert.ok(officialIdx < beatIdx);
  assert.ok(officialIdx < karaokeIdx);
});

test('Search Relevance: Deduplicates tracks across SoundCloud and YouTube', () => {
  const query = 'Numb';
  const candidates = [
    {
      id: 'sc_1',
      title: 'Numb',
      artist: { name: 'Linkin Park' },
      album: { title: 'Meteora' },
      duration: 187,
      source: 'soundcloud',
    },
    {
      id: 'yt_1',
      title: 'Numb',
      artist: { name: 'Linkin Park' },
      album: { title: 'Meteora' },
      duration: 187,
      source: 'youtube',
    },
    {
      id: 'sc_2',
      title: 'In The End',
      artist: { name: 'Linkin Park' },
      album: { title: 'Hybrid Theory' },
      duration: 216,
      source: 'soundcloud',
    },
  ];

  const ranked = rankSearchTracks(candidates, query);

  const numbTracks = ranked.filter((t) => t.title.toLowerCase() === 'numb');
  assert.equal(numbTracks.length, 1);
  assert.equal(ranked.length, 2);
});

test('Search Relevance: Multi-part query Artist - Track ranks official track #1 above UGC reuploads and remixes', () => {
  const query = 'madk1d - дырки в штанах';
  const candidates = [
    {
      id: 'sc_ugc_1',
      title: 'madk1d - дырки в штанах (reupload by xXUserXx)',
      artist: { name: 'User Reupload Channel' },
      album: { title: 'Single' },
      duration: 125,
      source: 'soundcloud',
    },
    {
      id: 'sc_remix',
      title: 'дырки в штанах (slowed + reverb)',
      artist: { name: 'madk1d' },
      album: { title: 'Single' },
      duration: 140,
      source: 'soundcloud',
    },
    {
      id: 'sc_cover',
      title: 'дырки в штанах (guitar cover)',
      artist: { name: 'Guitarist 99' },
      album: { title: 'Single' },
      duration: 130,
      source: 'soundcloud',
    },
    {
      id: 'yt_official',
      title: 'дырки в штанах',
      artist: { name: 'madk1d' },
      album: { title: 'дырки в штанах' },
      duration: 124,
      source: 'youtube',
    },
  ];

  const ranked = rankSearchTracks(candidates, query);
  assert.equal(ranked[0].id, 'yt_official');
  assert.equal(ranked[0].artist.name, 'madk1d');
  assert.equal(ranked[0].title, 'дырки в штанах');
});
