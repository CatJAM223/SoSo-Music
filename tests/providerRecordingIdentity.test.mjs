import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeMusicService as YT } from '../src/desktop/main/services/youtubeMusic.ts';
import { YouTubeMusicTransport } from '../src/desktop/main/services/youtubeMusicTransport.ts';

for (const platform of ['desktop']) {
  test(
    platform + ': player metadata for a previous YouTube recording is rejected and never cached',
    async (t) => {
      let calls = 0,
        wrong = true;
      const wanted = 'chosen00001';
      const reply = () => ({
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: wrong ? 'previous001' : wanted },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 140,
              mimeType: 'audio/mp4',
              url: 'https://rr1.googlevideo.com/videoplayback?fixture=' + calls,
            },
          ],
        },
      });
      {
        t.mock.method(YT, 'getVisitorData', async () => '');
        t.mock.method(YouTubeMusicTransport, 'postPlayer', async () => {
          calls++;
          return Response.json(reply());
        });
      }
      const resolve = () => YT.resolveDirectAudioStream(wanted);
      assert.equal(await resolve(), '');
      wrong = false;
      const healthy = await resolve();
      assert.ok(healthy.includes('googlevideo.com'));
      assert.equal(await resolve(), healthy);
      assert.equal(calls, 2);
    },
  );
}
