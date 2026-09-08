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

Current coverage (43 tests):

| Area | What's covered |
|---|---|
| `shared` — game rules | phase-transition guards, win-condition evaluation |
| `shared` — role logic | balanced role deck, `<4` guard, deterministic seeded shuffle |
| `shared` — engine | reducer, `viewFor` role-hiding + seer notes, pre-game identity |
| `shared` — flow | full deterministic games (village & werewolf wins), doctor save, role validation, **log replay ⇒ identical state** |
| `server` — engine | command routing, role dealing, chat recording, invalid-command errors |
| `server` — connections | attach/detach, socket lookup, empty-game cleanup |
| `server` — orchestrator | **all-AI game plays itself to a winner**, lobby/game-over no-ops, reasoning + memory recorded |
| `server` — heuristic agent | targets first candidate, speaks only in discussion, abstains with no targets, never targets an ally |
| `shared` — werewolf allies | `viewFor` reveals the pack to werewolves, hides it from villagers |
| `server` — event store | append/order events, isolated snapshots |
| `server` — crash recovery | a restarted engine `hydrate`s to identical state from the log |
| `server` — integration (real WS) | **full human + AI game to a winner**, reconnect via REJOIN, unknown-seat rejection |

Pure game rules live in `shared` with **no I/O**, so they're tested in isolation without a server or database. As P1+ add the event store and state machine, their tests land in the same commit as the code.

## Roadmap

- [x] **P0** — Monorepo, shared types, WS gateway + lobby/chat, DB schema + migration, CI, unit tests
- [x] **P1** — Event-sourced engine + state machine; full human game loop (start → night → vote → resolve → win) playable in the UI
- [x] **P2** — AI players (Gemini, with heuristic fallback) take turns off the request path with persistent memory; reasoning streamed to the inspector; add AI players from the lobby
- [x] **P3** — Faction-aware agents (werewolf pack coordination) + role-strategy prompting; role objectives, night/spectator status, and a round-grouped reasoning inspector in the UI
- [x] **P4** — Durable Postgres event store + crash-recovery hydration; reconnect/resync (REJOIN + client auto-reconnect); integration tests over a real WebSocket; Docker + Fly.io deploy config

## Deploy (all free tiers)

**Database** — create a free Postgres on [Neon](https://neon.tech), then apply the schema:
```bash
DATABASE_URL="postgres://…" npm run db:migrate
```

**Server** — [Fly.io](https://fly.io) (config in `fly.toml`, Dockerfile in `packages/server/`):
```bash
fly launch --no-deploy          # once
fly secrets set DATABASE_URL="postgres://…" GEMINI_API_KEY="…"
fly deploy
```
Without `DATABASE_URL` the server runs with an in-memory store; without `GEMINI_API_KEY` AI players use the heuristic agent — so it runs anywhere with zero config.

**Web** — [Vercel](https://vercel.com): set the project root to `packages/web` and the env var `VITE_WS_URL` to your server's `wss://…/ws`.

## License

MIT © Nishita Adwani
