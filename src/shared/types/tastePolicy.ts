export type TasteExclusionScope = 'track' | 'playlist';
export interface PlaybackOrigin {
  kind: 'playlist' | 'album' | 'artist' | 'library' | 'search' | 'wave' | 'manual';
  id?: string;
}
export interface TasteExclusion {
  scope: TasteExclusionScope;
  id: string;
  label: string;
}
export interface TastePolicySnapshot {
  revision: number;
  exclusions: TasteExclusion[];
}
export interface TasteExclusionChange extends TasteExclusion {
  excluded: boolean;
}
