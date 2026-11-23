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
import { notifyQueueEdit } from '../utils/notifyQueueEdit';
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

const QUEUE_ROW_HEIGHT = 84;
const QUEUE_OVERSCAN = 6;

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
  const [actionsOpenFor, setActionsOpenFor] = useState<string | null>(null);
  const queueId = React.useId();
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const restoreActionsFocus = React.useRef<string[] | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [focusedEntry, setFocusedEntry] = useState<string>();
  const [viewport, setViewport] = useState({ top: 0, height: 640 });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const dragScroll = React.useRef({ frame: 0, speed: 0 });
  const [isGeneralDragOver, setIsGeneralDragOver] = useState<boolean>(false);
  const [present, setPresent] = useState(isOpen);
  React.useEffect(() => {
    if (isOpen) {
      setPresent(true);
      return;
    }
    setActionsOpenFor(null);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  React.useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog:modal')) {
          e.preventDefault();
          if (actionsOpenFor !== null) {
            restoreActionsFocus.current = [actionsOpenFor];
            setActionsOpenFor(null);
          } else onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose, actionsOpenFor]);

  React.useLayoutEffect(() => {
    if (actionsOpenFor !== null || !restoreActionsFocus.current) return;
    const candidates = restoreActionsFocus.current;
    restoreActionsFocus.current = null;
    if (!isOpen) return;
    for (const id of candidates) {
      const trigger = document.getElementById(id);
      trigger?.focus();
      if (trigger && document.activeElement === trigger) return;
    }
    closeButton.current?.focus();
  }, [actionsOpenFor, isOpen]);

  const upcomingItems = React.useMemo(() => {
    const items: UpcomingQueueItem[] = [];
    if (!isOpen && !present) return items;
    if (isShuffle && !isWaveActive) {
      for (const index of shuffledUpcomingIndices) {
        if (queue[index])
          items.push({ track: queue[index], actualIndex: index, isLoopWrapped: false });
      }
    } else {
      for (let i = queueIndex + 1; i < queue.length; i++) {
        items.push({
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
            items.push({
              track: queue[i],
              actualIndex: i,
              isLoopWrapped: true,
            });
          }
        }
      }
    }
    return items;
  }, [
    isOpen,
    present,
    isShuffle,
    isWaveActive,
    queue,
    queueIndex,
    repeatMode,
    shuffledUpcomingIndices,
  ]);

  const virtual = upcomingItems.length > 40;
  const updateViewport = React.useCallback(() => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (!scroll || !list) return;
    const top = Math.max(0, scroll.scrollTop - list.offsetTop);
    const height = scroll.clientHeight;
    setViewport((previous) =>
      previous.top === top && previous.height === height ? previous : { top, height },
    );
  }, []);

  React.useLayoutEffect(() => {
    if (!isOpen || !virtual || !scrollRef.current) return;
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [isOpen, virtual, updateViewport]);

  const stopDragScroll = React.useCallback(() => {
    cancelAnimationFrame(dragScroll.current.frame);
    dragScroll.current.frame = 0;
    dragScroll.current.speed = 0;
  }, []);
  React.useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('dragend', stopDragScroll);
    window.addEventListener('drop', stopDragScroll);
    return () => {
      stopDragScroll();
      window.removeEventListener('dragend', stopDragScroll);
      window.removeEventListener('drop', stopDragScroll);
    };
  }, [isOpen, stopDragScroll]);

  if (!isOpen && !present) return null;

  const start = virtual
    ? Math.max(
        0,
        Math.min(
          upcomingItems.length - 1,
          Math.floor(viewport.top / QUEUE_ROW_HEIGHT) - QUEUE_OVERSCAN,
        ),
      )
    : 0;
  const end = virtual
    ? Math.min(
        upcomingItems.length,
        start + Math.ceil(viewport.height / QUEUE_ROW_HEIGHT) + 2 * QUEUE_OVERSCAN + 1,
      )
    : upcomingItems.length;
  const visible = new Set(Array.from({ length: end - start }, (_, index) => start + index));
  if (virtual && (focusedEntry || draggedIndex !== null)) {
    const focused = focusedEntry
      ? upcomingItems.findIndex((item) => queueEntryKey(item.track) === focusedEntry)
      : -1;
    if (focused >= 0) visible.add(focused);
    const dragged =
      draggedIndex === null
        ? -1
        : upcomingItems.findIndex((item) => item.actualIndex === draggedIndex);
    if (dragged >= 0) visible.add(dragged);
  }

  const handleScrollDrag = (event: React.DragEvent<HTMLDivElement>) => {
    const scroll = event.currentTarget;
    const { top, bottom } = scroll.getBoundingClientRect();
    const edge = Math.min(56, (bottom - top) / 3);
    const distance =
      event.clientY < top + edge
        ? event.clientY - top - edge
        : Math.max(0, event.clientY - bottom + edge);
    if (!distance) {
      stopDragScroll();
      return;
    }
    const motion = dragScroll.current;
    motion.speed = Math.max(-18, Math.min(18, distance / 3));
    if (motion.frame) return;
    const step = () => {
      scroll.scrollTop += motion.speed;
      motion.frame = requestAnimationFrame(step);
    };
    motion.frame = requestAnimationFrame(step);
  };

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

  const actionsTriggerId = (track: Track) =>
    `${queueId}-actions-${encodeURIComponent(queueEntryKey(track)!)}`;

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        onClick={onClose}
        inert={!isOpen}
        aria-hidden="true"
        data-open={isOpen}
        className="soso-queue-backdrop md:hidden fixed inset-0 bg-black/70 backdrop-blur-xs z-40"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setIsGeneralDragOver(true);
        }}
        onDragLeave={() => setIsGeneralDragOver(false)}
        data-queue-drawer
        data-open={isOpen}
        aria-hidden={!isOpen || undefined}
        inert={!isOpen}
        onDrop={handleGeneralDrop}
        className={`soso-queue-drawer fixed inset-x-0 bottom-0 md:inset-x-auto md:right-0 md:top-11 md:bottom-24 h-[85vh] md:h-auto w-full md:w-[420px] bg-white dark:bg-[#141416] backdrop-blur-2xl border-t md:border-t-0 md:border-l border-slate-200 dark:border-zinc-800 shadow-2xl rounded-t-3xl md:rounded-none z-50 flex flex-col select-none ${
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
            ref={closeButton}
            type="button"
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
              <div className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-zinc-800/60 rounded-xl border border-slate-200 dark:border-zinc-700/40 shadow-xs">
                <img
                  src={resolveTrackCover(currentTrack, undefined, 'thumbnail')}
                  alt={currentTrack.title}
                  onError={(event) =>
                    advanceTrackArtwork(event.currentTarget, currentTrack, 'thumbnail')
                  }
                  className="w-12 h-12 rounded-lg object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-soso-brand truncate">
                    {currentTrack.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                    {extractAllArtists(currentTrack.artist, currentTrack.title).join(', ')}
                  </p>
                </div>
                <Disc className="w-5 h-5 text-soso-brand animate-spin-slow shrink-0" />
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-zinc-500 italic">
                {t('Ничего не играет')}
              </p>
            )}
          </div>
        </div>
        <div
          ref={scrollRef}
          onScroll={virtual ? updateViewport : undefined}
          onDragOver={virtual ? handleScrollDrag : undefined}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopDragScroll();
          }}
          className="relative flex-1 min-h-0 overflow-y-auto px-4 pb-4 queue-scroll"
        >
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
                    closeButton.current?.focus();
                    notifyQueueEdit(t('Очередь очищена'), clearQueue());
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
              <div
                ref={listRef}
                className={virtual ? 'relative' : 'space-y-2'}
                style={virtual ? { height: upcomingItems.length * QUEUE_ROW_HEIGHT } : undefined}
                role="list"
              >
                {[...visible]
                  .sort((left, right) => left - right)
                  .map((idx) => {
                    const item = upcomingItems[idx];
                    const track = item.track;
                    const actualIndex = item.actualIndex;
                    const triggerId = actionsTriggerId(track);
                    const actionsId = `${triggerId}-panel`;
                    const actionsOpen = actionsOpenFor === triggerId;
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
                        aria-posinset={virtual ? idx + 1 : undefined}
                        aria-setsize={virtual ? upcomingItems.length : undefined}
                        style={
                          virtual
                            ? {
                                position: 'absolute',
                                top: idx * QUEUE_ROW_HEIGHT,
                                insetInline: 0,
                                height: QUEUE_ROW_HEIGHT - 8,
                              }
                            : undefined
                        }
                        onFocus={() => setFocusedEntry(queueEntryKey(track))}
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget))
                            setFocusedEntry(undefined);
                        }}
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
                            className={`absolute left-2 right-2 h-0.5 bg-soso-brand rounded-full shadow-xs shadow-soso-brand ${
                              draggedIndex > actualIndex ? '-top-1' : '-bottom-1'
                            }`}
                          />
                        )}

                        {/* Drag Grip Handle */}
                        <div
                          className="queue-grip text-slate-300 dark:text-zinc-600 pr-1 shrink-0"
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
                          <div className="relative shrink-0">
                            <img
                              src={resolveTrackCover(track, undefined, 'thumbnail')}
                              alt={track.title}
                              onError={(event) =>
                                advanceTrackArtwork(event.currentTarget, track, 'thumbnail')
                              }
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
                        <div
                          className="shrink-0"
                          onBlur={(event) => {
                            if (actionsOpen && !event.currentTarget.contains(event.relatedTarget))
                              setActionsOpenFor(null);
                          }}
                        >
                          <button
                            id={triggerId}
                            type="button"
                            className="queue-more"
                            aria-label={t('Действия с треком')}
                            aria-expanded={actionsOpen}
                            aria-controls={actionsId}
                            onClick={() => setActionsOpenFor(actionsOpen ? null : triggerId)}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          <div
                            id={actionsId}
                            role="group"
                            aria-labelledby={triggerId}
                            hidden={!actionsOpen}
                            className={`queue-actions-menu ${idx > 1 && idx >= upcomingItems.length - 2 ? 'queue-menu-above' : ''}`}
                          >
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  restoreActionsFocus.current = [triggerId];
                                  setActionsOpenFor(null);
                                  reorderQueue(actualIndex, upcomingItems[idx - 1].actualIndex);
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                              >
                                <ChevronUp className="w-4 h-4" />
                                <span>{t('Переместить выше')}</span>
                              </button>
                            )}

                            {idx < upcomingItems.length - 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  restoreActionsFocus.current = [triggerId];
                                  setActionsOpenFor(null);
                                  reorderQueue(actualIndex, upcomingItems[idx + 1].actualIndex);
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                              >
                                <ChevronDown className="w-4 h-4" />
                                <span>{t('Переместить ниже')}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                restoreActionsFocus.current = upcomingItems
                                  .slice(Math.max(idx - 1, 0), idx + 2)
                                  .filter((candidate) => candidate !== item)
                                  .reverse()
                                  .map((candidate) => actionsTriggerId(candidate.track));
                                setActionsOpenFor(null);
                                notifyQueueEdit(
                                  t('«{0}» удалён из очереди', track.title),
                                  removeFromQueue(actualIndex),
                                );
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-90 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>{t('Удалить из очереди')}</span>
                            </button>
                          </div>
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
