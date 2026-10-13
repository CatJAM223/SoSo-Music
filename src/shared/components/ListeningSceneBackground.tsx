import { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAudioState } from '../context/AudioContext';
import { useAnimationsPaused } from '../hooks/useAnimationsPaused';
import './ListeningScenes.css';

const seed = (i: number) => {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  opacity: number,
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color},${opacity})`);
  gradient.addColorStop(0.4, `rgba(${color},${opacity * 0.35})`);
  gradient.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function nightBase(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, w * 0.3, h);
  sky.addColorStop(0, '#050c18');
  sky.addColorStop(0.5, '#11253c');
  sky.addColorStop(1, '#040913');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.8, h * 0.38, w * 0.5, '72,113,168', 0.25);
  glow(ctx, w * 0.3, h * 0.65, w * 0.3, '66,151,178', 0.16);
  glow(ctx, w * 0.92, h * 0.73, w * 0.32, '195,118,65', 0.12);
  for (let i = 0; i < 55; i++) {
    ctx.fillStyle = `rgba(191,218,248,${0.08 + seed(i + 91) * 0.24})`;
    ctx.fillRect(seed(i) * w, seed(i + 300) * h * 0.55, 1, 1);
  }
  // Distant skyline is deliberately subdued, keeping content readable.
  for (let i = 0; i < 65; i++) {
    const x = (w * i) / 65,
      width = w / 65 + 1;
    const height = ((30 + seed(i + 30) * 115) * h) / 800;
    const y = h * 0.73 - height;
    ctx.fillStyle = i % 2 ? '#091222' : '#0b1929';
    ctx.fillRect(x, y, width, h - y);
    for (let j = 0; j < 12; j++) {
      if (seed(i * 23 + j) < 0.5) continue;
      ctx.fillStyle = j % 3 ? 'rgba(106,173,204,.18)' : 'rgba(245,190,127,.22)';
      ctx.fillRect(x + width * (0.2 + seed(j + i) * 0.5), y + height * (0.1 + j / 14), 2, 2);
    }
  }
  const mist = ctx.createLinearGradient(0, h * 0.58, 0, h);
  mist.addColorStop(0, 'rgba(57,111,147,0)');
  mist.addColorStop(0.36, 'rgba(80,141,170,.12)');
  mist.addColorStop(1, 'rgba(5,10,20,.7)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, h * 0.58, w, h * 0.42);
}

function nightMotion(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  // Passing lights have several speeds and depths, like a view from a train.
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 46; i++) {
    const depth = 0.2 + seed(i + 75) * 0.8;
    const length = ((10 + depth * 75) * w) / 1200;
    const x = ((((seed(i) * w - time * (18 + depth * 35)) % (w + 160)) + w + 160) % (w + 160)) - 80;
    const y = h * (0.62 + seed(i + 22) * 0.32);
    const color = i % 4 ? '102,186,226' : '249,176,99';
    const beam = ctx.createLinearGradient(x - length, y, x + length * 0.3, y);
    beam.addColorStop(0, `rgba(${color},0)`);
    beam.addColorStop(0.85, `rgba(${color},${0.12 + depth * 0.25})`);
    beam.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = beam;
    ctx.fillRect(x - length, y, length * 1.3, 1 + depth * 2);
    if (i % 3 === 0) glow(ctx, x, y, 6 + depth * 18, color, 0.12);
  }
  ctx.globalCompositeOperation = 'source-over';
  // Fine rain trails across the glass, with no frame or foreground objects.
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 64; i++) {
    const x = seed(i + 191) * w;
    const y = ((seed(i + 121) * h + time * (5 + seed(i) * 9)) % (h + 80)) - 40;
    const length = 10 + seed(i + 332) * 32;
    ctx.strokeStyle = `rgba(145,191,219,${0.06 + seed(i + 94) * 0.13})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 1, y + length * 0.3, x - 4, y + length * 0.7, x - 3, y + length);
    ctx.stroke();
    ctx.fillStyle = 'rgba(184,222,244,.2)';
    ctx.beginPath();
    ctx.ellipse(x - 3, y + length, 1.1, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function analogBase(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0d0907';
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.85, h * 0.15, w * 0.6, '134,67,30', 0.3);
  glow(ctx, w * 0.4, h * 0.82, w * 0.4, '121,65,34', 0.18);
  glow(ctx, w * 0.8, h * 0.65, w * 0.37, '217,130,52', 0.12);
}

function analogMotion(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  // Wide flowing ribbons: filled silhouettes, satin shading and thin lit edges.
  for (let ribbon = 0; ribbon < 4; ribbon++) {
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const x = w * (u * 1.35 - 0.15);
      const phase = u * Math.PI * 2.05 + ribbon * 0.77 + time * 0.075;
      const y = h * (0.68 + Math.sin(phase) * (0.2 + ribbon * 0.025) - u * 0.25 + ribbon * 0.04);
      const thickness = h * (0.035 + 0.047 * (0.5 + 0.5 * Math.cos(phase + 0.6 + ribbon)));
      top.push([x, y - thickness]);
      bottom.push([x, y + thickness]);
    }
    const surface = ctx.createLinearGradient(0, h * 0.15, w, h * 0.85);
    surface.addColorStop(0, 'rgba(64,34,21,.22)');
    surface.addColorStop(0.38, 'rgba(107,57,31,.55)');
    surface.addColorStop(0.68, 'rgba(158,88,44,.58)');
    surface.addColorStop(0.85, 'rgba(43,25,18,.80)');
    surface.addColorStop(1, 'rgba(111,55,25,.32)');
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.moveTo(...top[0]);
    top.slice(1).forEach((p) => ctx.lineTo(...p));
    bottom
      .slice()
      .reverse()
      .forEach((p) => ctx.lineTo(...p));
    ctx.closePath();
    ctx.fill();
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(255,185,103,0)');
    edge.addColorStop(0.25, 'rgba(215,127,56,.12)');
    edge.addColorStop(0.64, 'rgba(255,206,144,.70)');
    edge.addColorStop(0.83, 'rgba(244,144,57,.30)');
    edge.addColorStop(1, 'rgba(255,194,105,0)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = 'rgba(245,162,77,.6)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(...top[0]);
    top.slice(1).forEach((p) => ctx.lineTo(...p));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Parallel hairlines suggest fine magnetic film rather than a solid graphic.
    ctx.strokeStyle = 'rgba(251,174,101,.045)';
    ctx.lineWidth = 0.6;
    for (let strand = 1; strand < 7; strand++) {
      const mix = strand / 7;
      ctx.beginPath();
      top.forEach((p, i) => {
        const y = p[1] * (1 - mix) + bottom[i][1] * mix;
        if (i === 0) ctx.moveTo(p[0], y);
        else ctx.lineTo(p[0], y);
      });
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 45; i++) {
    const x = seed(i + 601) * w;
    const y = (seed(i + 921) * h - time * (1 + seed(i) * 3) + h * 2) % h;
    const alpha = 0.08 + seed(i + 188) * 0.16;
    ctx.fillStyle = `rgba(240,174,101,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + seed(i + 400) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function ListeningSceneBackground() {
  const { themePreset, sceneIntensity } = useTheme();
  const { isPlaying } = useAudioState();
  const paused = useAnimationsPaused();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(isPlaying);
  const timeRef = useRef(0);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (paused || (themePreset !== 'nighttrain' && themePreset !== 'cassette')) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const base = document.createElement('canvas');
    const baseCtx = base.getContext('2d');
    if (!baseCtx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (themePreset === 'nighttrain') nightMotion(ctx, w, h, timeRef.current);
      else analogMotion(ctx, w, h, timeRef.current);
      const shade = ctx.createLinearGradient(0, 0, w, 0);
      shade.addColorStop(0, 'rgba(0,0,0,.20)');
      shade.addColorStop(0.5, 'rgba(0,0,0,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, w, h);
    };
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = base.width = Math.round(w * dpr);
      canvas.height = base.height = Math.round(h * dpr);
      baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (themePreset === 'nighttrain') nightBase(baseCtx, w, h);
      else analogBase(baseCtx, w, h);
      draw();
    };
    const animate = (now: number) => {
      if (now - last >= 1000 / 30) {
        const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        timeRef.current +=
          delta * (sceneIntensity === 'quiet' ? 0.25 : 1) * (playingRef.current ? 1 : 0.4);
        draw();
      }
      frame = requestAnimationFrame(animate);
    };
    const syncMotion = () => {
      cancelAnimationFrame(frame);
      last = 0;
      draw();
      if (!paused && !reduced.matches && sceneIntensity !== 'still')
        frame = requestAnimationFrame(animate);
    };
    resize();
    syncMotion();
    window.addEventListener('resize', resize);
    reduced.addEventListener('change', syncMotion);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      reduced.removeEventListener('change', syncMotion);
      canvas.width = canvas.height = base.width = base.height = 0;
    };
  }, [themePreset, sceneIntensity, paused]);

  if (themePreset !== 'nighttrain' && themePreset !== 'cassette') return null;
  return <canvas ref={canvasRef} className="listening-background" aria-hidden="true" />;
}
