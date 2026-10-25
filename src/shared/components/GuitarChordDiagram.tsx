import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React from 'react';
import { getChordDiagram } from './chordDb';
import { useTheme, ACCENT_COLOR_OPTIONS } from '../context/ThemeContext';

interface GuitarChordDiagramProps {
  chord: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const GuitarChordDiagram: React.FC<GuitarChordDiagramProps> = ({
  chord,
  size = 'md',
  className = '',
}) => {
  useLocale();
  const { accentColor } = useTheme();
  const accentOption =
    ACCENT_COLOR_OPTIONS.find((a) => a.id === accentColor) || ACCENT_COLOR_OPTIONS[0];
  const themeHex = accentOption?.color || '#22c55e';
  const themeRgb = accentOption?.rgb || '34, 197, 94';

  const data = getChordDiagram(chord);
  if (!data) {
    return (
      <div
        className={`flex flex-col items-center justify-center p-3 rounded-2xl bg-white/5 border border-white/10 text-center ${className}`}
      >
        <span className="font-mono font-bold text-sm" style={{ color: themeHex }}>
          {chord}
        </span>
        <span className="text-[10px] text-zinc-500 mt-1">{t('Схема не найдена')}</span>
      </div>
    );
  }

  const { frets, baseFret, barre } = data;

  // Sizing constants
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const width = isSm ? 90 : isLg ? 150 : 115;
  const height = isSm ? 115 : isLg ? 185 : 140;

  const marginX = isSm ? 26 : isLg ? 38 : 32; // Left margin for clear fret number badge
  const marginTop = isSm ? 22 : isLg ? 34 : 26;
  const marginBottom = isSm ? 12 : isLg ? 18 : 14;

  const stringSpacing = (width - marginX - (isSm ? 10 : 14)) / 5;
  const fretSpacing = (height - marginTop - marginBottom) / 4;

  const isOpenPosition = baseFret === 1;

  return (
    <div
      className={`flex flex-col items-center p-2.5 rounded-2xl bg-zinc-900/95 border border-white/10 shadow-xl select-none ${className}`}
    >
      {/* Chord Name Header with Theme Color */}
      <span
        className="font-mono font-black text-sm sm:text-base tracking-wide drop-shadow-xs mb-1.5"
        style={{ color: themeHex }}
      >
        {data.chord}
      </span>

      <svg width={width} height={height} className="overflow-visible">
        {/* Fret Number Badge on the left (Just the number e.g. "3", "2", "4", "6") */}
        {!isOpenPosition && (
          <g>
            <rect
              x={4}
              y={marginTop + fretSpacing * 0.15}
              width={marginX - 8}
              height={fretSpacing * 0.7}
              rx={5}
              fill={themeHex}
              fillOpacity="0.2"
              stroke={themeHex}
              strokeOpacity="0.45"
              strokeWidth="0.8"
            />
            <text
              x={marginX / 2}
              y={marginTop + fretSpacing * 0.53}
              fill={themeHex}
              fontSize={isSm ? '11' : isLg ? '15' : '13'}
              fontWeight="900"
              fontFamily="sans-serif"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {baseFret}
            </text>
          </g>
        )}

        {/* Nut (Thick white bar at top for open position) */}
        {isOpenPosition ? (
          <line
            x1={marginX}
            y1={marginTop}
            x2={marginX + stringSpacing * 5}
            y2={marginTop}
            stroke="#ffffff"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={marginX}
            y1={marginTop}
            x2={marginX + stringSpacing * 5}
            y2={marginTop}
            stroke="#71717a"
            strokeWidth="1.5"
          />
        )}

        {/* Fret lines (Horizontal 1 to 4) */}
        {[1, 2, 3, 4].map((f) => {
          const y = marginTop + f * fretSpacing;
          return (
            <line
              key={f}
              x1={marginX}
              y1={y}
              x2={marginX + stringSpacing * 5}
              y2={y}
              stroke="#52525b"
              strokeWidth="1.2"
              strokeOpacity="0.8"
            />
          );
        })}

        {/* String lines (Vertical: Low E string 6 on left, High E string 1 on right) */}
        {[0, 1, 2, 3, 4, 5].map((s) => {
          const x = marginX + s * stringSpacing;
          return (
            <line
              key={s}
              x1={x}
              y1={marginTop}
              x2={x}
              y2={marginTop + fretSpacing * 4}
              stroke="#71717a"
              strokeWidth={s === 0 ? '1.8' : s === 1 ? '1.5' : s >= 4 ? '0.9' : '1.2'}
            />
          );
        })}

        {/* Barre Bar with Theme Color */}
        {barre &&
          (() => {
            const relativeFret = barre.fret - baseFret + 1;
            if (relativeFret >= 1 && relativeFret <= 4) {
              const startX = marginX + (6 - barre.fromString) * stringSpacing;
              const endX = marginX + (6 - barre.toString) * stringSpacing;
              const barreWidth = endX - startX;
              const y = marginTop + (relativeFret - 1) * fretSpacing + fretSpacing * 0.22;

              return (
                <rect
                  x={startX - (isSm ? 3 : 4)}
                  y={y}
                  width={barreWidth + (isSm ? 6 : 8)}
                  height={fretSpacing * 0.56}
                  rx={fretSpacing * 0.28}
                  fill={themeHex}
                  opacity="0.9"
                  style={{ filter: `drop-shadow(0 2px 6px rgba(${themeRgb}, 0.6))` }}
                />
              );
            }
            return null;
          })()}

        {/* Fretted Dots & Open/Mute markers */}
        {frets.map((fret, stringIdx) => {
          const x = marginX + stringIdx * stringSpacing;

          if (fret === -1) {
            // Muted string (✕)
            return (
              <text
                key={stringIdx}
                x={x}
                y={marginTop - (isSm ? 7 : 9)}
                fill="#ef4444"
                fontSize={isSm ? '10' : '12'}
                fontWeight="900"
                fontFamily="sans-serif"
                textAnchor="middle"
                dominantBaseline="central"
              >
                ✕
              </text>
            );
          }

          if (fret === 0) {
            // Open string (○)
            return (
              <circle
                key={stringIdx}
                cx={x}
                cy={marginTop - (isSm ? 7 : 9)}
                r={isSm ? 3 : 4}
                fill="none"
                stroke="#22c55e"
                strokeWidth="1.6"
              />
            );
          }

          // Fretted note dot with Theme Color
          const relativeFret = fret - baseFret + 1;
          if (relativeFret >= 1 && relativeFret <= 4) {
            const y = marginTop + (relativeFret - 1) * fretSpacing + fretSpacing / 2;
            return (
              <g key={stringIdx}>
                <circle
                  cx={x}
                  cy={y}
                  r={isSm ? 4.5 : isLg ? 7.5 : 6}
                  fill={themeHex}
                  stroke="#ffffff"
                  strokeWidth="1.2"
                  style={{ filter: `drop-shadow(0 2px 6px rgba(${themeRgb}, 0.7))` }}
                />
              </g>
            );
          }

          return null;
        })}
      </svg>
    </div>
  );
};
