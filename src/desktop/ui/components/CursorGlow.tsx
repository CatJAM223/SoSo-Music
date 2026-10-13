import React, { useEffect, useState } from 'react';
import { useTheme } from '../../../shared/context/ThemeContext';

export const CursorGlow: React.FC = () => {
  const { cursorGlow, themePreset, themeMode } = useTheme();
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -500, y: -500 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!cursorGlow) {
      setVisible(false);
      return;
    }

    let animationFrameId: number;

    const handlePointerMove = (e: PointerEvent) => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY });
        if (!visible) setVisible(true);
      });
    };

    const handlePointerLeave = () => {
      setVisible(false);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [cursorGlow, visible]);

  if (!cursorGlow || !visible) return null;

  // Opacity slightly lower in light mode to keep clean readability
  const isLight = themePreset === 'default' && themeMode === 'light';
  const glowOpacity = isLight ? 0.05 : 0.09;
  const radius = isLight ? 380 : 480;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-30 transition-opacity duration-300 overflow-hidden"
      style={{
        background: `radial-gradient(${radius}px circle at ${pos.x}px ${pos.y}px, rgba(var(--theme-accent-rgb, 34, 197, 94), ${glowOpacity}), transparent 75%)`,
      }}
    />
  );
};
