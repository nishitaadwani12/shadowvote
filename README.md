# 🐺 ShadowVote

**A social-deduction game (Werewolf/Mafia) where you play alongside LLM agents that reason, remember, and deceive.** Watch AI players accuse, defend, and bluff their way through the night — then flip on the reasoning inspector to see the hidden strategy behind every move.

[![CI](https://github.com/nishitaadwani12/shadowvote/actions/workflows/ci.yml/badge.svg)](https://github.com/nishitaadwani12/shadowvote/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

> Not another RAG chatbot. ShadowVote is a **real-time, multi-agent, event-sourced game engine** — the hard parts of distributed systems (concurrency, state machines, crash recovery) meet agentic AI.

---

## Why it's interesting

- **Multi-agent AI that lies.** Each AI player has a secret role, a persona, and persistent memory. They reason privately (chain-of-thought), speak publicly, and vote strategically — powered by Gemini structured output.
- **Event-sourced game state.** Every action is an immutable event; the authoritative game state is a fold over an append-only log. Kill the server mid-game, restart, and the game **replays to exactly where it was**.
- **Explicit state machine.** Phases (`LOBBY → NIGHT → DAY_DISCUSSION → DAY_VOTE → RESOLVE → …`) with guarded transitions — no ad-hoc mutation.
- **Real-time & concurrent.** WebSocket gateway with room fan-out, reconnection/resync, and race-safe vote resolution.
- **The reasoning inspector.** A toggle reveals each agent's hidden reasoning next to what it said out loud — the demo moment.

## Architecture

```
 packages/web (React + Vite)            packages/server (Node + Fastify + ws)
 ┌───────────────────────────┐  WS  ┌──────────────────────────────────────┐
 │  lobby · table talk        │◀───▶│  WS gateway (rooms, reconnect)         │
 │  vote panel                │      │  game engine = event-sourced state    │
 │  🧠 reasoning inspector     │      │      machine (guarded transitions)     │
 └───────────────────────────┘      │  agent orchestrator (turn scheduler)   │
             ▲                        │  Gemini client (persona + memory)      │
             │  shared TS types       └───────────────────┬────────────────────┘
             ▼                                             ▼
 packages/shared  ── one source of truth ──▶      Postgres (Neon) — event store
 (roles, phases, events, WS protocol,               + projections
  role dealing, win rules)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the deep design.

## Tech stack (all free tiers — $0 to run)

| Layer | Choice | Hosting |
|---|---|---|
| Frontend | React + TypeScript + Vite | Vercel (free) |
| Backend | Node + Fastify + `ws` | Fly.io / Render (free) |
| DB / ORM | Postgres + Drizzle (event store) | Neon (free) |
| AI | Google Gemini `gemini-2.0-flash` | Gemini API free tier |
| Shared | Strict TS types shared across web + server | — |

## Quickstart

```bash
npm install                     # install all workspaces
cp .env.example .env            # DB + Gemini optional for P0
npm run dev:server              # WS gateway on :8080  (GET /health)
npm run dev:web                 # client on :5173
```

Open two browser tabs on `http://localhost:5173`, join the same room, and chat in real time.

```bash
npm run typecheck               # strict type-check every package
npm test                        # game-rule unit tests
npm run build                   # production web build
npm run db:generate             # regenerate SQL migrations from schema
npm run db:migrate              # apply migrations (needs DATABASE_URL)
```

## Project layout

```
packages/
  shared/   domain types + pure game rules (roles, phases, win conditions) + tests
  server/   Fastify + WebSocket gateway, event-sourced engine, Drizzle schema, Gemini agent
  web/       React client — lobby, chat, reasoning inspector
```

## Testing

Tests are written **alongside each feature, phase by phase** — never deferred to the end. Every phase ships with the unit tests that cover its new logic, so `npm test` stays green as the game engine grows and regressions surface immediately.

```bash
npm test                        # runs every workspace's tests
```

Current coverage (14 tests):

| Area | What's covered |
|---|---|
| `shared` — game rules | phase-transition guards, win-condition evaluation |
| `shared` — role logic | balanced role deck, `<4` guard, deterministic seeded shuffle |
| `server` — room registry | join/leave, chat recording, rejecting unknown players, broadcast to open-only sockets, empty-room cleanup |

Pure game rules live in `shared` with **no I/O**, so they're tested in isolation without a server or database. As P1+ add the event store and state machine, their tests land in the same commit as the code.

## Roadmap

- [x] **P0** — Monorepo, shared types, WS gateway + lobby/chat, DB schema + migration, CI, unit tests (14)
- [ ] **P1** — Event store + state machine; full human game loop (night → vote → resolve → win)
- [ ] **P2** — Gemini agents take turns with persistent memory + reasoning stream
- [ ] **P3** — Full multi-agent games, reasoning inspector UI, seer/doctor abilities
- [ ] **P4** — Reconnect/resync hardening, replay/debug view, integration tests, deploy

## License

MIT © Nishita Adwani
