import { defineConfig } from 'vite';

const GAME_SERVER = process.env.GAME_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    // The client always connects to /ws on its own origin; in dev Vite forwards it to the game server.
    proxy: { '/ws': { target: GAME_SERVER, ws: true } },
  },
  build: { outDir: 'dist', target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
} as Parameters<typeof defineConfig>[0]);
