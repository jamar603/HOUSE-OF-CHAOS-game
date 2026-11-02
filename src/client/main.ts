import { App } from './App';

const canvas = document.getElementById('game-canvas');
const hudRoot = document.getElementById('hud-root');
const screenRoot = document.getElementById('screen-root');

if (!(canvas instanceof HTMLCanvasElement) || !hudRoot || !screenRoot) {
  throw new Error('index.html est incomplet : #game-canvas, #hud-root et #screen-root sont requis.');
}

const app = new App(canvas, hudRoot, screenRoot);
app.start();
(window as unknown as { houseOfChaos: App }).houseOfChaos = app;
