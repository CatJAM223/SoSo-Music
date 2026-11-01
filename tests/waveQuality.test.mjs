import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeWaveBatch,
  markWaveLike,
  WaveQualityEpisode,
  summarizeWaveQuality,
} from '../src/shared/services/waveQuality.ts';
const track = {
  id: 'yt_one',
  source: 'youtube',
  title: 'Silver River',
  artist: { name: 'Fixture Band' },
  album: { title: '' },
  duration: 180,
  preview: '',
};
test('Wave attribution is immutable and retry/buffering notifications do not multiply starts or outcomes', () => {
  const events = [],
    emit = (event) => events.push(event);
  const [recommended] = attributeWaveBatch([track], 'default', ['Fixture Band'], emit);
  assert.equal(track.waveRecommendation, undefined);
  assert.equal(recommended.waveRecommendation.familiar, true);
  attributeWaveBatch([recommended], 'default', [], emit);
  const episode = new WaveQualityEpisode(recommended, 'episode-one', emit);
  episode.started();
  episode.started();
  episode.finish(175, 180, 'ended');
  episode.finish(4, 180, 'skip');
  markWaveLike(recommended, emit);
  markWaveLike(recommended, emit);
  const summary = summarizeWaveQuality([...events, ...events])[0];
  assert.equal(summary.offered, 1);
  assert.equal(summary.started, 1);
  assert.equal(summary.completions, 1);
  assert.equal(summary.earlySkips, 0);
  assert.equal(summary.liked, 1);
});
test('Wave quality excludes network errors, interruption, incomplete and unstarted attempts from taste rates', () => {
  const events = [],
    emit = (event) => events.push(event);
  const [recommended] = attributeWaveBatch([track], 'discover', [], emit);
  for (const [id, reason, seconds] of [
    ['skip', 'skip', 3],
    ['complete', 'ended', 175],
    ['network', 'error', 3],
    ['interrupt', 'interrupted', 3],
  ]) {
    const episode = new WaveQualityEpisode(recommended, id, emit);
    episode.started();
    episode.finish(seconds, 180, reason);
  }
  new WaveQualityEpisode(recommended, 'pending', emit).started();
  new WaveQualityEpisode(recommended, 'never-started', emit).finish(0, 180, 'error');
  const result = summarizeWaveQuality(events)[0];
  assert.equal(result.started, 5);
  assert.equal(result.eligibleOutcomes, 2);
  assert.equal(result.errors, 1);
  assert.equal(result.interrupted, 1);
  assert.equal(result.incomplete, 1);
  assert.equal(result.selectedWithoutStart, 1);
  assert.equal(result.earlySkipRate, 0.5);
  assert.equal(result.completionRate, 0.5);
  assert.equal(result.novelStarts, 5);
});
test('Partial and malformed log ranges do not create a taste denominator', () => {
  const events = [],
    [recommended] = attributeWaveBatch([track], 'chill', [], (e) => events.push(e));
  const episode = new WaveQualityEpisode(recommended, 'cropped', (e) => events.push(e));
  episode.started();
  episode.finish(3, 180, 'skip');
  const cropped = events.filter((e) => e.event !== 'selected');
  assert.equal(summarizeWaveQuality([null, {}, ...cropped])[0].eligibleOutcomes, 0);
});

test('Offer attribution records final queue positions and separates the new ranker cohort', () => {
  const events = [];
  const [value] = attributeWaveBatch([track], 'default', [], (event) => events.push(event), [7]);
  assert.equal(value.waveRecommendation.rank, 7);
  assert.equal(events[0].rank, 7);
  assert.equal(events[0].ranker, 'rust-sequence-v2');
});
