# ShadowVote — Architecture

This document explains the design decisions that make ShadowVote a real system rather than a toy, and the reasoning behind each.

## 1. Event sourcing as the source of truth

The authoritative state of a game is **not** a mutable row that gets updated. It is a fold over an append-only log of events (`events` table, ordered by a unique `(game_id, seq)`).

```
state(n) = reduce(applyEvent, initialState, events[0..n])
```

**Why:**
- **Crash recovery / resume.** If the server dies mid-game, the next process rebuilds exact state by replaying events. No lost games.
- **Determinism.** Combined with a seeded RNG (`seededShuffle`), a game with the same seed + events replays identically — invaluable for debugging and testing.
- **Auditability & replay.** A "replay/debug view" (P4) is free: just step through events.

Projections (`games`, `players`, `votes`, `agent_memories`) are materialized views that can always be rebuilt from the log.

## 2. The game as an explicit state machine

Phases and their **legal** transitions live in `packages/shared/src/game.ts`:

```
LOBBY → NIGHT → DAY_DISCUSSION → DAY_VOTE → RESOLVE → (NIGHT | GAME_OVER)
```

`canTransition` / `assertTransition` are the guard rails: the engine may only advance along declared edges. This turns "what phase are we in and what's allowed" from scattered `if` checks into one auditable table, and makes illegal-transition bugs impossible to write silently.

## 3. Shared types = one contract

`@shadowvote/shared` is imported by both the server and the web client. Roles, phases, the event union, and the **WebSocket message protocol** (`ClientMessage` / `ServerMessage`) are defined once. A protocol change is a compile error on both sides — the client and server can never silently drift.

The pure game rules (role dealing, seeded shuffle, phase guards, win evaluation) also live here so they are unit-tested in isolation, with no server or DB required.

## 4. Real-time transport

Fastify serves HTTP (`/health`, future REST) while a `ws` `WebSocketServer` handles the `/ws` upgrade directly off the underlying HTTP server. This avoids coupling to a specific `@fastify/websocket` major version and keeps the socket layer explicit.

The `RoomRegistry` tracks live sockets per game for broadcast fan-out. From P1 the *authoritative* state comes from the event store; the registry only knows who is connected, so a reconnecting player (`RESYNC`) is served fresh state without the socket ever being the source of truth.

## 5. Agent orchestration

Each AI player is an `Agent` (`packages/server/src/agents/agent.ts`). The `GeminiAgent`:
- Uses **structured output** (a JSON response schema) so the model must return `{ speech, reasoning, targetId }` — parseable, persistable, and actionable.
- Separates **public speech** from **hidden reasoning**. Reasoning is streamed to the client's inspector and stored in `agent_memories`; opponents never see it.
- **Validates targets** against the legal candidate set, so a hallucinated id becomes an abstention rather than a crash.

From P2, an orchestrator runs agent turns **off the request path** in a turn scheduler, retrieving each agent's memories + the public transcript to build its prompt, then emitting the decision as game events.

## 6. Concurrency & correctness (P1/P4)

- **Vote resolution** is computed atomically from the `votes` projection with a unique `(game_id, round, voter_id)` index — one vote per player per round, no double-counting under concurrent submits.
- **Reconnection** replays state on `RESYNC`; the socket carries no authoritative state.
- **Idempotency**: events are appended with a monotonic `seq`; duplicate/replayed commands are rejected by the unique index.

## 7. Testing strategy

- **Unit** (now): pure game rules — transitions, win conditions, role dealing, deterministic shuffle.
- **Integration** (P4): drive the engine through a scripted game via events and assert final state; a full game is reproducible from a seed.

## Package boundaries

| Package | Responsibility | Depends on |
|---|---|---|
| `shared` | Types + pure rules. No I/O. | — |
| `server` | Transport, engine, persistence, agents. | `shared` |
| `web` | Rendering + user input. No game logic. | `shared` |

Keeping game rules out of `web` and I/O out of `shared` is what lets the rules be tested in isolation and the client stay a thin renderer.
