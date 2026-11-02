/**
 * Entry point: `npm run server` (dev) or `npm start` (production, serves ./dist too).
 * PORT defaults to 8080.
 */
import { startGameServer } from './gameServer';

void startGameServer({ port: Number(process.env.PORT ?? 8080) });
