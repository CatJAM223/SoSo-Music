import React, { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';

interface Petal {
  x: number;
  y: number;
  size: number;
  // Velocity
  vx: number;
  vy: number;
  // 3D Rotations & Angular speeds
  rotX: number;
  rotY: number;
  rotZ: number;
  vRotX: number;
  vRotY: number;
  vRotZ: number;
  // Flutter / Wind wave phase
  swayPhase: number;
  swaySpeed: number;
  swayRadius: number;
  opacity: number;
  petalType: number; // Slight variation in shape
}

export const SakuraFallingPetals: React.FC = () => {
  const { themePreset } = useTheme();
  const isPaused = useAnimationsPaused();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (themePreset !== 'sakura' || isPaused) return;

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

    // Number of active petals for balanced, elegant sakura atmosphere
    const PETAL_COUNT = 48;

    const createPetal = (scatterAcrossScreen: boolean = false): Petal => {
      // Wind blows from top-left towards bottom-right
      let startX: number;
      let startY: number;

      if (scatterAcrossScreen) {
        startX = Math.random() * (width + 250) - 100;
        startY = Math.random() * (height + 250) - 100;
      } else {
        // Spawn around top-left corner: top edge or left edge
        if (Math.random() < 0.65) {
          startX = Math.random() * width * 0.8 - 60;
          startY = -25 - Math.random() * 90;
        } else {
          startX = -40 - Math.random() * 70;
          startY = Math.random() * height * 0.75 - 40;
        }
      }

      return {
        x: startX,
        y: startY,
        size: 9 + Math.random() * 8,
        // Base diagonal wind vector towards right & down
        vx: 1.8 + Math.random() * 2.6,
        vy: 1.2 + Math.random() * 2.0,
        rotX: Math.random() * Math.PI * 2,
        rotY: Math.random() * Math.PI * 2,
        rotZ: Math.random() * Math.PI * 2,
        vRotX: (Math.random() - 0.5) * 0.055,
        vRotY: (Math.random() - 0.5) * 0.075,
        vRotZ: (Math.random() - 0.5) * 0.04,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.025 + Math.random() * 0.035,
        swayRadius: 1.0 + Math.random() * 2.0,
        opacity: 0.5 + Math.random() * 0.35,
        petalType: Math.floor(Math.random() * 3),
      };
    };

    // Initialize petals immediately scattered across the window
    const petals: Petal[] = Array.from({ length: PETAL_COUNT }, () => createPetal(true));

    // Cached petal gradients to prevent thousands of allocations per second
    const gradientCache = new Map<string, CanvasGradient>();
    const getPetalGradient = (radius: number, isLighter: boolean): CanvasGradient => {
      const r = Math.round(radius);
      const key = `${isLighter ? 1 : 0}_${r}`;
      let grad = gradientCache.get(key);
      if (grad) return grad;

      grad = ctx.createLinearGradient(0, -r, 0, r);
      if (isLighter) {
        grad.addColorStop(0, '#ffe4e6');
        grad.addColorStop(0.4, '#fecdd3');
        grad.addColorStop(0.85, '#fb7185');
        grad.addColorStop(1, '#f43f5e');
      } else {
        grad.addColorStop(0, '#fff1f2');
        grad.addColorStop(0.5, '#fda4af');
        grad.addColorStop(0.9, '#f43f5e');
        grad.addColorStop(1, '#e11d48');
      }
      gradientCache.set(key, grad);
      return grad;
    };

    let time = 0;
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

      // Global organic wind gust that gently surges and ebbs
      const windGustX = Math.sin(time * 0.012) * 0.9 + Math.cos(time * 0.007) * 0.6;
      const windGustY = Math.cos(time * 0.009) * 0.35;

      for (let i = 0; i < petals.length; i++) {
        const p = petals[i];

        // Update rotations (3D tumbling)
        p.rotX += p.vRotX;
        p.rotY += p.vRotY;
        p.rotZ += p.vRotZ;
        p.swayPhase += p.swaySpeed;

        // Turbulence and flutter
        const flutterX = Math.sin(p.swayPhase) * p.swayRadius;
        const flutterY = Math.cos(p.swayPhase * 0.8) * (p.swayRadius * 0.5);

        // Move along wind trajectory from top-left to bottom-right
        p.x += p.vx + windGustX * 0.7 + flutterX;
        p.y += p.vy + windGustY + flutterY;

        // Check if petal left the screen on bottom or right
        if (p.x > width + 60 || p.y > height + 60) {
          petals[i] = createPetal(false);
          continue;
        }

        // Draw individual 3D petal
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotZ);

        // 3D projection scaling based on roll (rotX) and pitch (rotY)
        const scaleX = Math.cos(p.rotY);
        const scaleY = Math.sin(p.rotX) * 0.4 + 0.6;
        ctx.scale(scaleX, scaleY);

        ctx.globalAlpha = p.opacity;

        // Draw petal path with cached gradient
        const radius = p.size;
        ctx.fillStyle = getPetalGradient(radius, scaleX > 0);
        ctx.shadowColor = 'rgba(244, 63, 94, 0.15)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        ctx.beginPath();
        // Organic curved sakura petal with top notch
        ctx.moveTo(0, -radius);
        ctx.bezierCurveTo(
          radius * 0.75,
          -radius * 0.85,
          radius * 0.95,
          0,
          radius * 0.6,
          radius * 0.85,
        );
        // Small heart-like notch at the base
        ctx.bezierCurveTo(
          radius * 0.2,
          radius * 1.05,
          -radius * 0.2,
          radius * 1.05,
          -radius * 0.6,
          radius * 0.85,
        );
        ctx.bezierCurveTo(-radius * 0.95, 0, -radius * 0.75, -radius * 0.85, 0, -radius);
        ctx.closePath();
        ctx.fill();

        // Subtle petal vein highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.6);
        ctx.quadraticCurveTo(radius * 0.1, 0, 0, radius * 0.6);
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
    };
  }, [themePreset, isPaused]);

  if (themePreset !== 'sakura') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-20 select-none"
    />
  );
};
