/** Rust owns the wire format and room rules; these types describe its IPC boundary. */
export type RoomSong = {
  entryId?: string;
  id: string;
  source: 'youtube' | 'soundcloud';
  title: string;
  artist: string;
  album: string;
  cover?: string;
  duration: number;
};
export type RoomPlayback = {
  track: RoomSong | null;
  queue: RoomSong[];
  playing: boolean;
  preparing?: boolean;
  position: number;
};
export type RoomSession = {
  status: 'idle' | 'connected';
  error?: string | null;
  name?: string;
  selfId?: string;
  role?: 'host' | 'guest';
  members?: { id: string; name: string; isHost: boolean }[];
  invitation?: string;
  playback?: RoomPlayback;
  revision?: number;
  latencyMs?: number;
};
export type RoomSyncDecision = {
  action: 'none' | 'load' | 'prepare' | 'buffer' | 'play' | 'pause' | 'seek';
  playback?: RoomPlayback;
  replaceQueue?: boolean;
  seekRevision?: number;
};
export type RoomRequest =
  | { op: 'status' | 'networks' | 'leave' }
  | {
      op: 'create';
      payload: {
        mode: 'internet' | 'relay' | 'local';
        displayName: string;
        name: string;
        relay?: string;
        address?: string;
      };
    }
  | { op: 'join'; payload: { displayName: string; invitation: string } }
  | {
      op: 'pulse';
      payload?: {
        id?: string;
        source?: string;
        entryId?: string;
        ready: boolean;
        ended?: boolean;
        seekRevision?: number;
      };
    }
  | {
      op: 'command';
      payload:
        | { action: 'enqueue'; song: RoomSong }
        | { action: 'remove'; entryId: string }
        | { action: 'play' | 'pause' | 'next' | 'toggle' }
        | { action: 'seek'; position: number };
    }
  | {
      op: 'synchronize';
      payload: {
        entryId?: string;
        id?: string;
        source?: string;
        position: number;
        playing: boolean;
        loading: boolean;
        blocked: boolean;
        ready?: boolean;
        ended?: boolean;
        seekRevision?: number;
        queue?: RoomSong[];
      };
    };
