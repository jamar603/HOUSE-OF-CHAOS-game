/**
 * WebSocket connection to the game server, with automatic reconnection.
 * The session id is kept in sessionStorage so a refresh or a network drop
 * puts the player back in their room (and back in control of their character).
 */
import {
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  type ClientMessage,
  type ServerMessage,
} from '../../shared/network/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const SESSION_KEY = 'house-of-chaos.session';
const MAX_RECONNECT_ATTEMPTS = 8;

function readSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(sessionId: string | null): void {
  try {
    if (sessionId) window.sessionStorage.setItem(SESSION_KEY, sessionId);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage, reconnection after a page refresh is simply not possible.
  }
}

export function defaultServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WEBSOCKET_PATH}`;
}

export class NetworkClient {
  onMessage: (message: ServerMessage) => void = () => undefined;
  onStatus: (status: ConnectionStatus) => void = () => undefined;
  pingMs: number | null = null;

  private socket: WebSocket | null = null;
  private sessionId: string | null = readSession();
  private wanted = false;
  private attempts = 0;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private readyResolvers: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private welcomed = false;

  constructor(private readonly url: string = defaultServerUrl()) {}

  get isReady(): boolean {
    return this.welcomed && this.socket?.readyState === WebSocket.OPEN;
  }

  /** Opens the connection and resolves once the server said welcome. */
  connect(): Promise<void> {
    this.wanted = true;
    if (this.isReady) return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => this.readyResolvers.push({ resolve, reject }));
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) this.open();
    return promise;
  }

  private open(): void {
    this.welcomed = false;
    this.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, sessionId: this.sessionId } satisfies ClientMessage));
    });
    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        this.welcomed = true;
        this.attempts = 0;
        this.sessionId = message.sessionId;
        writeSession(message.sessionId);
        this.onStatus('open');
        this.startPing();
        this.readyResolvers.splice(0).forEach(({ resolve }) => resolve());
      }
      if (message.type === 'pong') this.pingMs = Math.round(performance.now() - message.sentAt);
      this.onMessage(message);
    });
    socket.addEventListener('close', () => {
      window.clearInterval(this.pingTimer);
      if (this.socket !== socket) return;
      this.welcomed = false;
      if (!this.wanted) {
        this.onStatus('closed');
        return;
      }
      if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
        this.wanted = false;
        this.onStatus('closed');
        this.readyResolvers.splice(0).forEach(({ reject }) => reject(new Error('Serveur injoignable.')));
        return;
      }
      this.attempts++;
      this.onStatus('reconnecting');
      const delay = Math.min(4000, 400 * 2 ** (this.attempts - 1));
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    });
  }

  private startPing(): void {
    window.clearInterval(this.pingTimer);
    const ping = (): void => this.send({ type: 'ping', sentAt: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN && (this.welcomed || message.type === 'hello')) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Closes on purpose (the player left online play). */
  close(): void {
    this.wanted = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
    this.welcomed = false;
  }

  /** Forget the session so the next connection starts fresh (after leaving a room). */
  forgetSession(): void {
    this.sessionId = null;
    writeSession(null);
  }
}
