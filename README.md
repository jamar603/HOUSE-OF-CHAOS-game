# HOUSE OF CHAOS

Top-down 2D multiplayer survival game in the browser. Four roommates are locked in one big house.
They prepare their bedroom, fight with household objects, then the last one standing wins.

**Current version: 0.3**: online multiplayer with up to 4 players (lobby, invite code, Ready button, reconnection), and offline mode against 3 bots.

## Running the game

You need Node.js 18 or later.

```bash
npm install        # once
npm run dev        # game server (port 8080) + client (http://localhost:5173)
```

Open http://localhost:5173. Choose **Create a game**, then share the code or the link.

### Playing with friends

- **Same Wi-Fi / local network**: `npm run dev` exposes the client on the network. Friends open
  `http://<your-local-ip>:5173`; the address is printed in the terminal (`Network: http://192.168.x.x:5173`).
  Windows may ask you to allow Node.js through the firewall: accept it for private networks.
- **Over the internet**: deploy the project to a Node host (Render, Railway, Fly.io…) with
  `npm install && npm run build` as the build command and `npm start` as the start command.
  A single process serves the game and the WebSocket on the `PORT` port.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Game server (auto-restarts) + Vite client |
| `npm run server` | Game server only (port 8080) |
| `npm run build` | Type-check + production client build into `dist/` |
| `npm start` | Production: serves `dist/` + the WebSocket on `PORT` (default 8080) |
| `npm test` | Tests: map, collisions, combat, revive, bot matches, network server |
| `npm run typecheck` | TypeScript check only |

Debug URLs: `?autostart=1` (offline game without the menu), `?autostart=1&prep=0` (straight to chaos),
`?room=CODE` (pre-fills the invite code).

## Controls

| Key | Action |
| --- | --- |
| ZQSD / WASD / arrow keys | Move (physical keys, so AZERTY and QWERTY both work) |
| Mouse | Aim |
| Left click / Space | Attack |
| E (tap) | Pick up or swap an object |
| E (hold) | Revive a downed player (5 s) |
| G / right click | Drop the object, or place a table as a barricade |
| Mouse wheel | Zoom |
| Esc | Pause |
| M | Mute sound |

## Rules (v0.1)

- **Preparation** (1, 3 or 15 min): nobody takes damage, and other players' bedrooms are closed.
- **Chaos**: everything is allowed. Barricades can be destroyed.
- At 0 HP a player is downed for 30 s. Anyone can revive them in 5 s, and they come back with 35 HP.
  Hits on a downed player take 4 s off their timer.
- Objects wear out and break. Each bedroom has a secret passage (a cracked wall).

| Object | Damage | Reach | Cooldown | Durability | Special |
| --- | --- | --- | --- | --- | --- |
| Chair | 17 | 38 | 0.8 s | 9 | strong knockback |
| Bottle | 9 | 28 | 0.32 s | 6 | +12 damage on the hit that breaks it |
| Pan | 28 | 34 | 1.15 s | 14 | stuns for 0.45 s |
| Broom | 9 | 62 | 0.65 s | 10 | longest reach, pushes far |
| Pillow | 2 | 36 | 0.55 s | 16 | stuns for 1.3 s (with immunity afterwards) |
| Table | 22 | 36 | 1.4 s | 7 | slows you down, can be placed as a barricade |

## Architecture

```
server/                    Node.js server (ws): gameServer.ts, RoomManager.ts, Room.ts
src/
  shared/                  No DOM dependency: runs in the browser AND on the server
    network/               Protocol (validated messages) and compact snapshots
    constants.ts           Gameplay constants, characters
    types.ts               State, inputs, events
    math.ts                Geometry, seeded random
    house/                 Map data (houseMap.ts) and the house itself (houseLayout.ts)
    items/                 Object definitions (weapons)
    simulation/            GameSimulation (authoritative), collisions
    bots/                  BotController (AI), A* pathfinding
  client/
    App.ts                 Game loop at fixed 60 Hz, menus, events, sounds
    render/                Canvas 2D: house, characters, items, effects, camera
    ui/                    HUD and screens (DOM)
    input/                 Keyboard and mouse (a touch controller can come later)
    network/               WebSocket client with automatic reconnection
    audio/                 Synthesized sounds (Web Audio)
tests/                     Vitest
```

Design principles:

- **Authoritative simulation.** Players, including bots, only send a `PlayerInput`
  (movement, aim, attack, interact, drop). Movement, collisions, damage, items,
  downed players, revives, eliminations and the clock are all computed by `GameSimulation`.
  Inputs are sanitized there. Online, this exact code runs on the server at 60 Hz:
  clients send their inputs (30/s) and receive snapshots (20/s) that they interpolate.
- **Network.** Every message is validated (`parseClientMessage`), and the server rate-limits
  each client and caps message size. A disconnected player is replaced by a bot and takes
  their character back on reconnection, since the session is kept in `sessionStorage`.
- **Deterministic.** Seeded randomness and a fixed time step, so tests are reproducible.
- **Procedural art.** No image assets yet. Everything is drawn in Canvas 2D, and the house
  is pre-rendered once per match.

## Roadmap

- 0.2: multi-slot inventory, movable furniture, traps, door barricades
- ~~0.3: online multiplayer~~ ✅
- 0.4: random events (power cut, fire, alarm, locked doors, basement opening, rare items, water leak), lighting, sounds
- 1.0: progression, statistics, leaderboard, character customization, team mode
