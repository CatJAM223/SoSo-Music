import { useSyncExternalStore } from 'react';
import { t } from '../../../shared/i18n/locale';
import type { RoomRequest, RoomSession } from '../../../shared/types/listeningRoom';

let session: RoomSession = { status: 'idle' };
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;
let generation = 0;
function receive(next: RoomSession) {
  generation++;
  session = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribe = window.electronAPI?.onListeningRoomSession?.(receive);
    const before = generation;
    void requestRoom<RoomSession>({ op: 'status' })
      .then((status) => {
        if (before === generation && listeners.size) receive(status);
      })
      .catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };
}
export function useRoomSession() {
  return useSyncExternalStore(subscribe, () => session);
}
export function useRoomConnection() {
  return useSyncExternalStore(subscribe, () =>
    session.status === 'connected' ? `${session.role}:${session.selfId}` : undefined,
  );
}
export function useRoomTrackState(id: string | number, source: string) {
  return useSyncExternalStore(subscribe, () => {
    if (session.status !== 'connected') return 'offline';
    const matches = (song: import('../../../shared/types/listeningRoom').RoomSong) =>
      song.id === String(id) && song.source === source;
    if (session.playback?.track && matches(session.playback.track)) return 'current';
    return session.playback?.queue.some(matches) ? 'queued' : 'available';
  });
}
export async function requestRoom<T>(request: RoomRequest): Promise<T> {
  if (!window.electronAPI?.listeningRoomRequest) throw Error('native_rooms_unavailable');
  const value = await window.electronAPI.listeningRoomRequest(request);
  if (request.op === 'create' || request.op === 'join' || request.op === 'leave')
    receive(value as RoomSession);
  return value as T;
}
const errors: Record<string, string> = {
  internet_unavailable:
    'Не удалось подключиться к сети комнат. Проверьте интернет и попробуйте снова.',
  internet_peer_unreachable:
    'Не удалось соединиться с ведущим через интернет. Проверьте, что комната открыта и оба плеера обновлены.',
  queue_full: 'В общей очереди уже 20 треков.',
  host_only: 'Управлять воспроизведением может только ведущий.',
  queue_entry_missing: 'Этот трек уже удалён из очереди.',
  room_command_timeout: 'Сервер не подтвердил действие. Проверьте состояние комнаты.',
  unsupported_track: 'Этот трек нельзя добавить в комнату.',
  invalid_name: 'Введите имя и название длиной до 48 символов.',
  invalid_invitation: 'Приглашение не распознано. Скопируйте его целиком.',
  invalid_relay: 'Проверьте адрес ретранслятора.',
  secure_relay_required:
    'Для подключения через интернет нужен адрес wss:// с защищённым соединением.',
  relay_unreachable: 'Не удалось связаться с ретранслятором. Проверьте адрес и подключение.',
  room_not_found: 'Комната не найдена. Возможно, ведущий уже закрыл её.',
  room_closed: 'Ведущий закрыл комнату.',
  room_full: 'В комнате уже восемь участников.',
  relay_full: 'Ретранслятор заполнен. Попробуйте позже.',
  connection_lost: 'Связь с комнатой потеряна. Подключитесь повторно.',
  native_rooms_unavailable: 'Нативный модуль комнат недоступен. Выполните сборку приложения.',
  native_rooms_timeout:
    'Подключение заняло слишком много времени. Проверьте адрес и попробуйте снова.',
  no_local_network: 'Локальная сеть не найдена. Проверьте сетевое подключение.',
  relay_bind_failed: 'Не удалось создать комнату в выбранной сети.',
  already_connected: 'Сначала выйдите из текущей комнаты.',
};
export function roomError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(errors).find((key) => message.includes(key));
  return t(code ? errors[code] : 'Не удалось выполнить действие. Попробуйте ещё раз.');
}
