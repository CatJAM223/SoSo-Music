import { useEffect, useRef, useState } from 'react';
import type { RoomRequest } from '../../../shared/types/listeningRoom';
import { requestRoom, roomError, useRoomSession } from '../services/listeningRoomClient';
import { ListeningRoomScreen } from './ListeningRoomScreen';

function preference(key: string) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
type Props = { onNavigate: (view: string) => void };
export function ListeningRoomView({ onNavigate }: Props) {
  const session = useRoomSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const working = useRef(false);
  const operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (request: RoomRequest) => {
    if (working.current) return;
    working.current = true;
    const ticket = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      await requestRoom(request);
      if (request.op === 'create' || request.op === 'join')
        try {
          localStorage.setItem('soso_room_name', request.payload.displayName);
        } catch {
          /* Preferences must not interrupt a connected room. */
        }
    } catch (error) {
      if (mounted.current && ticket === operation.current) setError(roomError(error));
    } finally {
      if (ticket === operation.current) {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  return (
    <ListeningRoomScreen
      session={session}
      busy={busy}
      error={error || (session.error ? roomError(session.error) : null)}
      initialName={preference('soso_room_name')}
      onCreate={(payload) => void run({ op: 'create', payload })}
      onJoin={(payload) => void run({ op: 'join', payload })}
      onLeave={() => void run({ op: 'leave' })}
      onCancel={() => {
        operation.current++;
        working.current = false;
        setBusy(false);
        setError(null);
        void requestRoom({ op: 'leave' }).catch((error) => {
          if (mounted.current) setError(roomError(error));
        });
      }}
      onBrowse={() => onNavigate('search')}
      onBrowseLibrary={() => onNavigate('liked')}
      onRemove={(entryId) => void run({ op: 'command', payload: { action: 'remove', entryId } })}
    />
  );
}
