import { buildLocalListenUrl, buildSoSoListenUrl } from '../../../shared/utils/localListenLink.ts';
import net from 'net';

export interface DiscordPlaybackData {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  currentTime?: number;
  isPlaying: boolean;
  coverUrl?: string;
  trackId?: string | number;
  source?: string;
}

export class DiscordRPCService {
  private static directListenEnabled = false;
  public static setDirectListenEnabled(enabled: boolean): void {
    this.directListenEnabled = enabled;
  }
  private static listenOrigin: string | null = null;
  public static setListenOrigin(origin: string | null): void {
    this.listenOrigin = origin;
  }

  private static clientId = '1540547099156947054'; // User's SoSo Music Discord Application ID
  private static socket: net.Socket | null = null;
  private static isConnected = false;
  private static isConnecting = false;
  private static isEnabled = true;
  private static lastActivity: DiscordPlaybackData | null = null;
  private static reconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize and connect to local Discord client IPC
   */
  static init() {
    this.connect();
  }

  static connect() {
    if (this.isConnected || this.isConnecting || !this.isEnabled) return;
    this.isConnecting = true;
    this.tryConnectPipe(0);
  }

  private static getPipePath(pipeIndex: number): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\discord-ipc-${pipeIndex}`;
    }
    const prefix =
      process.env.XDG_RUNTIME_DIR ||
      process.env.TMPDIR ||
      process.env.TMP ||
      process.env.TEMP ||
      '/tmp';
    return `${prefix.replace(/\/$/, '')}/discord-ipc-${pipeIndex}`;
  }

  private static tryConnectPipe(pipeIndex: number) {
    if (!this.isEnabled) {
      this.isConnecting = false;
      return;
    }

    if (pipeIndex >= 10) {
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    const pipePath = this.getPipePath(pipeIndex);
    let sock: net.Socket | null = null;

    try {
      sock = net.createConnection(pipePath);
    } catch (e) {
      this.tryConnectPipe(pipeIndex + 1);
      return;
    }

    sock.once('connect', () => {
      this.isConnecting = false;
      this.socket = sock;
      this.sendHandshake();
    });

    let buffer: any = Buffer.alloc(0);

    sock.on('data', (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);
        const { packets, remaining } = DiscordRPCService.parseFramedPackets(buffer);
        buffer = remaining;
        for (const packet of packets) {
          const body = packet.data;
          if (body.cmd === 'SET_ACTIVITY' && body.evt === 'ERROR') {
            console.warn('[DiscordRPC] Activity rejected:', body.data?.code, body.data?.message);
          }
          if (body.cmd === 'DISPATCH' && body.evt === 'READY') {
            this.isConnected = true;
            if (this.lastActivity) {
              this.sendActivityToDiscord(this.lastActivity);
            }
          }
        }
      } catch (e) {
        console.warn('[DiscordRPC] IPC parse error:', e);
      }
    });

    let isSocketHandled = false;

    sock.once('error', () => {
      if (isSocketHandled) return;
      isSocketHandled = true;
      const wasCurrentSocket = this.socket === sock;
      if (wasCurrentSocket) {
        this.cleanup();
      }
      try {
        sock?.destroy();
      } catch {}
      if (wasCurrentSocket) {
        this.scheduleReconnect();
      } else {
        // Try next pipe
        this.tryConnectPipe(pipeIndex + 1);
      }
    });

    sock.once('close', () => {
      if (isSocketHandled) return;
      isSocketHandled = true;
      if (this.socket === sock) {
        this.cleanup();
        this.scheduleReconnect();
      }
    });
  }

  private static scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isEnabled && !this.isConnected) {
        this.connect();
      }
    }, 8000);
  }

  private static cleanup() {
    this.isConnected = false;
    this.isConnecting = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (e) {}
      this.socket = null;
    }
  }

  private static sendHandshake() {
    if (!this.socket) return;
    try {
      const payload = Buffer.from(JSON.stringify({ v: 1, client_id: this.clientId }));
      const packet = Buffer.alloc(8 + payload.length);
      packet.writeInt32LE(0, 0); // Opcode 0 = Handshake
      packet.writeInt32LE(payload.length, 4);
      payload.copy(packet, 8);
      this.socket.write(packet);
    } catch (e) {
      this.cleanup();
    }
  }

  /**
   * Public API to update Discord Rich Presence
   */
  static updateActivity(data: DiscordPlaybackData) {
    this.lastActivity = data;
    if (!this.isEnabled) return;

    if (!this.isConnected) {
      this.connect();
      return;
    }

    this.sendActivityToDiscord(data);
  }

  public static formatDiscordTime(secs: number): string {
    if (!secs || isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  public static renderProgressBar(current: number, total: number): string {
    const barLength = 10;
    const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
    const dotIndex = Math.min(barLength, Math.round(ratio * barLength));
    const before = '━'.repeat(dotIndex);
    const after = '─'.repeat(barLength - dotIndex);
    return `${before}🔘${after}`;
  }

  public static buildActivityPayload(data: DiscordPlaybackData, now: number = Date.now()): any {
    const currentPos = data.currentTime || 0;
    const totalDur = data.duration || 180;

    const artistStr = data.artist
      ? data.artist.length > 80
        ? data.artist.substring(0, 80)
        : data.artist
      : 'SoSo Music';
    const titleStr = data.title
      ? data.title.length > 80
        ? data.title.substring(0, 80)
        : data.title
      : 'Трек';

    const activity: any = {
      details: `${titleStr} (${DiscordRPCService.formatDiscordTime(currentPos)} / ${DiscordRPCService.formatDiscordTime(totalDur)})`,
      state: data.isPlaying
        ? `${artistStr}  ·  ${DiscordRPCService.renderProgressBar(currentPos, totalDur)}`
        : `${artistStr}  ·  ⏸ Пауза`,
      assets: {
        large_image:
          data.coverUrl && data.coverUrl.startsWith('http')
            ? data.coverUrl
            : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500',
        large_text: data.album ? data.album : 'SoSo Music Desktop',
        small_image: data.isPlaying
          ? 'https://cdn-icons-png.flaticon.com/512/0/375.png'
          : 'https://cdn-icons-png.flaticon.com/512/16/16427.png',
        small_text: data.isPlaying ? 'Воспроизводится' : 'Пауза',
      },
    };

    const listenUrl = DiscordRPCService.directListenEnabled
      ? buildSoSoListenUrl(data)
      : DiscordRPCService.listenOrigin
        ? buildLocalListenUrl(data, DiscordRPCService.listenOrigin)
        : null;
    if (listenUrl) activity.buttons = [{ label: 'Слушать в SoSo Music', url: listenUrl }];

    if (data.isPlaying && totalDur > 0) {
      const startTs = Math.round(now - currentPos * 1000);
      const endTs = Math.round(startTs + totalDur * 1000);
      activity.timestamps = {
        start: startTs,
        end: endTs,
      };
    }

    return activity;
  }

  private static sendActivityToDiscord(data: DiscordPlaybackData) {
    if (!this.socket || !this.isConnected) return;

    try {
      const activity = this.buildActivityPayload(data);
      const body = {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity,
        },
        nonce: Math.random().toString(36).substring(7),
      };

      const payload = Buffer.from(JSON.stringify(body));
      const packet = Buffer.alloc(8 + payload.length);
      packet.writeInt32LE(1, 0); // Opcode 1 = Frame
      packet.writeInt32LE(payload.length, 4);
      payload.copy(packet, 8);
      this.socket.write(packet);
    } catch (e) {
      console.warn('Failed to send Discord RPC activity:', e);
      this.cleanup();
    }
  }

  /**
   * Clear Discord Activity
   */
  static clearActivity() {
    this.lastActivity = null;
    if (!this.socket || !this.isConnected) return;

    try {
      const body = {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity: null,
        },
        nonce: Math.random().toString(36).substring(7),
      };

      const payload = Buffer.from(JSON.stringify(body));
      const packet = Buffer.alloc(8 + payload.length);
      packet.writeInt32LE(1, 0);
      packet.writeInt32LE(payload.length, 4);
      payload.copy(packet, 8);
      this.socket.write(packet);
    } catch (e) {
      this.cleanup();
    }
  }

  /**
   * Toggle Discord RPC on/off
   */
  static setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.clearActivity();
      this.cleanup();
    } else {
      this.connect();
      if (this.lastActivity) {
        this.updateActivity(this.lastActivity);
      }
    }
  }

  /**
   * Parse 8-byte framed IPC packets from Discord IPC socket stream
   */
  public static parseFramedPackets(buffer: Buffer): {
    packets: Array<{ op: number; data: any }>;
    remaining: any;
  } {
    const packets: Array<{ op: number; data: any }> = [];
    let buf = buffer;
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      const bodyBuf = buf.subarray(8, 8 + len);
      buf = buf.subarray(8 + len);
      try {
        packets.push({ op, data: JSON.parse(bodyBuf.toString('utf-8')) });
      } catch (e) {
        console.warn('[DiscordRPC] IPC payload parse error:', e);
      }
    }
    return { packets, remaining: buf };
  }
}
