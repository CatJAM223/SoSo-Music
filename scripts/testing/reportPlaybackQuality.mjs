import fs from 'node:fs/promises';
import { summarizePlaybackQuality } from '../../src/shared/utils/playbackQualityReport.ts';

const files = process.argv.slice(2);
if (!files.length) {
  console.error(
    'Usage: node --experimental-strip-types scripts/testing/reportPlaybackQuality.mjs <playback.log> [playback.old.log]',
  );
  process.exitCode = 1;
} else {
  const events = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const marker = line.indexOf('[Playback:Quality]');
      if (marker < 0) continue;
      const start = line.indexOf(' | ', marker);
      if (start < 0) continue;
      try {
        const event = JSON.parse(line.slice(start + 3));
        if (event && typeof event.event === 'string' && typeof event.source === 'string')
          events.push(event);
      } catch {
        /* A crash or rotation can leave one partial log line. */
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        schema: 1,
        events: events.length,
        note: 'Per-request startup outcomes; cancellations and incomplete attempts are separate. Latency ends at playing, not physical audio output. Buffering excludes initial loading.',
        sources: summarizePlaybackQuality(events),
      },
      null,
      2,
    ),
  );
}
