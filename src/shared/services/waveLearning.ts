import type { MusicSource, WaveMood } from '../types/index.ts';
import {
  WAVE_METHODS,
  readWaveNovelty,
  type WaveMethodScores,
  type WaveNovelty,
} from '../types/wavePolicy.ts';
import { getWavePlaybackFeedback } from '../utils/waveFeedback.ts';
import type { WaveQualityEvent } from './waveQuality.ts';

export const WAVE_POLICY_KEY = 'soso:wave-policy';
export const WAVE_NOVELTY_KEY = 'soso:wave-novelty:v1';
export const WAVE_LEARNING_KEY = 'soso:wave-learning:v1';
const MAX_BYTES = 128 * 1024;
const MAX_GROUPS = 64;
const MAX_EPISODES = 512;
const HALF_LIFE = 30 * 86_400_000;
const MIN_EVIDENCE = 5;
const PRIOR = 6;
const SUCCESS = 0.45;
const SKIP = -0.6;
const LIKE = 1;
const DISLIKE = -1;
const sources = ['all', 'youtube', 'soundcloud'];
const moods = ['default', 'energy', 'chill', 'discover', 'mix', 'favorites'];

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Group = { at: number; count: number; sum: number };
type Episode = { episodeId: string; liked: boolean; at: number; group?: number; reward?: number };

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
export function wavePolicyEnabled(): boolean {
  try {
    return localStorageOrUndefined()?.getItem(WAVE_POLICY_KEY) !== 'legacy';
  } catch {
    return true;
  }
}
export function loadWaveNovelty(): WaveNovelty {
  try {
    return readWaveNovelty(localStorageOrUndefined()?.getItem(WAVE_NOVELTY_KEY)) || 'balanced';
  } catch {
    return 'balanced';
  }
}
export function saveWaveNovelty(value: WaveNovelty): void {
  try {
    localStorageOrUndefined()?.setItem(WAVE_NOVELTY_KEY, value);
  } catch {
    /* The current session still retains the setting. */
  }
}

export function createWaveLearning(storage = localStorageOrUndefined(), now = Date.now) {
  const groups = new Map<number, Group>();
  const episodes = new Map<string, Episode>();
  let revision: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const decay = (age: number) => 0.5 ** (Math.max(0, age) / HALF_LIFE);
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && /^[\w:-]{1,96}$/.test(id);
  const validTime = (at: unknown): at is number =>
    typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 && at <= now() + 60_000;
  const validGroup = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isInteger(id) &&
    id >= 0 &&
    id < WAVE_METHODS.length * moods.length * sources.length;
  try {
    const raw = storage?.getItem(WAVE_LEARNING_KEY);
    const saved =
      raw && raw.length <= MAX_BYTES && new TextEncoder().encode(raw).length <= MAX_BYTES
        ? JSON.parse(raw)
        : null;
    if (saved?.version === 1 && Number.isSafeInteger(saved.revision) && saved.revision >= 0) {
      revision = saved.revision;
      for (const row of (Array.isArray(saved.groups) ? saved.groups : []).slice(-MAX_GROUPS)) {
        if (!Array.isArray(row)) continue;
        const [id, at, count, sum] = row;
        if (
          validGroup(id) &&
          validTime(at) &&
          Number.isFinite(count) &&
          count > 0 &&
          count <= 1e6 &&
          Number.isFinite(sum) &&
          Math.abs(sum) <= count
        )
          groups.set(id, { at, count, sum });
      }
      for (const row of (Array.isArray(saved.episodes) ? saved.episodes : []).slice(
        -MAX_EPISODES,
      )) {
        if (!Array.isArray(row)) continue;
        const [id, episodeId, at, group, reward, liked] = row;
        if (
          validId(id) &&
          validId(episodeId) &&
          validTime(at) &&
          (group === null || (validGroup(group) && groups.has(group))) &&
          [DISLIKE, SKIP, 0, SUCCESS, LIKE].includes(reward) &&
          typeof liked === 'boolean'
        )
          episodes.set(id, { episodeId, at, group: group ?? undefined, reward, liked });
      }
    }
  } catch {
    /* Unreadable local state starts empty. */
  }

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!storage || !dirty) return;
    try {
      const raw = JSON.stringify({
        version: 1,
        revision,
        groups: [...groups].map(([id, { at, count, sum }]) => [id, at, count, sum]),
        episodes: [...episodes].flatMap(([id, e]) =>
          e.reward === undefined ? [] : [[id, e.episodeId, e.at, e.group, e.reward, e.liked]],
        ),
      });
      if (raw.length <= MAX_BYTES) storage.setItem(WAVE_LEARNING_KEY, raw);
      dirty = false;
    } catch {
      /* Disabled or full storage leaves learning in memory. */
    }
  };
  const schedule = () => {
    dirty = true;
    if (storage && timer === undefined) timer = setTimeout(flush, 5000);
  };
  const sync = (next: number) => {
    if (!Number.isSafeInteger(next) || next < 0 || next === revision) return;
    revision = next;
    groups.clear();
    episodes.clear();
    schedule();
  };
  const add = (id: number, count: number, sum: number, at: number) => {
    const previous = groups.get(id);
    if (!previous && !count) return; // A late like cannot revive an evicted aggregate.
    const stamp = Math.max(at, now(), previous?.at || 0);
    const oldWeight = previous ? decay(stamp - previous.at) : 0;
    const weight = decay(stamp - at);
    const total = (previous?.count || 0) * oldWeight + count * weight;
    const reward = (previous?.sum || 0) * oldWeight + sum * weight;
    const scale = Math.min(1, 1e6 / total);
    groups.delete(id);
    groups.set(id, {
      at: stamp,
      count: total * scale,
      sum: Math.max(-total, Math.min(total, reward)) * scale,
    });
    if (groups.size > MAX_GROUPS) {
      const evicted = groups.keys().next().value!;
      groups.delete(evicted);
      for (const [key, episode] of episodes) {
        if (episode.group === evicted) episodes.set(key, { ...episode, group: undefined });
      }
    }
  };
  const groupFor = (event: WaveQualityEvent) => {
    const method = WAVE_METHODS.indexOf(event.method!);
    const mood = moods.indexOf(event.mood);
    const source = sources.indexOf(event.selectedSource || '');
    return method < 0 || mood < 0 || source < 0
      ? -1
      : (mood * sources.length + source) * WAVE_METHODS.length + method;
  };
  return {
    flush,
    sync,
    observe(event: WaveQualityEvent, policyRevision: number) {
      if (policyRevision < 0) return;
      sync(policyRevision);
      if (event.tasteRevision !== revision || !validId(event.recommendationId)) return;
      const id = event.recommendationId;
      const episode = episodes.get(id);
      if (event.event === 'disliked') {
        if (!episode || episode.reward === DISLIKE) return;
        const group = episode.group ?? groupFor(event);
        if (group < 0) return;
        if (episode.reward === undefined) {
          episode.at = now();
          episode.group = group;
          add(group, 1, DISLIKE, episode.at);
        } else if (episode.group !== undefined) {
          add(group, 0, DISLIKE - episode.reward, episode.at);
        }
        episode.liked = false;
        episode.reward = DISLIKE;
        schedule();
        return;
      }
      if (event.event === 'liked') {
        if (!episode || episode.liked) return;
        episode.liked = true;
        if (episode.reward !== undefined && episode.group !== undefined) {
          add(episode.group, 0, LIKE - episode.reward, episode.at);
          episode.reward = LIKE;
          schedule();
        }
        return;
      }
      if (!validId(event.episodeId)) return;
      const group = groupFor(event);
      if (group < 0) return;
      if (event.event === 'started') {
        if (episode) return;
        if (episodes.size >= MAX_EPISODES) episodes.delete(episodes.keys().next().value!);
        episodes.set(id, { episodeId: event.episodeId, at: now(), liked: false });
        return;
      }
      if (
        event.event !== 'outcome' ||
        episode?.episodeId !== event.episodeId ||
        episode.reward !== undefined
      )
        return;
      if (event.reason !== 'skip' && event.reason !== 'ended') {
        episodes.delete(id);
        return;
      }
      const seconds = event.playedSeconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0.5) {
        episodes.delete(id);
        return;
      }
      const reaction = getWavePlaybackFeedback(
        seconds,
        event.durationSeconds || 0,
        event.reason,
        event.mood,
      );
      episode.at = now();
      episode.group = group;
      episode.reward = episode.liked ? LIKE : reaction > 0 ? SUCCESS : reaction < 0 ? SKIP : 0;
      add(group, 1, episode.reward, episode.at);
      schedule();
    },
    scores(
      mood: WaveMood,
      source: MusicSource,
      policyRevision: number,
    ): WaveMethodScores | undefined {
      if (policyRevision < 0) return;
      sync(policyRevision);
      const offset =
        (moods.indexOf(mood) * sources.length + sources.indexOf(source)) * WAVE_METHODS.length;
      const scores: WaveMethodScores = {};
      for (const [i, method] of WAVE_METHODS.entries()) {
        const group = groups.get(offset + i);
        if (!group) continue;
        const weight = decay(now() - group.at);
        const count = group.count * weight;
        if (count >= MIN_EVIDENCE) scores[method] = (group.sum * weight) / (count + PRIOR);
      }
      return Object.keys(scores).length ? scores : undefined;
    },
  };
}
