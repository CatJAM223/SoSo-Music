import { logger } from '../../src/shared/utils/logger.ts';
import fs from 'node:fs/promises';
import { initializeRustCompute } from '../../src/shared/compute/rustCore.ts';
import { summarizeWaveQuality } from '../../src/shared/services/waveQuality.ts';
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run report:wave -- <playback.log> [playback.old.log]');
  process.exitCode = 1;
} else {
  logger.setLevel('warn');
  if (
    !(await initializeRustCompute(
      await fs.readFile(new URL('../../public/compute/soso-core.wasm', import.meta.url)),
    ))
  )
    throw Error('Rust compute unavailable');
  const events = [];
  for (const file of files) {
    for (const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)) {
      const marker = line.indexOf('[Wave:Quality]'),
        start = line.indexOf(' | ', marker);
      if (marker < 0 || start < 0) continue;
      try {
        events.push(JSON.parse(line.slice(start + 3)));
      } catch {
        /* Partial crash/rotation line. */
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        schema: 1,
        note: 'Observed local outcomes, not a controlled A/B result. Errors, interruptions and incomplete episodes are excluded from taste rates; completion requires >=80% actual listening.',
        cohorts: summarizeWaveQuality(events),
      },
      null,
      2,
    ),
  );
}
