/**
 * HOUSE OF CHAOS game server (reusable: used by index.ts and by the tests).
 *
 * - WebSocket endpoint on /ws: lobbies + authoritative matches (60 Hz, snapshots 20 Hz).
 * - In production it also serves the built client from ./dist, so a single
 *   process and a single port are enough to host the game.
 *
 * Usage: `npm run server` (dev, port 8080) or `npm start` after `npm run build`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  WEBSOCKET_PATH,
  type ServerMessage,
} from '../src/shared/network/protocol';
import { RoomManager, type ClientSession } from './RoomManager';

const TICK_SECONDS = 1 / 60;
const MAX_MESSAGES_PER_SECOND = 120;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

export interface GameServerOptions {
  port: number;
  distDir?: string;
  log?: boolean;
}

export interface RunningGameServer {
  port: number;
  manager: RoomManager;
  close(): Promise<void>;
}

export function startGameServer(options: GameServerOptions): Promise<RunningGameServer> {
  const DIST_DIR = options.distDir ?? resolve(process.cwd(), 'dist');
  const manager = new RoomManager();
  function serveStatic(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: manager.rooms.size }));
      return;
    }
    if (!existsSync(DIST_DIR)) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Serveur de jeu HOUSE OF CHAOS actif. En développement, ouvrez le client Vite (npm run dev).');
      return;
    }
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let filePath = join(DIST_DIR, requested);
    if (!filePath.startsWith(DIST_DIR)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(DIST_DIR, 'index.html');
    response.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  }

  const httpServer = createServer(serveStatic);
  const wss = new WebSocketServer({ server: httpServer, path: WEBSOCKET_PATH, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (socket: WebSocket) => {
    let messagesThisSecond = 0;
    let windowStart = Date.now();
    const session: ClientSession = {
      sessionId: '',
      helloDone: false,
      send(message: ServerMessage) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };

    socket.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        messagesThisSecond = 0;
      }
      if (++messagesThisSecond > MAX_MESSAGES_PER_SECOND) {
        socket.close(1008, 'Trop de messages');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        session.send({ type: 'error', message: 'Message illisible.' });
        return;
      }
      const message = parseClientMessage(raw);
      if (!message) {
        session.send({ type: 'error', message: 'Message invalide.' });
        return;
      }
      if (!session.helloDone) {
        if (message.type !== 'hello') {
          session.send({ type: 'error', message: 'Dites bonjour d’abord (hello).' });
          return;
        }
        session.helloDone = true;
        session.sessionId = message.sessionId ?? RoomManager.createSessionId();
        const resumed = message.sessionId !== null && manager.resume(session);
        if (!resumed && message.sessionId !== null) {
          // Unknown session: issue a fresh one so ids cannot be guessed into other rooms.
          session.sessionId = RoomManager.createSessionId();
        }
        session.send({ type: 'welcome', sessionId: session.sessionId, resumed });
        return;
      }
      manager.handle(session, message);
    });

    socket.on('close', () => {
      if (session.helloDone) manager.disconnect(session);
    });
  });

  // Fixed-step game loop, catching up if the timer fires late.
  let previous = performance.now();
  let accumulator = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(0.25, (now - previous) / 1000);
    previous = now;
    while (accumulator >= TICK_SECONDS) {
      manager.tick(TICK_SECONDS);
      accumulator -= TICK_SECONDS;
    }
  }, 1000 / 120);
  const cleanupTimer = setInterval(() => manager.cleanup(), 5000);

  const intervals = [loop, cleanupTimer];
  return new Promise((resolvePromise) => {
    httpServer.listen(options.port, '0.0.0.0', () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      if (options.log !== false) {
        const addresses = Object.values(networkInterfaces())
          .flat()
          .filter((info) => info && info.family === 'IPv4' && !info.internal)
          .map((info) => info?.address);
        console.log(`HOUSE OF CHAOS · serveur prêt sur le port ${port}`);
        console.log(`  WebSocket : ws://localhost:${port}${WEBSOCKET_PATH}`);
        for (const ip of addresses) console.log(`  Réseau local : http://${ip}:${port}`);
      }
      resolvePromise({
        port,
        manager,
        close: () =>
          new Promise<void>((done) => {
            intervals.forEach((timer) => clearInterval(timer));
            for (const client of wss.clients) client.terminate();
            wss.close();
            httpServer.close(() => done());
          }),
      });
    });
  });
}
