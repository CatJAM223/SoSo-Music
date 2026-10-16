import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import { useYouTubeAvailability } from '../hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../services/youtubeAvailability';
import React, { useState } from 'react';
import {
  X,
  Trash2,
  Music,
  Disc,
  GripVertical,
  ChevronUp,
  ChevronDown,
  CornerDownRight,
  MoreHorizontal,
} from 'lucide-react';
import { useAudioState, useAudioControls } from '../context/AudioContext';
import { Track } from '../types';
import { queueEntryKey } from '../utils/queueEntry';
import { advanceTrackArtwork } from '../utils/trackArtwork';
import { detectTrackSource, resolveTrackCover, formatTime } from '../utils/formatters';
import { extractAllArtists } from '../utils/artistParser';
import { SourceBadge } from './SourceBadge';
import './QueueDrawer.css';

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UpcomingQueueItem {
  track: Track;
  actualIndex: number;
  isLoopWrapped: boolean;
}

export const QueueDrawer: React.FC<QueueDrawerProps> = ({ isOpen, onClose }) => {
  useLocale();
  const {
    currentTrack,
    queue,
    queueIndex,
    repeatMode,
    isShuffle,
    isWaveActive,
    shuffledUpcomingIndices,
  } = useAudioState();

  const { playTrack, addToQueue, insertIntoQueue, removeFromQueue, clearQueue, reorderQueue } =
    useAudioControls();

  const youtubeDisabled = useYouTubeAvailability();
  const [actionsOpenFor, setActionsOpenFor] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isGeneralDragOver, setIsGeneralDragOver] = useState<boolean>(false);

  React.useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (actionsOpenFor !== null) setActionsOpenFor(null);
          else onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose, actionsOpenFor]);

  if (!isOpen) return null;

  // Build upcoming items list
  // 1. Normal upcoming items (after queueIndex to queue.length - 1)
  const upcomingItems: UpcomingQueueItem[] = [];
  if (isShuffle && !isWaveActive) {
    for (const index of shuffledUpcomingIndices) {
      if (queue[index])
        upcomingItems.push({ track: queue[index], actualIndex: index, isLoopWrapped: false });
    }
  } else {
    for (let i = queueIndex + 1; i < queue.length; i++) {
      upcomingItems.push({
        track: queue[i],
        actualIndex: i,
        isLoopWrapped: false,
      });
    }

    // 2. If Repeat All is enabled and there are tracks earlier in the queue, wrap around to the beginning!
    if (repeatMode === 'all' && !isWaveActive) {
      for (let i = 0; i <= queueIndex && i < queue.length; i++) {
        // Don't duplicate the currently playing track in upcoming list if it's the only one
        if (queue.length > 1 && i !== queueIndex) {
          upcomingItems.push({
            track: queue[i],
            actualIndex: i,
            isLoopWrapped: true,
          });
        }
      }
    }
  }

  const handleGeneralDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsGeneralDragOver(false);

    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const payload = JSON.parse(jsonData);
        if (payload.type === 'EXTERNAL_TRACK' && payload.track) {
          addToQueue(payload.track);
        }
      }
    } catch (err) {
      console.warn('Queue general drop parse error:', err);
    }
  };

  const handleItemDrop = (e: React.DragEvent, targetActualIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIsGeneralDragOver(false);

    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const payload = JSON.parse(jsonData);
        if (payload.type === 'EXTERNAL_TRACK' && payload.track) {
          insertIntoQueue(payload.track, targetActualIndex);
          setDraggedIndex(null);
          setDragOverIndex(null);
          return;
        }
      }
    } catch (err) {}

    // Internal queue item reorder
    if (draggedIndex !== null && draggedIndex !== targetActualIndex) {
      reorderQueue(draggedIndex, targetActualIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        onClick={onClose}
        className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-fade-in"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setIsGeneralDragOver(true);
        }}
        onDragLeave={() => setIsGeneralDragOver(false)}
        data-queue-drawer
        onDrop={handleGeneralDrop}
        className={`fixed inset-x-0 bottom-0 md:inset-x-auto md:right-0 md:top-11 md:bottom-24 h-[85vh] md:h-auto w-full md:w-[420px] bg-white dark:bg-[#141416] backdrop-blur-2xl border-t md:border-t-0 md:border-l border-slate-200 dark:border-zinc-800 shadow-2xl rounded-t-3xl md:rounded-none z-50 flex flex-col animate-fade-in transition-all duration-200 select-none ${
          isGeneralDragOver ? 'ring-2 ring-soso-brand ring-inset bg-soso-brand/[0.03]' : ''
        }`}
      >
        {/* Mobile Pull Handle */}
        <div className="md:hidden pt-2.5 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="w-5 h-5 text-soso-brand" />
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                {t('Очередь воспроизведения')}
              </h2>
            </div>
          </div>
          <button
            aria-label={t('Закрыть')}
            onClick={() => {
              setActionsOpenFor(null);
              onClose();
            }}
            className="p-1.5 rounded-xl text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-90 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Queue Content */}
        <div className="shrink-0 px-4 pt-4 pb-3">
          {/* Now Playing Section */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400 mb-2">
              {t('Сейчас играет')}
            </h3>
            {currentTrack ? (
              <div className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-zinc-800/60 rounded-xl border border-slate-200 dark:border-zinc-700/40 shadow-sm">
                <img
                  src={resolveTrackCover(currentTrack)}
                  alt={currentTrack.title}
                  onError={(event) => advanceTrackArtwork(event.currentTarget, currentTrack)}
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-soso-brand truncate">
                    {currentTrack.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                    {extractAllArtists(currentTrack.artist, currentTrack.title).join(', ')}
                  </p>
                </div>
                <Disc className="w-5 h-5 text-soso-brand animate-spin-slow flex-shrink-0" />
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-zinc-500 italic">
                {t('Ничего не играет')}
              </p>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 queue-scroll">
          {/* Next Up Section */}
          <div>
            <div className="queue-list-heading flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-400">
                  {t('Следующие треки (')}
                  {upcomingItems.length})
                </h3>
              </div>
              {queue.length > 1 && (
                <button
                  onClick={() => {
                    setActionsOpenFor(null);
                    clearQueue();
                  }}
                  className="text-xs text-slate-400 dark:text-zinc-400 hover:text-red-500 active:scale-95 transition-all font-semibold"
                >
                  {t('Очистить')}
                </button>
              )}
            </div>

            {upcomingItems.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  {t(
                    isWaveActive
                      ? 'В очереди пока нет следующих треков.'
                      : 'Перетащите сюда треки, чтобы продолжить прослушивание.',
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-2" role="list">
                {upcomingItems.map((item, idx) => {
                  const track = item.track;
                  const actualIndex = item.actualIndex;
                  const isDragging = draggedIndex === actualIndex;
                  const isOver = dragOverIndex === actualIndex;

                  let displacementClass = '';
                  if (draggedIndex !== null && dragOverIndex !== null && !isDragging) {
                    if (draggedIndex < dragOverIndex) {
                      if (actualIndex > draggedIndex && actualIndex <= dragOverIndex) {
                        displacementClass = '-translate-y-2';
                      }
                    } else if (draggedIndex > dragOverIndex) {
                      if (actualIndex >= dragOverIndex && actualIndex < draggedIndex) {
                        displacementClass = 'translate-y-2';
                      }
                    }
                  }

                  return (
                    <div
                      {...youtubeDisabledProps(track, youtubeDisabled)}
                      key={queueEntryKey(track)}
                      role="listitem"
                      data-queue-next={idx === 0 ? true : undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(actualIndex));
                        e.dataTransfer.setData(
                          'application/json',
                          JSON.stringify({ type: 'INTERNAL_QUEUE', actualIndex }),
                        );
                        setDraggedIndex(actualIndex);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverIndex(actualIndex);
                      }}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDrop={(e) => handleItemDrop(e, actualIndex)}
                      className={`queue-row ${idx === 0 ? 'queue-row-next' : ''} group relative flex items-center justify-between p-2.5 rounded-xl transition-colors duration-150 cursor-grab active:cursor-grabbing ${
                        isDragging
                          ? 'opacity-30 scale-[0.97] bg-soso-brand/10 border-2 border-dashed border-soso-brand'
                          : isOver
                            ? 'bg-soso-brand/15 ring-2 ring-soso-brand/50 shadow-md scale-[1.01] border border-soso-brand/30'
                            : item.isLoopWrapped
                              ? 'bg-slate-100/60 dark:bg-zinc-800/40 hover:bg-slate-200/80 dark:hover:bg-zinc-800/80 border border-slate-200/50 dark:border-zinc-700/30'
                              : 'hover:bg-slate-100 dark:hover:bg-zinc-800/70 border border-transparent'
                      } ${displacementClass}`}
                    >
                      {/* Visual Drop Indicator Line */}
                      {isOver && draggedIndex !== null && draggedIndex !== actualIndex && (
                        <div
                          className={`absolute left-2 right-2 h-0.5 bg-soso-brand rounded-full shadow-sm shadow-soso-brand ${
                            draggedIndex > actualIndex ? '-top-1' : '-bottom-1'
                          }`}
                        />
                      )}

                      {/* Drag Grip Handle */}
                      <div
                        className="queue-grip text-slate-300 dark:text-zinc-600 pr-1 flex-shrink-0"
                        draggable
                        title={t('Перетащить трек')}
                      >
                        <span className="queue-position">{idx + 1}</span>
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {/* Track Info */}
                      <div
                        onClick={() => {
                          setActionsOpenFor(null);
                          playTrack(track, undefined, isWaveActive);
                        }}
                        className="queue-track-info flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                        role="button"
                        tabIndex={0}
                        title={
                          track.title +
                          ' — ' +
                          extractAllArtists(track.artist, track.title).join(', ')
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setActionsOpenFor(null);
                            playTrack(track, undefined, isWaveActive);
                          }
                        }}
                      >
                        <div className="relative flex-shrink-0">
                          <img
                            src={resolveTrackCover(track)}
                            alt={track.title}
                            onError={(event) => advanceTrackArtwork(event.currentTarget, track)}
                            className="w-12 h-12 rounded-lg object-cover"
                            draggable={false}
                            loading="lazy"
                          />
                          {item.isLoopWrapped && (
                            <div
                              title={t('Воспроизведётся после окончания очереди (по кругу)')}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-soso-brand text-black flex items-center justify-center shadow"
                            >
                              <CornerDownRight className="w-2.5 h-2.5" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-soso-brand">
                            {track.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <SourceBadge source={detectTrackSource(track)} size="sm" />
                            <p className="text-xs text-slate-500 dark:text-zinc-400 truncate">
                              {extractAllArtists(track.artist, track.title).join(', ')}
                            </p>
                          </div>
                        </div>
                      </div>

                      <span className="queue-duration">{formatTime(track.duration)}</span>
                      <button
                        className="queue-more"
                        aria-label={t('Действия с треком')}
                        aria-expanded={actionsOpenFor === actualIndex}
                        aria-haspopup="menu"
                        onClick={() =>
                          setActionsOpenFor(actionsOpenFor === actualIndex ? null : actualIndex)
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {/* Actions: Move Up / Down & Remove */}
                      <div
                        role="menu"
                        hidden={actionsOpenFor !== actualIndex}
                        className={`queue-actions-menu ${idx > 1 && idx >= upcomingItems.length - 2 ? 'queue-menu-above' : ''}`}
                      >
                        {idx > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionsOpenFor(null);
                              reorderQueue(actualIndex, upcomingItems[idx - 1].actualIndex);
                            }}
                            role="menuitem"
                            title={t('Переместить выше')}
                            aria-label={t('Переместить выше')}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                          >
                            <ChevronUp className="w-4 h-4" />
                            <span>{t('Переместить выше')}</span>
                          </button>
                        )}

                        {idx < upcomingItems.length - 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderQueue(actualIndex, upcomingItems[idx + 1].actualIndex);
                            }}
                            role="menuitem"
                            title={t('Переместить ниже')}
                            aria-label={t('Переместить ниже')}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                          >
                            <ChevronDown className="w-4 h-4" />
                            <span>{t('Переместить ниже')}</span>
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionsOpenFor(null);
                            removeFromQueue(actualIndex);
                          }}
                          role="menuitem"
                          title={t('Удалить из очереди')}
                          aria-label={t('Удалить из очереди')}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{t('Удалить из очереди')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
