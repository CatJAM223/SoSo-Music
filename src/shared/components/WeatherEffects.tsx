import React, { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';

interface Leaf {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  vRotX: number;
  vRotY: number;
  vRotZ: number;
  swayPhase: number;
  swaySpeed: number;
  swayRadius: number;
  opacity: number;
  leafType: number; // 0 = Birch, 1 = Oak, 2 = Maple
  colorScheme: number;
}

interface RainDrop {
  x: number;
  y: number;
  length: number;
  vx: number;
  vy: number;
  alpha: number;
  width: number;
}

interface SplashRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export const WeatherEffects: React.FC = () => {
  const { themePreset, weatherMode } = useTheme();
  const isPaused = useAnimationsPaused();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (themePreset !== 'weather' || isPaused) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const isRain = weatherMode === 'rain';
    const LEAF_COUNT = isRain ? 28 : 22;
    const RAIN_COUNT = isRain ? 130 : 0;

    // --- LEAF FACTORY ---
    const createLeaf = (scatterAcrossScreen: boolean = false): Leaf => {
      let startX: number;
      let startY: number;

      if (scatterAcrossScreen) {
        startX = Math.random() * (width + 250) - 100;
        startY = Math.random() * (height + 250) - 100;
      } else {
        if (Math.random() < 0.7) {
          startX = Math.random() * width * 0.9 - 80;
          startY = -40 - Math.random() * 90;
        } else {
          startX = -50 - Math.random() * 80;
          startY = Math.random() * height * 0.8 - 40;
        }
      }

      if (isRain) {
        // Rainy Weather (Gracefully drifting autumn leaves with gentle wind)
        return {
          x: startX,
          y: startY,
          size: 9 + Math.random() * 8,
          vx: 3.2 + Math.random() * 2.8,
          vy: 2.2 + Math.random() * 1.8,
          rotX: Math.random() * Math.PI * 2,
          rotY: Math.random() * Math.PI * 2,
          rotZ: Math.random() * Math.PI * 2,
          vRotX: (Math.random() - 0.5) * 0.05,
          vRotY: (Math.random() - 0.5) * 0.07,
          vRotZ: (Math.random() - 0.5) * 0.04,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.025 + Math.random() * 0.035,
          swayRadius: 1.8 + Math.random() * 2.0,
          opacity: 0.45 + Math.random() * 0.3,
          leafType: Math.floor(Math.random() * 3),
          colorScheme: Math.floor(Math.random() * 4),
        };
      } else {
        // Clear / Sunny Weather (Gentle, tranquil, drifting leaves)
        return {
          x: startX,
          y: startY,
          size: 9 + Math.random() * 7,
          vx: 1.2 + Math.random() * 1.5,
          vy: 0.9 + Math.random() * 1.1,
          rotX: Math.random() * Math.PI * 2,
          rotY: Math.random() * Math.PI * 2,
          rotZ: Math.random() * Math.PI * 2,
          vRotX: (Math.random() - 0.5) * 0.025,
          vRotY: (Math.random() - 0.5) * 0.035,
          vRotZ: (Math.random() - 0.5) * 0.02,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: 0.015 + Math.random() * 0.022,
          swayRadius: 1.2 + Math.random() * 1.8,
          opacity: 0.45 + Math.random() * 0.3,
          leafType: Math.floor(Math.random() * 3),
          colorScheme: Math.floor(Math.random() * 4),
        };
      }
    };

    // --- RAIN FACTORY (Sleek, atmospheric, fast diagonal streaks) ---
    const createRainDrop = (scatter: boolean = false): RainDrop => {
      const vx = 3.8 + Math.random() * 3.2;
      const vy = 24.0 + Math.random() * 12.0;
      return {
        x: scatter ? Math.random() * (width + 400) - 200 : Math.random() * (width + 300) - 100,
        y: scatter ? Math.random() * height : -40 - Math.random() * 80,
        length: 28 + Math.random() * 24,
        vx,
        vy,
        alpha: 0.18 + Math.random() * 0.22,
        width: 0.95 + Math.random() * 0.45,
      };
    };

    const leaves: Leaf[] = Array.from({ length: LEAF_COUNT }, () => createLeaf(true));
    const raindrops: RainDrop[] = Array.from({ length: RAIN_COUNT }, () => createRainDrop(true));
    const ripples: SplashRipple[] = [];

    let time = 0;

    // --- DRAW SINGLE LEAF PATH ---
    const drawLeafPath = (type: number, radius: number) => {
      ctx.beginPath();
      if (type === 0) {
        // Classic Oval Leaf with tapered tip & stem base
        ctx.moveTo(0, -radius);
        ctx.bezierCurveTo(
          radius * 0.75,
          -radius * 0.5,
          radius * 0.85,
          radius * 0.4,
          0,
          radius * 0.95,
        );
        ctx.bezierCurveTo(-radius * 0.85, radius * 0.4, -radius * 0.75, -radius * 0.5, 0, -radius);
      } else if (type === 1) {
        // Birch / Beech Leaf with serrated curve
        ctx.moveTo(0, -radius * 1.05);
        ctx.bezierCurveTo(radius * 0.9, -radius * 0.4, radius * 0.7, radius * 0.3, 0, radius * 0.9);
        ctx.bezierCurveTo(
          -radius * 0.7,
          radius * 0.3,
          -radius * 0.9,
          -radius * 0.4,
          0,
          -radius * 1.05,
        );
      } else {
        // 3-Lobe Maple / Oak Autumn Leaf
        ctx.moveTo(0, -radius * 1.1);
        ctx.bezierCurveTo(
          radius * 0.4,
          -radius * 0.8,
          radius * 0.95,
          -radius * 0.3,
          radius * 0.7,
          0,
        );
        ctx.bezierCurveTo(radius * 0.9, radius * 0.4, radius * 0.5, radius * 0.7, 0, radius * 0.95);
        ctx.bezierCurveTo(
          -radius * 0.5,
          radius * 0.7,
          -radius * 0.9,
          radius * 0.4,
          -radius * 0.7,
          0,
        );
        ctx.bezierCurveTo(
          -radius * 0.95,
          -radius * 0.3,
          -radius * 0.4,
          -radius * 0.8,
          0,
          -radius * 1.1,
        );
      }
      ctx.closePath();
    };

    // --- CACHED COLOR GRADIENTS (Drastically reduces CPU overhead) ---
    const gradientCache = new Map<string, CanvasGradient>();
    const getLeafGradient = (
      colorScheme: number,
      radius: number,
      isLightSide: boolean,
    ): CanvasGradient => {
      const r = Math.round(radius);
      const key = `${isRain ? 1 : 0}_${colorScheme}_${isLightSide ? 1 : 0}_${r}`;
      let grad = gradientCache.get(key);
      if (grad) return grad;

      grad = ctx.createLinearGradient(0, -r, 0, r);
      if (!isRain) {
        // Clear / Sunny Weather (Fresh Green & Golden Amber)
        if (colorScheme === 0) {
          grad.addColorStop(0, isLightSide ? '#6ee7b7' : '#34d399');
          grad.addColorStop(0.5, '#10b981');
          grad.addColorStop(1, isLightSide ? '#059669' : '#047857');
        } else if (colorScheme === 1) {
          grad.addColorStop(0, isLightSide ? '#bef264' : '#a3e635');
          grad.addColorStop(0.5, '#84cc16');
          grad.addColorStop(1, isLightSide ? '#65a30d' : '#4d7c0f');
        } else if (colorScheme === 2) {
          grad.addColorStop(0, isLightSide ? '#fef08a' : '#fde047');
          grad.addColorStop(0.5, '#eab308');
          grad.addColorStop(1, isLightSide ? '#ca8a04' : '#a16207');
        } else {
          grad.addColorStop(0, isLightSide ? '#fde68a' : '#fcd34d');
          grad.addColorStop(0.5, '#f59e0b');
          grad.addColorStop(1, isLightSide ? '#d97706' : '#b45309');
        }
      } else {
        // Rainy / Stormy Weather (Deep Terracotta, Ochre & Slate Moss)
        if (colorScheme === 0) {
          grad.addColorStop(0, isLightSide ? '#fdba74' : '#fb923c');
          grad.addColorStop(0.5, '#ea580c');
          grad.addColorStop(1, isLightSide ? '#c2410c' : '#9a3412');
        } else if (colorScheme === 1) {
          grad.addColorStop(0, isLightSide ? '#fef08a' : '#facc15');
          grad.addColorStop(0.5, '#ca8a04');
          grad.addColorStop(1, isLightSide ? '#854d0e' : '#713f12');
        } else if (colorScheme === 2) {
          grad.addColorStop(0, isLightSide ? '#86efac' : '#4ade80');
          grad.addColorStop(0.5, '#16a34a');
          grad.addColorStop(1, isLightSide ? '#15803d' : '#14532d');
        } else {
          grad.addColorStop(0, isLightSide ? '#fed7aa' : '#fb923c');
          grad.addColorStop(0.5, '#d97706');
          grad.addColorStop(1, isLightSide ? '#b45309' : '#78350f');
        }
      }
      gradientCache.set(key, grad);
      return grad;
    };

    let isDisposed = false;
    const render = () => {
      if (isDisposed) return;
      if (document.hidden) {
        setTimeout(() => {
          if (!isDisposed) animationFrameId = requestAnimationFrame(render);
        }, 500);
        return;
      }
      time += 1;
      ctx.clearRect(0, 0, width, height);

      // 1. RENDER RAIN DROPS (BATCHED SINGLE STROKE CALL - ULTRA HIGH PERFORMANCE)
      if (isRain) {
        ctx.save();
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
        ctx.lineWidth = 0.95;
        ctx.beginPath();

        for (let r = 0; r < raindrops.length; r++) {
          const drop = raindrops[r];
          drop.x += drop.vx;
          drop.y += drop.vy;

          if (drop.y > height + 40 || drop.x > width + 60) {
            if (Math.random() < 0.15 && ripples.length < 16) {
              ripples.push({
                x: Math.min(Math.max(10, drop.x), width - 10),
                y: height - 6 - Math.random() * 8,
                radius: 1,
                maxRadius: 6 + Math.random() * 6,
                alpha: 0.35,
              });
            }
            raindrops[r] = createRainDrop(false);
            continue;
          }

          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x + drop.vx * 1.2, drop.y + drop.length);
        }
        ctx.stroke();

        // Render Splash Ripples
        if (ripples.length > 0) {
          ctx.lineWidth = 1;
          for (let i = ripples.length - 1; i >= 0; i--) {
            const rip = ripples[i];
            rip.radius += 0.55;
            rip.alpha -= 0.035;

            if (rip.alpha <= 0 || rip.radius >= rip.maxRadius) {
              ripples.splice(i, 1);
              continue;
            }

            ctx.strokeStyle = `rgba(186, 230, 253, ${rip.alpha * 0.7})`;
            ctx.beginPath();
            ctx.ellipse(rip.x, rip.y, rip.radius * 1.8, rip.radius * 0.6, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 2. RENDER SWIRLING LEAVES
      const windGustX = isRain
        ? Math.sin(time * 0.018) * 1.2 + Math.cos(time * 0.01) * 0.8
        : Math.sin(time * 0.008) * 0.4 + Math.cos(time * 0.005) * 0.25;
      const windGustY = isRain ? Math.cos(time * 0.014) * 0.6 : Math.cos(time * 0.006) * 0.2;

      for (let i = 0; i < leaves.length; i++) {
        const p = leaves[i];

        p.rotX += p.vRotX;
        p.rotY += p.vRotY;
        p.rotZ += p.vRotZ;
        p.swayPhase += p.swaySpeed;

        const flutterX = Math.sin(p.swayPhase) * p.swayRadius;
        const flutterY = Math.cos(p.swayPhase * 0.8) * (p.swayRadius * 0.5);

        p.x += p.vx + windGustX + flutterX;
        p.y += p.vy + windGustY + flutterY;

        if (p.x > width + 80 || p.y > height + 80) {
          leaves[i] = createLeaf(false);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotZ);

        const scaleX = Math.cos(p.rotY);
        const scaleY = Math.sin(p.rotX) * 0.45 + 0.55;
        ctx.scale(scaleX, scaleY);

        ctx.globalAlpha = p.opacity;

        const radius = p.size;
        const grad = getLeafGradient(p.colorScheme, radius, scaleX > 0);

        ctx.fillStyle = grad;
        ctx.shadowColor = isRain ? 'rgba(0, 0, 0, 0.45)' : 'rgba(16, 185, 129, 0.2)';
        ctx.shadowBlur = isRain ? 6 : 4;
        ctx.shadowOffsetY = 2;

        drawLeafPath(p.leafType, radius);
        ctx.fill();

        // Leaf Main Central Vein & Subtle Highlights
        ctx.strokeStyle = scaleX > 0 ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.85);
        ctx.quadraticCurveTo(radius * 0.08, 0, 0, radius * 0.85);
        ctx.stroke();

        // Tiny Stem
        ctx.strokeStyle = scaleX > 0 ? '#15803d' : '#854d0e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, radius * 0.85);
        ctx.lineTo(0, radius * 1.15);
        ctx.stroke();

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [themePreset, weatherMode, isPaused]);

  if (themePreset !== 'weather') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-20 select-none"
    />
  );
};
