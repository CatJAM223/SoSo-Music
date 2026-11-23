export type ArtistDestination = {
  id?: string | number;
  name: string;
  source?: string;
  picture?: string;
};

export type NavigateToArtist = (
  artist: ArtistDestination,
  choices?: ArtistDestination[],
  beforeNavigation?: () => void,
) => void;
