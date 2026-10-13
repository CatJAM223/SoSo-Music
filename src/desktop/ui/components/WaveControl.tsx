import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import {
  Check,
  Coffee,
  Compass,
  Flame,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Shuffle,
  Waves,
  X,
} from 'lucide-react';
import type { MusicSource, WaveMood } from '../../../shared/types';
import soundcloudSymbol from '../assets/soundcloud-symbol.webp';
import './WaveControl.css';

type Props = {
  mood: WaveMood;
  source: MusicSource;
  onSelectSource: (source: MusicSource) => void;
  isActive: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  isStarting: boolean;
  onToggle: () => void;
  onSelectMood: (mood: WaveMood) => void;
  onReset: () => void;
};

const slices = [
  {
    id: 'default',
    label: 'Поток',
    icon: Waves,
    description: 'Любимые треки и новые находки в балансе.',
    action: 'Слушать поток',
  },
  {
    id: 'energy',
    label: 'Бодрое',
    icon: Flame,
    description: 'Больше энергии и драйва в рамках твоего вкуса.',
    action: 'Добавить энергии',
  },
  {
    id: 'discover',
    label: 'Открытия',
    icon: Compass,
    description: 'Новые исполнители и музыка, которую стоит услышать.',
    action: 'Открывать новое',
  },
  {
    id: 'reset',
    label: 'Сброс',
    icon: RotateCcw,
    description: 'Заново собрать подборку. Избранное сохранится.',
    action: 'Собрать заново',
  },
  {
    id: 'mix',
    label: 'Микс',
    icon: Shuffle,
    description: 'Больше разнообразия: знакомая музыка и открытия.',
    action: 'Перемешать волну',
  },
  {
    id: 'chill',
    label: 'Спокойное',
    icon: Coffee,
    description: 'Мягкое звучание и спокойный ритм под твой вкус.',
    action: 'Замедлить ритм',
  },
] as const;

// Equal vertex counts let CSS interpolate a wedge into a square.
function sliceStyle(index: number): CSSProperties {
  const angle = -90 + index * 60;
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians),
    y = Math.sin(radians);
  const points: number[][] = [[50, 50]];
  const closedPoints: number[][] = [[50, 50]];
  for (let step = 0; step <= 12; step++) {
    const arc = ((angle - 29 + (step * 58) / 12) * Math.PI) / 180;
    points.push([50 + Math.cos(arc) * 49.5, 50 + Math.sin(arc) * 49.5]);
    const closedArc = ((angle - 30 + (step * 60) / 12) * Math.PI) / 180;
    closedPoints.push([50 + Math.cos(closedArc) * 50, 50 + Math.sin(closedArc) * 50]);
  }
  const cx = 50 + x * 23,
    cy = 50 + y * 23,
    half = 37;
  const square = [[cx - half, cy - half]];
  for (let edge = 0; edge < 4; edge++) {
    for (let step = 1; step <= 3; step++) {
      const t = step / 3;
      square.push(
        edge === 0
          ? [cx - half + t * half * 2, cy - half]
          : edge === 1
            ? [cx + half, cy - half + t * half * 2]
            : edge === 2
              ? [cx + half - t * half * 2, cy + half]
              : [cx - half, cy + half - t * half * 2],
      );
    }
  }
  square.push(square[0]);
  const polygon = (vertices: number[][]) =>
    'polygon(' +
    vertices.map(([px, py]) => px.toFixed(3) + '% ' + py.toFixed(3) + '%').join(', ') +
    ')';
  return {
    '--slice-clip': polygon(points),
    '--slice-closed': polygon(closedPoints),
    '--slice-square': polygon(square),
    '--slice-label-x': 50 + x * 34 + '%',
    '--slice-label-y': 50 + y * 34 + '%',
    '--slice-card-x': cx + '%',
    '--slice-card-y': cy + '%',
    '--slice-shift-x': x * 12 + '%',
    '--slice-shift-y': y * 12 + '%',
  } as CSSProperties;
}
const sliceStyles = slices.map((_, index) => sliceStyle(index));

export function WaveControl({
  mood,
  source,
  onSelectSource,
  isActive,
  isPlaying,
  isLoading,
  onToggle,
  onSelectMood,
  onReset,
}: Props) {
  useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const [focusedSlice, setFocusedSlice] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const sliceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef(false);
  const id = useId();
  const preview = hoveredSlice ?? focusedSlice;
  const toggleLabel = isLoading
    ? t('Отменить загрузку волны')
    : isPlaying
      ? t('Приостановить волну')
      : t('Включить волну');
  const closeSettings = () => {
    setIsOpen(false);
    setHoveredSlice(null);
    setFocusedSlice(null);
    settingsRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (isOpen && focusOnOpen.current) {
      focusOnOpen.current = false;
      sliceRefs.current[slices.findIndex((slice) => slice.id === mood)]?.focus();
    }
  }, [isOpen, mood]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
        setHoveredSlice(null);
        setFocusedSlice(null);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      setHoveredSlice(null);
      setFocusedSlice(null);
      settingsRef.current?.focus();
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSliceKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let direction = 1,
      next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % slices.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      direction = -1;
      next = (index + slices.length - 1) % slices.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = slices.length - 1;
    else return;
    event.preventDefault();
    if (sliceRefs.current[next]?.disabled)
      next = (next + direction + slices.length) % slices.length;
    sliceRefs.current[next]?.focus();
  };

  return (
    <section
      ref={rootRef}
      className="wave-control"
      data-settings-open={isOpen}
      data-playing={isActive && isPlaying}
      data-mood={mood}
      aria-labelledby={id + '-title'}
    >
      <header className="wave-control-heading">
        <h1 id={id + '-title'}>{t('Моя волна')}</h1>
      </header>
      <div className="wave-control-stage">
        <button
          type="button"
          className="wave-launch"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-busy={isLoading}
          aria-hidden={isOpen}
          tabIndex={isOpen ? -1 : 0}
        >
          {isLoading ? (
            <Loader2 className="wave-launch-icon animate-spin" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause className="wave-launch-icon" fill="currentColor" aria-hidden="true" />
          ) : (
            <Play
              className="wave-launch-icon wave-launch-play"
              fill="currentColor"
              aria-hidden="true"
            />
          )}
          {isLoading && (
            <span className="wave-launch-caption" role="status">
              {t('Подбираю трек…')}
            </span>
          )}
        </button>
        <div
          id={id + '-modes'}
          className="wave-pizza"
          role="group"
          aria-label={t('Режимы моей волны')}
          aria-hidden={!isOpen}
        >
          {slices.map((slice, index) => {
            const Icon = slice.icon;
            const selected = slice.id === mood;
            return (
              <button
                key={slice.id}
                ref={(element) => {
                  sliceRefs.current[index] = element;
                }}
                type="button"
                className="wave-slice"
                style={sliceStyles[index]}
                data-wave-slice={slice.id}
                data-selected={selected}
                data-preview={preview === slice.id}
                aria-label={
                  slice.id === 'reset' ? t('Сбросить волну: новая подборка') : t(slice.label)
                }
                aria-pressed={slice.id === 'reset' ? undefined : selected}
                aria-describedby={id + '-' + slice.id + '-description'}
                tabIndex={isOpen ? 0 : -1}
                disabled={slice.id === 'reset' && isLoading}
                onMouseEnter={() => setHoveredSlice(slice.id)}
                onMouseLeave={() => setHoveredSlice(null)}
                onFocus={() => setFocusedSlice(slice.id)}
                onBlur={() => setFocusedSlice(null)}
                onKeyDown={(event) => handleSliceKey(event, index)}
                onClick={() => {
                  closeSettings();
                  if (slice.id === 'reset') onReset();
                  else onSelectMood(slice.id);
                }}
              >
                {/* Preserve the original hit area while the visible piece moves outwards. */}
                <span className="wave-slice-hit" aria-hidden="true" />
                <span className="wave-slice-shape">
                  <span className="wave-slice-copy">
                    <Icon className="wave-slice-icon" aria-hidden="true" />
                    <span className="wave-slice-label">{t(slice.label)}</span>
                    {selected && <Check className="wave-slice-check" aria-hidden="true" />}
                    <span
                      id={id + '-' + slice.id + '-description'}
                      className="wave-slice-description"
                    >
                      {t(slice.description)}
                    </span>
                    <span className="wave-slice-action" aria-hidden="true">
                      {t(slice.action)} <span>↗</span>
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="wave-pizza-close"
            onClick={closeSettings}
            tabIndex={isOpen ? 0 : -1}
            aria-label={t('Закрыть режимы волны')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <aside
          id={id + '-sources'}
          className="wave-sources"
          aria-labelledby={id + '-sources-title'}
          aria-hidden={!isOpen}
        >
          <h2 id={id + '-sources-title'}>{t('Источники музыки')}</h2>
          <div className="wave-source-options" role="group" aria-label={t('Источник моей волны')}>
            {(
              [
                { value: 'all', label: t('Микс') },
                {
                  value: 'youtube',
                  label: 'YouTube Music',
                },
                {
                  value: 'soundcloud',
                  label: 'SoundCloud',
                },
              ] as const
            ).map((option) => {
              return (
                <button
                  key={option.value}
                  type="button"
                  className="wave-source-option"
                  data-wave-source={option.value}
                  aria-pressed={source === option.value}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => onSelectSource(option.value)}
                >
                  <span className="wave-source-icon" aria-hidden="true">
                    {option.value === 'all' ? (
                      <Shuffle size={21} />
                    ) : option.value === 'youtube' ? (
                      <svg viewBox="0 0 24 24" width="23" height="23" data-brand="youtube">
                        <circle cx="12" cy="12" r="12" fill="#ff0033" />
                        <circle cx="12" cy="12" r="8" fill="none" stroke="white" strokeWidth="1" />
                        <path d="M 10 7.5 L 17 12 L 10 16.5 Z" fill="white" />
                      </svg>
                    ) : (
                      <img
                        src={soundcloudSymbol}
                        width="23"
                        height="23"
                        alt=""
                        data-brand="soundcloud"
                      />
                    )}
                  </span>
                  <span className="wave-source-label">{t(option.label)}</span>
                  {source === option.value && (
                    <Check size={15} className="wave-source-check" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
      <footer className="wave-control-footer">
        <button
          ref={settingsRef}
          type="button"
          className="wave-settings"
          aria-label={isOpen ? t('Закрыть настройки волны') : t('Настроить волну')}
          aria-expanded={isOpen}
          aria-controls={id + '-modes ' + id + '-sources'}
          onClick={(event) => {
            if (isOpen) closeSettings();
            else {
              focusOnOpen.current = event.detail === 0;
              setHoveredSlice(null);
              setFocusedSlice(null);
              setIsOpen(true);
            }
          }}
        >
          <Settings size={19} aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
