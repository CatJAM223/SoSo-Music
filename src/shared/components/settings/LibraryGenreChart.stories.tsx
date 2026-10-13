import { LibraryGenreChart } from './LibraryGenreChart';
const genres = [
  { name: 'rock', tracks: 29, share: 0.81 },
  { name: 'punk', tracks: 15, share: 0.51 },
  { name: 'grunge', tracks: 17, share: 0.48 },
  { name: 'hip hop', tracks: 17, share: 0.48 },
  { name: 'alternative rock', tracks: 8, share: 0.35 },
  { name: 'pop', tracks: 7, share: 0.3 },
];
export default {
  title: 'Settings/LibraryGenreChart',
  component: LibraryGenreChart,
  render: () => (
    <div className="settings-modal" style={{ padding: 24, height: 'auto' }}>
      <LibraryGenreChart genres={genres} />
    </div>
  ),
};
export const Genres = {
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const genre = canvasElement.querySelector<HTMLButtonElement>('.library-taste-genres button');
    genre?.focus();
    for (
      let attempt = 0;
      attempt < 50 && !canvasElement.querySelector('[role="tooltip"]');
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!canvasElement.querySelector('[role="tooltip"]')?.textContent?.includes('29 треков'))
      throw new Error('Genre track count is missing');
  },
};
