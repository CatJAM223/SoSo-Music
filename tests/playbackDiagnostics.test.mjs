import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackDiagnostics } from '../src/shared/utils/playbackDiagnostics.ts';
import { summarizePlaybackQuality } from '../src/shared/utils/playbackQualityReport.ts';

test('Startup outcomes include queue preparation, distinguish cancellation and count playing once', () => {
  let now = 500;
  const events = [];
  const diagnostics = new PlaybackDiagnostics(
    (event) => events.push(event),
    () => now,
  );
  diagnostics.begin(1, 'first', 'youtube', 100);
  now = 600;
  diagnostics.begin(2, 'second', 'youtube');
  now = 900;
  diagnostics.playing('progressive');
  diagnostics.playing('progressive');
  diagnostics.cancel('teardown');
  const outcomes = events.filter((event) => event.event === 'playback-outcome');
  assert.deepEqual(
    outcomes.map((event) => [event.requestId, event.outcome, event.elapsedMs]),
    [
      [1, 'cancelled', 500],
      [2, 'started', 300],
    ],
  );
  assert.equal(outcomes[1].delivery, 'progressive');
});

test('Buffering excludes initial loading, deduplicates waiting and closes on pause and failure', () => {
  let now = 0;
  const events = [];
  const diagnostics = new PlaybackDiagnostics(
    (event) => events.push(event),
    () => now,
  );
  diagnostics.begin(1, 'first', 'soundcloud');
  diagnostics.waiting();
  now = 100;
  diagnostics.playing('hls');
  diagnostics.waiting();
  now = 150;
  diagnostics.waiting();
  now = 400;
  diagnostics.playing('hls');
  diagnostics.waiting();
  now = 450;
  diagnostics.pause();
  now = 1000;
  diagnostics.playing('hls');
  diagnostics.waiting();
  now = 1100;
  diagnostics.failed('network');
  diagnostics.failed('network');
  diagnostics.cancel('teardown');
  assert.deepEqual(
    events
      .filter((event) => event.event === 'playback-buffering')
      .map((event) => [event.reason, event.durationMs]),
    [
      ['recovered', 300],
      ['pause', 50],
      ['failed', 100],
    ],
  );
  assert.equal(events.filter((event) => event.event === 'playback-interruption').length, 1);
  const [report] = summarizePlaybackQuality(events);
  assert.equal(report.started, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.interrupted, 1);
  assert.equal(report.bufferingMs, 450);
});

test('Failed automatic retries, incomplete logs and cancellation remain separate in reports', () => {
  const events = [];
  const diagnostics = new PlaybackDiagnostics(
    (event) => events.push(event),
    () => 0,
  );
  diagnostics.begin(1, 'private-title', 'youtube');
  diagnostics.failed('network');
  diagnostics.begin(2, 'private-title', 'youtube', 0, true);
  diagnostics.pause();
  diagnostics.begin(3, 'private-title', 'youtube');
  const [report] = summarizePlaybackQuality(events);
  assert.equal(report.attempts, 3);
  assert.equal(report.failed, 1);
  assert.equal(report.cancelled, 1);
  assert.equal(report.unmatchedAttempts, 1);
  assert.equal(report.automaticRetries, 1);
  assert.equal(report.startupP95Ms, null);
  assert.equal(JSON.stringify(report).includes('private-title'), false);
});

test('A diagnostic transport failure cannot break playback commands', () => {
  const diagnostics = new PlaybackDiagnostics(() => {
    throw Error('IPC gone');
  });
  assert.doesNotThrow(() => {
    diagnostics.begin(1, 'one', 'youtube');
    diagnostics.playing('progressive');
    diagnostics.waiting();
    diagnostics.failed('network');
    diagnostics.cancel('teardown');
  });
});

test('Resuming a cancelled initial start creates a fresh sample while healthy resume keeps its sample', () => {
  const events = [];
  const diagnostics = new PlaybackDiagnostics(
    (event) => events.push(event),
    () => 0,
  );
  diagnostics.begin(1, 'one', 'youtube');
  diagnostics.pause();
  diagnostics.resume(1, 'one', 'youtube');
  diagnostics.playing('progressive');
  diagnostics.pause();
  diagnostics.resume(1, 'one', 'youtube');
  diagnostics.playing('progressive');
  const [row] = summarizePlaybackQuality(events);
  assert.equal(row.attempts, 2);
  assert.equal(row.cancelled, 1);
  assert.equal(row.started, 1);
});

test('Source recovery succeeds only on real playing and cancellation never counts as failure', () => {
  const events = [];
  let now = 0;
  const diagnostics = new PlaybackDiagnostics(
    (event) => events.push(event),
    () => now,
  );
  diagnostics.begin(1, 'one', 'youtube');
  diagnostics.playing('progressive');
  diagnostics.recovering();
  diagnostics.recovering();
  now = 500;
  diagnostics.playing('progressive');
  diagnostics.recovering();
  diagnostics.pause();
  diagnostics.recovering();
  diagnostics.failed('network');
  const [row] = summarizePlaybackQuality(events);
  assert.equal(row.recoveryAttempts, 3);
  assert.equal(row.recovered, 1);
  assert.equal(row.recoveryCancelled, 1);
  assert.equal(row.recoveryFailures, 1);
  assert.equal(row.started, 1);
});
