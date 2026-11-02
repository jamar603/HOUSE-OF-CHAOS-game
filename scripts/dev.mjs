// Starts the game server (auto-restart on change) and the Vite client together.
import { spawn } from 'node:child_process';

const processes = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite', '--host'], { stdio: 'inherit', shell: true }),
];

const stopAll = () => {
  for (const child of processes) child.kill();
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
for (const child of processes) child.on('exit', (code) => code && code !== 0 && stopAll());
