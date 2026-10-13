export interface LibraryTasteGenre {
  name: string;
  tracks: number;
  share: number;
}

export interface LibraryTasteReport {
  apiKeyConfigured?: boolean;
  autoAnalyze: boolean;
  running: boolean;
  totalTracks: number;
  processedTracks: number;
  matchedTracks: number;
  missingTracks: number;
  failedTracks: number;
  updatedAt: number | null;
  genres: LibraryTasteGenre[];
  error?: string;
}
