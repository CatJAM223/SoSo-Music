import { useEqualizerAnimation } from '../../hooks/useEqualizerAnimation';
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { RotateCcw } from 'lucide-react';
import { audioEqualizer } from '../../../../shared/services/audioEqualizer';
import {
  EQUALIZER_FREQUENCIES,
  EQUALIZER_LIMIT,
  EQUALIZER_PRESETS,
} from '../../../../shared/utils/equalizer';
import { t } from '../../../../shared/i18n/locale';
import { useLocale } from '../../../../shared/i18n/useLocale';
import './SettingsEqualizer.css';

const WIDTH = 760,
  HEIGHT = 260,
  LEFT = 48,
  RIGHT = 24,
  TOP = 24,
  BOTTOM = 48;
const frequencyLabel = (frequency: number) =>
  frequency >= 1000 ? `${frequency / 1000} ${t('кГц')}` : `${frequency} ${t('Гц')}`;
const gainLabel = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)} ${t('дБ')}`;
const frequencyX = (frequency: number) =>
  LEFT + (Math.log(frequency / 20) / Math.log(1000)) * (WIDTH - LEFT - RIGHT);

function EqualizerGainInput({
  gain,
  disabled,
  onChange,
}: {
  gain: number;
  disabled: boolean;
  onChange: (gain: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={-EQUALIZER_LIMIT}
      max={EQUALIZER_LIMIT}
      step="0.5"
      value={draft ?? gain}
      disabled={disabled}
      aria-label={t('Усиление выбранной частоты')}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
          onChange(event.target.valueAsNumber);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export function SettingsEqualizer() {
  useLocale();
  const service = audioEqualizer();
  const settings = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const targetResponse = service.getResponse();
  const { gains: displayedGains, response } = useEqualizerAnimation(
    service,
    settings,
    targetResponse,
  );
  const error = service.getError();
  const [selectedBand, setSelectedBand] = useState(5);
  const [dragRange, setDragRange] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; pointerId: number; range: number } | null>(null);
  const id = useId();
  const range =
    dragRange ?? Math.max(12, Math.ceil(Math.max(...response.db.map(Math.abs)) / 6) * 6);
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const y = (gain: number) => TOP + ((range - gain) / (2 * range)) * plotHeight;
  const zeroY = y(0);
  const line = response.db
    .map(
      (gain, index) =>
        `${index ? 'L' : 'M'}${frequencyX(response.frequencies[index]).toFixed(2)},${y(gain).toFixed(2)}`,
    )
    .join(' ');
  const area = `${line} L${frequencyX(response.frequencies[response.frequencies.length - 1])},${zeroY} L${frequencyX(response.frequencies[0])},${zeroY} Z`;
  const toPoint = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const setFromPointer = (event: PointerEvent<SVGSVGElement>, index: number) => {
    const point = toPoint(event);
    const scale = drag.current?.range ?? range;
    if (point) service.setBandGain(index, scale - ((point.y - TOP) / plotHeight) * scale * 2);
  };
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!settings.enabled || event.button !== 0) return;
    const point = toPoint(event);
    if (
      !point ||
      point.x < LEFT - 12 ||
      point.x > WIDTH - RIGHT + 12 ||
      point.y < TOP - 12 ||
      point.y > HEIGHT - BOTTOM + 12
    )
      return;
    const index = EQUALIZER_FREQUENCIES.reduce(
      (best, frequency, i) =>
        Math.abs(frequencyX(frequency) - point.x) <
        Math.abs(frequencyX(EQUALIZER_FREQUENCIES[best]) - point.x)
          ? i
          : best,
      0,
    );
    drag.current = { index, pointerId: event.pointerId, range };
    setDragRange(range);
    setSelectedBand(index);
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event, index);
  };
  const handleKeyDown = (event: KeyboardEvent<SVGCircleElement>, index: number) => {
    const step = event.shiftKey ? 2 : 0.5;
    let value: number;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        value = settings.gains[index] + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        value = settings.gains[index] - step;
        break;
      case 'Home':
        value = -EQUALIZER_LIMIT;
        break;
      case 'End':
        value = EQUALIZER_LIMIT;
        break;
      case 'Delete':
      case 'Backspace':
        value = 0;
        break;
      default:
        return;
    }
    event.preventDefault();
    service.setBandGain(index, value);
  };
  return (
    <section className="settings-detail-section settings-equalizer" aria-labelledby={`${id}-title`}>
      <div className="equalizer-heading">
        <div>
          <h3 id={`${id}-title`}>{t('Эквалайзер')}</h3>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label={t('Эквалайзер')}
          className={`settings-switch ${settings.enabled ? 'enabled' : ''}`}
          onClick={() => service.setEnabled(!settings.enabled)}
        >
          <span />
        </button>
      </div>
      <div className="equalizer-presets" role="group" aria-label={t('Пресеты эквалайзера')}>
        {EQUALIZER_PRESETS.map((preset) => {
          return (
            <button
              type="button"
              key={preset.id}
              aria-pressed={settings.presetId === preset.id}
              title={t(preset.description)}
              onClick={() => service.selectPreset(preset.id)}
            >
              {t(preset.label)}
            </button>
          );
        })}
      </div>
      <div className={`equalizer-panel ${settings.enabled ? '' : 'equalizer-disabled'}`}>
        <div className="equalizer-panel-top">
          <button
            type="button"
            onClick={() => service.selectPreset('flat')}
            title={t('Сбросить эквалайзер')}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('Сбросить')}
          </button>
        </div>
        <svg
          ref={svgRef}
          className="equalizer-graph"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={t('Частотная характеристика эквалайзера')}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId)
              setFromPointer(event, drag.current.index);
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) {
              drag.current = null;
              setDragRange(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragRange(null);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragRange(null);
          }}
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.015" />
            </linearGradient>
          </defs>
          {[-range, -range / 2, 0, range / 2, range].map((gain) => (
            <g key={gain} className={gain === 0 ? 'equalizer-zero' : 'equalizer-grid'}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(gain)} y2={y(gain)} />
              <text x={LEFT - 12} y={y(gain) + 4} textAnchor="end">
                {gain > 0 ? '+' : ''}
                {gain}
              </text>
            </g>
          ))}
          <text className="equalizer-axis-label" x={LEFT - 12} y={TOP - 10} textAnchor="end">
            {t('дБ')}
          </text>
          {EQUALIZER_FREQUENCIES.map((frequency) => (
            <g className="equalizer-grid" key={frequency}>
              <line
                x1={frequencyX(frequency)}
                x2={frequencyX(frequency)}
                y1={TOP}
                y2={HEIGHT - BOTTOM}
              />
              <text x={frequencyX(frequency)} y={HEIGHT - BOTTOM + 24} textAnchor="middle">
                {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#${id}-fill)`} />
          <path d={line} className="equalizer-curve" />
          {EQUALIZER_FREQUENCIES.map((frequency, index) => (
            <g
              key={frequency}
              className={selectedBand === index ? 'equalizer-band selected' : 'equalizer-band'}
            >
              <circle
                cx={frequencyX(frequency)}
                cy={y(displayedGains[index])}
                r={16}
                className="equalizer-hit"
                role="slider"
                tabIndex={settings.enabled ? 0 : -1}
                aria-disabled={!settings.enabled}
                aria-label={frequencyLabel(frequency)}
                aria-valuemin={-EQUALIZER_LIMIT}
                aria-valuemax={EQUALIZER_LIMIT}
                aria-valuenow={settings.gains[index]}
                aria-valuetext={gainLabel(settings.gains[index])}
                aria-orientation="vertical"
                onFocus={() => setSelectedBand(index)}
                onKeyDown={(event) => {
                  if (settings.enabled) handleKeyDown(event, index);
                }}
                onDoubleClick={() => {
                  if (settings.enabled) service.setBandGain(index, 0);
                }}
              >
                <title>
                  {frequencyLabel(frequency)} · {gainLabel(settings.gains[index])}
                </title>
              </circle>
              <circle
                cx={frequencyX(frequency)}
                cy={y(displayedGains[index])}
                r={selectedBand === index ? 6 : 4.5}
                className="equalizer-handle"
              />
            </g>
          ))}
          <text className="equalizer-axis-label" x={WIDTH - RIGHT} y={HEIGHT - 4} textAnchor="end">
            {t('Гц')}
          </text>
        </svg>
        <div className="equalizer-panel-bottom">
          <label className="equalizer-precise">
            <span>{frequencyLabel(EQUALIZER_FREQUENCIES[selectedBand])}</span>
            <EqualizerGainInput
              key={selectedBand}
              gain={settings.gains[selectedBand]}
              disabled={!settings.enabled}
              onChange={(gain) => service.setBandGain(selectedBand, gain)}
            />
            <span>{t('дБ')}</span>
          </label>
          <span
            className="equalizer-headroom"
            title={t('Громкость автоматически снижена с учётом суммарного усиления фильтров')}
          >
            {t('Запас громкости')}: {gainLabel(settings.enabled ? targetResponse.headroomDb : 0)}
          </span>
        </div>
      </div>
      {error && (
        <p role="status" className="equalizer-error">
          {t('Не удалось подключить эквалайзер. Попробуйте выключить и включить его.')}
        </p>
      )}
    </section>
  );
}
