import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import { useId, useState } from 'react';
import type { LibraryTasteGenre } from '../../types/libraryTaste';
import {
  libraryGenreSegments,
  libraryGenreArc,
  libraryGenreLabelPosition,
  genreTrackCount,
} from '../../utils/libraryGenreChart';
import './LibraryGenreChart.css';

type Props = { genres: readonly LibraryTasteGenre[] };

export function LibraryGenreChart({ genres }: Props) {
  useLocale();
  const [hoveredGenre, setHoveredGenre] = useState<string | null>(null);
  const [focusedGenre, setFocusedGenre] = useState<string | null>(null);
  const tooltipId = useId();
  const segments = libraryGenreSegments(genres);
  const activeGenre = hoveredGenre || focusedGenre;
  const selected = segments.find((segment) => segment.name === activeGenre);
  if (!segments.length) return null;
  return (
    <div
      className="library-genre-chart"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setHoveredGenre(null);
          setFocusedGenre(null);
        }
      }}
    >
      <div className="library-genre-circle">
        <svg viewBox="0 0 320 320" role="group" aria-label={t('Распределение жанров')}>
          {segments.map((segment) => (
            <g key={segment.name}>
              <path
                className="library-genre-sector"
                data-genre={segment.name}
                data-active={!selected || selected.name === segment.name}
                d={libraryGenreArc(segment.start, segment.end)}
                fill={segment.color}
                fillRule="evenodd"
                role="img"
                aria-label={
                  segment.name + ': ' + segment.percentage + '%, ' + genreTrackCount(segment.tracks)
                }
                onMouseEnter={() => setHoveredGenre(segment.name)}
                onMouseLeave={() => setHoveredGenre(null)}
              />
              {segment.fraction >= 0.045 && (
                <text
                  {...libraryGenreLabelPosition(segment.start, segment.end)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  aria-hidden="true"
                >
                  {segment.percentage}%
                </text>
              )}
            </g>
          ))}
        </svg>
        <div className="library-genre-center">
          {selected ? (
            <div id={tooltipId} role="tooltip" className="library-genre-tooltip">
              <span>{selected.name}</span>
              <strong className="tabular-nums">{genreTrackCount(selected.tracks)}</strong>
            </div>
          ) : (
            <>
              <span>{t('Жанры')}</span>
              <strong className="tabular-nums">{segments.length}</strong>
            </>
          )}
        </div>
      </div>
      <ul className="library-taste-genres" aria-label={t('Предпочитаемые жанры')}>
        {segments.map((segment) => (
          <li key={segment.name}>
            <button
              type="button"
              data-genre={segment.name}
              data-active={selected?.name === segment.name}
              aria-label={
                segment.name + ': ' + segment.percentage + '%, ' + genreTrackCount(segment.tracks)
              }
              aria-describedby={selected?.name === segment.name ? tooltipId : undefined}
              onMouseEnter={() => setHoveredGenre(segment.name)}
              onMouseLeave={() => setHoveredGenre(null)}
              onFocus={() => setFocusedGenre(segment.name)}
              onBlur={() => setFocusedGenre(null)}
            >
              <span
                className="library-genre-swatch"
                style={{ backgroundColor: segment.color }}
                aria-hidden="true"
              />
              <span className="library-genre-name">{segment.name}</span>
              <strong className="tabular-nums">{segment.percentage || '<1'}%</strong>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
