import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Headphones,
  Link2,
  Loader2,
  DoorOpen,
  Music2,
  Plus,
  UsersRound,
  Trash2,
} from 'lucide-react';
import { t } from '../../../shared/i18n/locale';
import { useLocale } from '../../../shared/i18n/useLocale';
import type { RoomRequest, RoomSession } from '../../../shared/types/listeningRoom';
import { SourceBadge } from '../../../shared/components/SourceBadge';
import { safeRoomArtwork } from '../services/roomArtwork';
import './ListeningRoomScreen.css';

type CreatePayload = Extract<RoomRequest, { op: 'create' }>['payload'];
type JoinPayload = Extract<RoomRequest, { op: 'join' }>['payload'];
type Props = {
  session: RoomSession;
  busy: boolean;
  error: string | null;
  initialName?: string;
  onCreate: (payload: CreatePayload) => void;
  onJoin: (payload: JoinPayload) => void;
  onLeave: () => void;
  onCancel?: () => void;
  onBrowse: () => void;
  onBrowseLibrary?: () => void;
  onRemove?: (entryId: string) => void;
};

export function ListeningRoomScreen({
  session,
  busy,
  error,
  initialName = '',
  onCreate,
  onJoin,
  onLeave,
  onCancel,
  onBrowse,
  onBrowseLibrary,
  onRemove,
}: Props) {
  useLocale();
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [addingTracks, setAddingTracks] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const connected = session.status === 'connected';
  const host = session.role === 'host';
  const playback = session.playback;
  const handleCopy = async () => {
    if (!session.invitation) return;
    try {
      await navigator.clipboard.writeText(session.invitation);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get('displayName') || '').trim();
    if (!displayName || displayName.length > 48 || busy) return;
    if (form === 'create')
      onCreate({
        mode: 'internet',
        displayName,
        name: String(data.get('roomName') || '').trim(),
      });
    else onJoin({ displayName, invitation: String(data.get('invitation') || '').trim() });
  };
  return (
    <section className="listening-room" aria-label={t('Совместное прослушивание')}>
      {error && (
        <div className="room-error" role="alert">
          {error}
        </div>
      )}
      {connected ? (
        <>
          <div className="room-session-heading">
            <div>
              <h2>{session.name}</h2>
            </div>
            <div className="room-session-actions">
              <button
                type="button"
                className="room-copy-button"
                onClick={() => void handleCopy()}
                onPointerLeave={() => setCopied(false)}
                onBlur={() => setCopied(false)}
                disabled={!session.invitation}
                aria-label={t('Скопировать приглашение')}
                title={copied ? t('Скопировано') : t('Скопировать приглашение')}
              >
                {copied ? (
                  <Check size={19} aria-hidden="true" />
                ) : (
                  <Link2 size={19} aria-hidden="true" />
                )}
              </button>
              <span className="sr-only" role="status">
                {copied ? t('Скопировано') : ''}
              </span>
              <button
                type="button"
                className="room-exit-button"
                onClick={onLeave}
                disabled={busy}
                aria-label={host ? t('Закрыть комнату') : t('Выйти из комнаты')}
                title={host ? t('Закрыть комнату') : t('Выйти из комнаты')}
              >
                <DoorOpen size={19} aria-hidden="true" />
              </button>
            </div>
          </div>
          {copyError && (
            <p className="room-error" role="alert">
              {t('Не удалось скопировать приглашение. Попробуйте ещё раз.')}
            </p>
          )}
          <div className="room-session-grid">
            <div className="room-session-main">
              <article className="room-now-playing room-panel">
                <div className="room-track-main">
                  <div className={`room-cover ${playback?.playing ? 'is-playing' : ''}`}>
                    <Music2 size={38} />
                    <span />
                    <span />
                    <span />
                    {safeRoomArtwork(playback?.track?.cover) && (
                      <img
                        key={playback?.track?.cover}
                        src={safeRoomArtwork(playback?.track?.cover)}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    )}
                  </div>
                  <div className="room-track-info">
                    <h3>{playback?.track?.title || t('В комнате пока тихо')}</h3>
                    <p className="room-track-artist">
                      {playback?.track && <SourceBadge source={playback.track.source} size="sm" />}
                      <span>
                        {playback?.track?.artist ||
                          t('Выберите первый трек, чтобы начать слушать вместе.')}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="room-playback-footer">
                  <button
                    type="button"
                    className="room-button room-button-brand"
                    aria-expanded={addingTracks}
                    aria-controls="room-add-sources"
                    onClick={() => setAddingTracks(!addingTracks)}
                  >
                    <Plus size={16} />
                    {t('Добавить треки')}
                  </button>
                </div>
                {addingTracks && (
                  <div
                    id="room-add-sources"
                    className="room-add-sources"
                    role="group"
                    aria-label={t('Добавить треки')}
                  >
                    <button
                      className="room-button room-button-quiet"
                      onClick={() => {
                        setAddingTracks(false);
                        onBrowse();
                      }}
                    >
                      {t('Поиск музыки')}
                    </button>
                    {onBrowseLibrary && (
                      <button
                        className="room-button room-button-quiet"
                        onClick={() => {
                          setAddingTracks(false);
                          onBrowseLibrary();
                        }}
                      >
                        <Music2 size={16} />
                        {t('Моя музыка')}
                      </button>
                    )}
                  </div>
                )}
              </article>
              <article className="room-panel room-queue">
                <div className="room-panel-title">
                  <h3>{t('Общая очередь')}</h3>
                  <span>{playback?.queue.length || 0}</span>
                </div>
                {playback?.queue.length ? (
                  <ol>
                    {playback.queue.map((song, index) => (
                      <li key={song.entryId || `${song.source}:${song.id}`}>
                        <span className="room-queue-number">{index + 1}</span>
                        {safeRoomArtwork(song.cover) && (
                          <img
                            key={song.cover}
                            className="room-queue-cover"
                            src={safeRoomArtwork(song.cover)}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                              event.currentTarget.hidden = true;
                            }}
                          />
                        )}
                        <div>
                          <strong>{song.title}</strong>
                          <span>{song.artist}</span>
                        </div>
                        {host && song.entryId && (
                          <button
                            className="room-button room-button-quiet"
                            disabled={busy}
                            onClick={() => onRemove?.(song.entryId!)}
                            aria-label={t('Удалить из очереди')}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="room-empty-note">
                    {t('Очередь пока пуста. Добавьте треки — это может сделать каждый участник.')}
                  </p>
                )}
              </article>
            </div>
            <aside className="room-session-side">
              <article className="room-panel room-members">
                <div className="room-panel-title">
                  <h3>{t('Участники')}</h3>
                  <span>{session.members?.length || 1}/8</span>
                </div>
                <ul>
                  {session.members?.map((member) => (
                    <li key={member.id}>
                      <div className={`room-avatar ${member.isHost ? 'is-host' : ''}`}>
                        {member.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <strong>
                          {member.name}
                          {member.id === session.selfId && <span> · {t('Вы')}</span>}
                        </strong>
                        <small>{member.isHost ? t('Ведущий') : t('Слушатель')}</small>
                      </div>
                      {member.isHost && <Crown size={15} className="room-crown" />}
                    </li>
                  ))}
                </ul>
              </article>
            </aside>
          </div>
        </>
      ) : (
        <>
          {!form && (
            <div className="room-hero">
              <div className="room-orbit" aria-hidden="true">
                <span />
                <span />
                <div>
                  <Headphones size={43} />
                </div>
                <UsersRound size={21} className="room-orbit-friend" />
              </div>
              <h2>{t('Слушайте вместе')}</h2>
              <p>
                {t(
                  'Одна комната, одна очередь и любимая музыка. Создайте свою комнату или присоединитесь к друзьям.',
                )}
              </p>
            </div>
          )}
          {!form ? (
            <div className="room-choice-grid">
              <button className="room-choice" onClick={() => setForm('create')}>
                <span className="room-choice-icon">
                  <Plus size={24} />
                </span>
                <strong>{t('Создать комнату')}</strong>
                <span>{t('Выбирайте треки и приглашайте друзей слушать вместе.')}</span>
                <ArrowRight size={19} className="room-choice-arrow" />
              </button>
              <button className="room-choice" onClick={() => setForm('join')}>
                <span className="room-choice-icon">
                  <UsersRound size={24} />
                </span>
                <strong>{t('Подключиться к комнате')}</strong>
                <span>{t('Вставьте приглашение и присоединяйтесь к музыке друзей.')}</span>
                <ArrowRight size={19} className="room-choice-arrow" />
              </button>
            </div>
          ) : (
            <div className="room-form-panel room-panel">
              <button
                className="room-back"
                disabled={busy && !onCancel}
                onClick={() => {
                  if (busy) onCancel?.();
                  setForm(null);
                }}
              >
                <ArrowLeft size={15} />
                {busy ? t('Отмена') : t('Назад')}
              </button>
              <h2>{form === 'create' ? t('Создать комнату') : t('Подключиться к комнате')}</h2>
              <form key={form} onSubmit={submit}>
                <label className="room-field">
                  <span>{t('Ваше имя')}</span>
                  <input
                    name="displayName"
                    autoComplete="nickname"
                    required
                    maxLength={48}
                    defaultValue={initialName}
                    placeholder={t('Как вас представить друзьям?')}
                    disabled={busy}
                  />
                </label>
                {form === 'create' ? (
                  <>
                    <label className="room-field">
                      <span>{t('Название комнаты')}</span>
                      <input
                        name="roomName"
                        required
                        maxLength={48}
                        defaultValue={t('Комната друзей')}
                        disabled={busy}
                      />
                    </label>
                    <p className="room-form-note">
                      {t(
                        'Отправьте приглашение другу — плеер подключится автоматически. Используется публичная сеть iroh; её доступность может зависеть от провайдера.',
                      )}
                    </p>
                  </>
                ) : (
                  <label className="room-field">
                    <span>{t('Приглашение в комнату')}</span>
                    <textarea
                      name="invitation"
                      required
                      maxLength={2048}
                      rows={3}
                      placeholder="SOSO1.…"
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                )}
                <button
                  className="room-button room-button-brand room-full"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 size={17} className="room-spinner" />
                  ) : form === 'join' ? (
                    <Link2 size={17} />
                  ) : null}
                  {busy
                    ? t('Подключаемся…')
                    : form === 'create'
                      ? t('Создать комнату')
                      : t('Подключиться к комнате')}
                </button>
              </form>
            </div>
          )}
          <div className="room-landing-note">
            <span>
              {t(
                'Каждый участник слушает треки через свой плеер. Доступность музыки зависит от источника.',
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
