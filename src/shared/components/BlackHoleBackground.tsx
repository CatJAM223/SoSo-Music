import React, { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';

interface Star {
  x: number;
  y: number;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
}

interface DiskParticle {
  radius: number; // orbital radius in units of horizon radius
  angle: number;
  speed: number;
  size: number;
  heat: number; // 0 (outer, amber) .. 1 (inner, white-hot)
  yJitter: number;
  wobblePhase: number;
}

interface Infaller {
  radius: number; // in horizon-radius units
  angle: number;
  size: number;
  seed: number;
  tilt: number; // personal orbital inclination
  prevX: number;
  prevY: number;
}

const TILT = 0.075; // near edge-on disk, Gargantua style
const DISK_INNER = 1.35;
const DISK_OUTER = 6.2;

export const BlackHoleBackground: React.FC = () => {
  const { themePreset } = useTheme();
  const isPaused = useAnimationsPaused();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (themePreset !== 'blackhole' || isPaused) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    let horizonR = 60;
    let cx = 0;
    let cy = 0;
    let time = 0;
    let previousFrame = 0;
    let frameScale = 1;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const atmosphere = document.createElement('canvas');
    const atmosphereCtx = atmosphere.getContext('2d');
    const diskLight = document.createElement('canvas');
    const diskLightCtx = diskLight.getContext('2d');
    const buildLightLayers = () => {
      for (const layer of [atmosphere, diskLight]) {
        layer.width = canvas.width;
        layer.height = canvas.height;
      }
      if (!atmosphereCtx || !diskLightCtx) return;
      atmosphereCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      diskLightCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Distant clouds are cached at resize, rather than painted every frame.
      for (const [x, y, radius, color] of [
        [0.16, 0.24, 0.48, '57,65,126'],
        [0.85, 0.72, 0.42, '89,41,100'],
        [0.65, 0.12, 0.32, '29,72,103'],
      ] as const) {
        const cloud = atmosphereCtx.createRadialGradient(
          width * x,
          height * y,
          0,
          width * x,
          height * y,
          width * radius,
        );
        cloud.addColorStop(0, `rgba(${color},0.16)`);
        cloud.addColorStop(0.45, `rgba(${color},0.06)`);
        cloud.addColorStop(1, `rgba(${color},0)`);
        atmosphereCtx.fillStyle = cloud;
        atmosphereCtx.fillRect(0, 0, width, height);
      }
      const glow = atmosphereCtx.createRadialGradient(cx, cy, horizonR * 0.8, cx, cy, horizonR * 5);
      glow.addColorStop(0, 'rgba(255,160,64,0.28)');
      glow.addColorStop(0.35, 'rgba(126,53,37,0.14)');
      glow.addColorStop(1, 'rgba(4,6,16,0)');
      atmosphereCtx.fillStyle = glow;
      atmosphereCtx.fillRect(0, 0, width, height);
      diskLightCtx.globalCompositeOperation = 'lighter';
      diskLightCtx.lineCap = 'round';
      // Uneven, nested gas filaments: hot inner edge, dust gaps and a brighter
      // approaching side. No uniform stack of concentric outlines.
      for (let i = 0; i < 64; i++) {
        const t = i / 63;
        const radius = horizonR * (1.28 + Math.pow(t, 1.35) * 4.6);
        const density = 0.55 + 0.45 * Math.sin(i * 1.73) ** 2;
        const light = diskLightCtx.createLinearGradient(cx - radius, cy, cx + radius, cy);
        light.addColorStop(0, `rgba(255,205,137,${(0.24 - t * 0.17) * density})`);
        light.addColorStop(0.38, `rgba(255,238,210,${(0.38 - t * 0.29) * density})`);
        light.addColorStop(1, `rgba(201,74,30,${0.09 * density})`);
        diskLightCtx.strokeStyle = light;
        diskLightCtx.lineWidth = Math.max(0.65, horizonR * (0.011 + 0.009 * density));
        diskLightCtx.beginPath();
        for (let step = 0; step <= 120; step++) {
          const angle = (step / 120) * Math.PI * 2;
          const ripple = Math.sin(angle * 7 + i * 0.8) * Math.sin(angle * 3 - i) * horizonR * 0.009;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius * TILT - (x - cx) * 0.045 + ripple;
          if (step === 0) diskLightCtx.moveTo(x, y);
          else diskLightCtx.lineTo(x, y);
        }
        diskLightCtx.stroke();
        diskLightCtx.strokeStyle = light;
        diskLightCtx.beginPath();
        diskLightCtx.ellipse(
          cx,
          cy,
          horizonR * (1.12 + t * 0.94),
          horizonR * (1.1 + t * 0.85),
          0,
          Math.PI,
          Math.PI * 2,
        );
        diskLightCtx.stroke();
        // Faint lower image of the far side, bent underneath the horizon.
        diskLightCtx.globalAlpha = 0.3;
        diskLightCtx.beginPath();
        diskLightCtx.ellipse(
          cx,
          cy,
          horizonR * (1.08 + t * 0.44),
          horizonR * (1.06 + t * 0.32),
          0,
          0,
          Math.PI,
        );
        diskLightCtx.stroke();
        diskLightCtx.globalAlpha = 1;
      }
    };

    const stars: Star[] = [];
    const disk: DiskParticle[] = [];
    const infallers: Infaller[] = [];

    const layout = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cx = width * 0.58;
      cy = height * 0.4;
      horizonR = Math.max(38, Math.min(width, height) * 0.125);
    };

    const seedStars = () => {
      stars.length = 0;
      const count = Math.min(220, Math.floor((width * height) / 6500));
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: 0.4 + Math.random() * 1.3,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.008 + Math.random() * 0.02,
        });
      }
    };

    const seedDisk = () => {
      disk.length = 0;
      for (let i = 0; i < 360; i++) {
        const t = Math.random();
        // Denser towards the inner edge
        const radius = DISK_INNER + Math.pow(t, 1.9) * (DISK_OUTER - DISK_INNER);
        const norm = (radius - DISK_INNER) / (DISK_OUTER - DISK_INNER);
        disk.push({
          radius,
          angle: Math.random() * Math.PI * 2,
          // Keplerian-ish: inner particles orbit faster
          speed: 0.02 / Math.pow(radius, 1.5),
          size: 0.6 + Math.random() * 1.5,
          heat: 1 - norm,
          yJitter: (Math.random() - 0.5) * 3.4,
          wobblePhase: Math.random() * Math.PI * 2,
        });
      }
    };

    const respawnInfaller = (p: Infaller) => {
      p.radius = 4.5 + Math.random() * 4;
      p.angle = Math.random() * Math.PI * 2;
      p.seed = Math.random();
      p.tilt = TILT * (1.2 + p.seed * 2.8);
      const rPx = p.radius * horizonR;
      p.prevX = cx + Math.cos(p.angle) * rPx;
      p.prevY = cy + Math.sin(p.angle) * rPx * p.tilt;
    };

    const seedInfallers = () => {
      infallers.length = 0;
      for (let i = 0; i < 110; i++) {
        const p: Infaller = {
          radius: 1.2 + Math.random() * 7.5,
          angle: Math.random() * Math.PI * 2,
          size: 0.5 + Math.random() * 1.1,
          seed: Math.random(),
          tilt: 0,
          prevX: 0,
          prevY: 0,
        };
        p.tilt = TILT * (1.2 + p.seed * 2.8);
        const rPx = p.radius * horizonR;
        p.prevX = cx + Math.cos(p.angle) * rPx;
        p.prevY = cy + Math.sin(p.angle) * rPx * p.tilt;
        infallers.push(p);
      }
    };

    const handleResize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      layout();
      seedStars();
      seedDisk();
      seedInfallers();
      buildLightLayers();
      if (isPaused || reducedMotion.matches) render(performance.now());
    };
    window.addEventListener('resize', handleResize);
    layout();
    seedStars();
    seedDisk();
    seedInfallers();
    buildLightLayers();

    const diskColor = (heat: number, alpha: number): string => {
      if (heat > 0.85) return `rgba(255, 244, 224, ${alpha})`;
      if (heat > 0.6) return `rgba(255, 178, 80, ${alpha})`;
      if (heat > 0.35) return `rgba(255, 130, 35, ${alpha})`;
      return `rgba(232, 92, 26, ${alpha})`;
    };

    const render = (timestamp: number) => {
      if (!isPaused && !reducedMotion.matches) animationFrameId = requestAnimationFrame(render);
      if (previousFrame && timestamp - previousFrame < 1000 / 30 - 0.5) return;
      frameScale = previousFrame ? Math.min(3, (timestamp - previousFrame) / (1000 / 60)) : 1;
      previousFrame = timestamp;
      time += frameScale;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.drawImage(atmosphere, 0, 0, width, height);
      ctx.drawImage(diskLight, 0, 0, width, height);

      // --- Deep space starfield with gravitational lensing ---
      for (const s of stars) {
        s.twinklePhase += s.twinkleSpeed * frameScale;
        const distToHole = Math.hypot(s.x - cx, s.y - cy);
        if (distToHole < horizonR * 1.35) continue; // swallowed by the horizon

        // Gentle gravitational drift towards the hole
        const pull = 0.012 * (horizonR / Math.max(distToHole, horizonR));
        s.x += (cx - s.x) * pull * 0.04;
        s.y += (cy - s.y) * pull * 0.04;
        if (distToHole < horizonR * 1.6) {
          s.x = Math.random() * width;
          s.y = Math.random() * height;
          continue;
        }

        // Light bending: apparent position pushed radially outward
        const dx = s.x - cx;
        const dy = s.y - cy;
        const d = Math.max(distToHole, 1);
        const deflect = ((horizonR * horizonR) / d) * 1.6;
        const lx = cx + (dx / d) * (d + deflect);
        const ly = cy + (dy / d) * (d + deflect);

        // Tangential smearing near the photon ring (Einstein arcs)
        const stretch = Math.min(3, ((horizonR * horizonR) / (d * d)) * 2.2);
        const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.twinklePhase));
        ctx.globalAlpha = tw * 0.9;
        ctx.fillStyle = '#e8edff';
        if (stretch > 0.25) {
          const tang = Math.atan2(dy, dx) + Math.PI / 2;
          ctx.beginPath();
          ctx.ellipse(
            lx,
            ly,
            s.size * (1 + stretch),
            s.size / (1 + stretch * 0.4),
            tang,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          if (s.size > 1.55) {
            ctx.globalAlpha *= 0.32;
            ctx.strokeStyle = '#c5d8ff';
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(lx - 4, ly);
            ctx.lineTo(lx + 4, ly);
            ctx.moveTo(lx, ly - 4);
            ctx.lineTo(lx, ly + 4);
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.arc(lx, ly, s.size * 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      ctx.globalCompositeOperation = 'lighter';

      // --- Advance orbiters once per frame ---
      for (const p of disk) p.angle += p.speed * frameScale;
      for (const p of infallers) {
        p.angle += 0.07 * Math.pow(1 / p.radius, 1.5) * frameScale;
        p.radius -= (0.0035 + 0.01 / (p.radius * p.radius)) * frameScale;
        if (p.radius < 1.07) respawnInfaller(p);
      }

      // --- Infalling particles: spiral in and get swallowed ---
      const drawInfallers = (near: boolean) => {
        for (const p of infallers) {
          const sinA = Math.sin(p.angle);
          if (near ? sinA < 0 : sinA >= 0) continue;

          // Keplerian spin-up as they fall

          const rPx = p.radius * horizonR;
          const px = cx + Math.cos(p.angle) * rPx;
          const py = cy + Math.sin(p.angle) * rPx * p.tilt;

          const prox = Math.max(0, Math.min(1, (6 - p.radius) / 5));
          const alpha = (0.2 + 0.55 * prox) * (near ? 1 : 0.45);
          const heat = Math.max(0, Math.min(1, 1.2 - p.radius / 4.5));

          ctx.strokeStyle = diskColor(heat, alpha);
          ctx.lineWidth = p.size * (0.7 + prox * 0.9);
          ctx.beginPath();
          ctx.moveTo(p.prevX, p.prevY);
          ctx.lineTo(px, py);
          ctx.stroke();

          p.prevX = px;
          p.prevY = py;

          if (p.radius < 1.07) respawnInfaller(p); // crossed the horizon
        }
      };

      // Far-side infallers (behind the hole)
      drawInfallers(false);

      // --- Lensed far side of the disk: arcs bent over/under the shadow ---
      const drawHalo = (secondary: boolean) => {
        for (const p of disk) {
          const sinA = Math.sin(p.angle);
          if (sinA >= 0) continue; // far side only

          const u = p.angle - Math.PI; // map to (0..π)
          const norm = (p.radius - DISK_INNER) / (DISK_OUTER - DISK_INNER);
          const haloR = horizonR * (secondary ? 1.14 + norm * 0.3 : 1.26 + norm * 0.52);
          const squash = secondary ? 1.02 : 0.94;

          const hx = cx - Math.cos(u) * haloR;
          const hy = cy - Math.sin(u) * haloR * squash;

          // Doppler beaming: approaching side glows brighter
          const doppler = 1 + 0.7 * -Math.cos(p.angle);
          const alpha = Math.min(0.95, (0.26 + p.heat * 0.5) * doppler * (secondary ? 0.4 : 0.85));

          const uPrev = u - p.speed * 5;
          const qx = cx - Math.cos(uPrev) * haloR;
          const qy = cy - Math.sin(uPrev) * haloR * squash;

          ctx.strokeStyle = diskColor(p.heat, alpha);
          ctx.lineWidth = p.size * (secondary ? 0.8 : 1);
          ctx.beginPath();
          ctx.moveTo(qx, qy);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
      };

      drawHalo(false);
      drawHalo(true);

      // --- Event horizon ---
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR, 0, Math.PI * 2);
      ctx.fill();

      // Photon ring — razor thin white-hot circle hugging the horizon
      const photonPulse = 0.85 + 0.15 * Math.sin(time * 0.03);
      ctx.strokeStyle = `rgba(255, 248, 236, ${photonPulse})`;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(255, 200, 140, 0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, horizonR * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // --- Near side of the disk: thin blade crossing in front of the shadow ---
      ctx.globalCompositeOperation = 'lighter';
      // Broad flowing gas arcs give the front disk body and a slow spiral rhythm.
      // Their angular speed varies with radius, like the smaller orbiters.
      for (let i = 0; i < 22; i++) {
        const radius = 1.32 + i * 0.18;
        const phase = (time * 0.009) / Math.pow(radius, 1.5) + i * 2.4;
        ctx.strokeStyle = diskColor(1 - i / 25, 0.09 + 0.08 * Math.sin(phase) ** 2);
        ctx.lineWidth = horizonR * (0.009 + (i % 3) * 0.004);
        ctx.beginPath();
        for (let step = 0; step <= 40; step++) {
          const angle = (step / 40) * Math.PI;
          const x = cx + Math.cos(angle) * radius * horizonR;
          const wave = Math.sin(angle * 4 + phase) * horizonR * 0.012;
          const y = cy + Math.sin(angle) * radius * horizonR * TILT - (x - cx) * 0.045 + wave;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (const p of disk) {
        const sinA = Math.sin(p.angle);
        if (sinA < 0) continue;

        const px = cx + Math.cos(p.angle) * p.radius * horizonR;
        const py =
          cy +
          sinA * p.radius * horizonR * TILT -
          (px - cx) * 0.045 +
          p.yJitter +
          Math.sin(time * 0.015 + p.wobblePhase) * 0.8;

        const doppler = 1 + 0.75 * -Math.cos(p.angle);
        const alpha = Math.min(0.95, (0.3 + p.heat * 0.55) * doppler);

        const aPrev = p.angle - p.speed * 5;
        const qx = cx + Math.cos(aPrev) * p.radius * horizonR;
        const qy =
          cy +
          Math.sin(aPrev) * p.radius * horizonR * TILT -
          (qx - cx) * 0.045 +
          p.yJitter +
          Math.sin(time * 0.015 + p.wobblePhase) * 0.8;

        ctx.strokeStyle = diskColor(p.heat, alpha);
        ctx.lineWidth = p.size * 1.1;
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(px, py);
        ctx.stroke();
      }

      // Near-side infallers (in front of the hole)
      drawInfallers(true);
    };

    render(performance.now());
    const handleMotionChange = () => {
      cancelAnimationFrame(animationFrameId);
      previousFrame = 0;
      render(performance.now());
    };
    reducedMotion.addEventListener('change', handleMotionChange);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      reducedMotion.removeEventListener('change', handleMotionChange);
      for (const layer of [canvas, atmosphere, diskLight]) {
        layer.width = 0;
        layer.height = 0;
      }
    };
  }, [themePreset, isPaused]);

  if (themePreset !== 'blackhole') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none select-none"
      style={{ zIndex: -1 }}
    />
  );
};
