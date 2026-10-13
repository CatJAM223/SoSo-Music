import { useSyncExternalStore } from 'react';
import {
  isYouTubePlaybackDisabled,
  subscribeYouTubeAvailability,
} from '../services/youtubeAvailability';
export function useYouTubeAvailability(): boolean {
  return useSyncExternalStore(subscribeYouTubeAvailability, isYouTubePlaybackDisabled, () => false);
}
