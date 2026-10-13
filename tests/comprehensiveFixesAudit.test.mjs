import test from 'node:test';
import assert from 'node:assert/strict';

import { platformBridge } from '../src/shared/bridge/platformBridge.ts';
import { withSoundCloudClientId } from '../src/shared/utils/soundcloudUrl.ts';
import { isCurrentPlaybackRequest } from '../src/shared/utils/playbackRecovery.ts';

test('SoundCloud retry URL helper replaces empty/stale client IDs and appends a missing one', () => {
  const freshKey = 'abc123def456ghi789jkl012mno345pq';

  const emptyKeyUrl = 'https://api-v2.soundcloud.com/search/tracks?q=test&client_id=&limit=20';
  const replacedEmpty = withSoundCloudClientId(emptyKeyUrl, freshKey);
  assert.equal(
    replacedEmpty,
    `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${freshKey}&limit=20`,
    'Empty client_id= must be properly replaced',
  );

  const oldKeyUrl =
    'https://api-v2.soundcloud.com/search/tracks?q=test&client_id=00000000000000000000000000000000&limit=20';
  const replacedOld = withSoundCloudClientId(oldKeyUrl, freshKey);
  assert.equal(
    replacedOld,
    `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${freshKey}&limit=20`,
    'Old client_id= must be properly replaced',
  );

  assert.equal(
    withSoundCloudClientId('https://api-v2.soundcloud.com/search/tracks?q=test', freshKey),
    `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${freshKey}`,
  );
});

// This is the request-identity predicate contract, not a simulated player.
// Real rapid-selection/source races run through useAudioPlayerCore in
// playbackLifecycle.test.mjs.
test('Playback request identity accepts only the current request and current recording', () => {
  assert.equal(isCurrentPlaybackRequest(2, 2, 'track_B', 'track_B'), true);
  assert.equal(isCurrentPlaybackRequest(1, 2, 'track_A', 'track_B'), false);
  assert.equal(
    isCurrentPlaybackRequest(1, 2, 'track_B', 'track_B'),
    false,
    'Same track does not rescue an obsolete request',
  );
  assert.equal(
    isCurrentPlaybackRequest(2, 2, 'track_A', 'track_B'),
    false,
    'Latest request cannot commit another recording',
  );
});
