import { useState } from 'react';
import { WaveControl } from './WaveControl';
import type { MusicSource, WaveMood } from '../../../shared/types';

function Demo() {
  const [mood, setMood] = useState<WaveMood>('default');
  const [source, setSource] = useState<MusicSource>('all');
  const [playing, setPlaying] = useState(false);
  return (
    <div className="wave-hero" style={{ padding: 24, maxWidth: 760 }}>
      <WaveControl
        mood={mood}
        source={source}
        onSelectSource={setSource}
        isActive={playing}
        isPlaying={playing}
        isLoading={false}
        isStarting={false}
        onToggle={() => setPlaying(!playing)}
        onSelectMood={(next) => {
          setMood(next);
          setPlaying(true);
        }}
        onReset={() => setPlaying(true)}
      />
    </div>
  );
}
export default { title: 'Discover/WaveControl', component: WaveControl, render: () => <Demo /> };
export const Closed = {};
export const Open = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('.wave-settings')!.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (canvasElement.querySelectorAll('[data-wave-slice]').length !== 6)
      throw Error('Expected five modes and a reset slice');
  },
};
export const SelectEnergy = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await Open.play({ canvasElement });
    canvasElement.querySelector<HTMLButtonElement>('[data-wave-slice="energy"]')!.focus();
    await new Promise((resolve) => setTimeout(resolve, 600));
    canvasElement.querySelector<HTMLButtonElement>('[data-wave-slice="energy"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (
      canvasElement.querySelector('[data-wave-slice="energy"]')?.getAttribute('aria-pressed') !==
      'true'
    )
      throw Error('Selected mode was not retained');
  },
};

export const SelectSource = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await Open.play({ canvasElement });
    canvasElement.querySelector<HTMLButtonElement>('[data-wave-source="youtube"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (
      canvasElement.querySelector('[data-wave-source="youtube"]')?.getAttribute('aria-pressed') !==
      'true'
    )
      throw Error('Selected source was not retained');
    if (canvasElement.querySelector('.wave-sources')?.getAttribute('aria-hidden') !== 'false')
      throw Error('Source selection closed settings');
  },
};
