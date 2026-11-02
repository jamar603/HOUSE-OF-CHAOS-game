# HOUSE OF CHAOS

Top-down 2D multiplayer survival game in the browser. Four roommates are locked in one big house.
They prepare their bedroom, fight with household objects, then the last one standing wins.

**Current version: 0.1** (offline mode, you plus 3 bots).

## Running the game

You need Node.js 18 or later.

```bash
npm install        # once
npm run dev        # dev server at http://localhost:5173
```

Other commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check, then build the production bundle into `dist/` |
| `npm run preview` | Serve the build at http://localhost:4173 |
| `npm test` | Simulation tests (map, collisions, combat, revive, full bot matches) |
| `npm run typecheck` | TypeScript check only |

Debug URLs: `?autostart=1` skips the menu. `?autostart=1&prep=0` starts directly in the chaos phase.

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
src/
  shared/                  No DOM dependency: runs in the browser AND later on a Node server
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
    audio/                 Synthesized sounds (Web Audio)
tests/                     Vitest
```

Design principles:

- **Authoritative simulation.** Players, including bots, only send a `PlayerInput`
  (movement, aim, attack, interact, drop). Movement, collisions, damage, items,
  downed players, revives, eliminations and the clock are all computed by `GameSimulation`.
  Inputs are sanitized there. This is the code that will run on the server in version 0.3.
- **Deterministic.** Seeded randomness and a fixed time step, so tests are reproducible.
- **Procedural art.** No image assets yet. Everything is drawn in Canvas 2D, and the house
  is pre-rendered once per match.

## Roadmap

- 0.2: multi-slot inventory, movable furniture, traps, door barricades
- 0.3: Node.js WebSocket server (authoritative, reusing `src/shared`), lobby, invite code, 4 players, disconnections
- 0.4: random events (power cut, fire, alarm, locked doors, basement opening, rare items, water leak), lighting, sounds
- 1.0: progression, statistics, leaderboard, character customization, team mode
