import React from 'react';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';

/**
 * Headless controller: subscribes to window pause signals once for the whole
 * app and toggles html[data-anim-paused] so CSS animations freeze too.
 */
export const AnimationPauseController: React.FC = () => {
  useAnimationsPaused();
  return null;
};
