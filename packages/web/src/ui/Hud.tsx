import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { pickAiName, type GameStateView } from '@shadowvote/shared';
import type { GameSocket, ReasoningEntry } from '../lib/ws';

interface Props {
  sock: GameSocket;
  you: GameStateView['you'];
  phase: string;
  actionHint: string | null;
  /** Present while the player may vote; casts an abstain. */
  onSkipVote: (() => void) | null;
  objective: string | null;
  personas: string[];
  room: string;
  setRoom: (room: string) => void;
  onPlayAgain: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'Lobby',
  NIGHT: '🌙 Night',
  DAY_DISCUSSION: '☀️ Day · Discussion',
  DAY_VOTE: '🗳️ Day · Vote',
  GAME_OVER: 'Game Over',
};

function groupByRound(entries: ReasoningEntry[]): [number, ReasoningEntry[]][] {
  const byRound = new Map<number, ReasoningEntry[]>();
  for (const e of entries) byRound.set(e.round, [...(byRound.get(e.round) ?? []), e]);
  return [...byRound.entries()].sort((a, b) => b[0] - a[0]);
}

export function Hud({ sock, you, phase, actionHint, onSkipVote, objective, personas, room, setRoom, onPlayAgain }: Props) {
  const { status, state, chat, reasoning, error, playerId, join, addAi, start, sendChat } = sock;
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const joined = playerId !== null;
  const playerCount = state?.players.length ?? 0;

  function addAiPlayer() {
    // Natural names (not "AI-1") so the agents can't tell which seat is the human.
    const taken = state?.players.map((p) => p.name) ?? [];
    addAi(pickAiName(taken), personas[Math.floor(Math.random() * personas.length)]!);
  }

  return (
    <div className="hud">
      <header className="hud-top">
        <div className="brand">
          🐺 <span>ShadowVote</span>
        </div>
        <span className={`status status--${status}`}>{status}</span>
      </header>

      <AnimatePresence>
        {error && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {!joined ? (
        <motion.div
          className="panel lobby-card"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        >
          <h2>Enter the village</h2>
          <p className="tagline">Hidden roles, bluffing, and AI players who reason, remember, and lie.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) join(room.trim(), name.trim());
            }}
          >
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
            <button type="submit" disabled={status !== 'open' || !name.trim()}>
              Join table
            </button>
          </form>
        </motion.div>
      ) : (
        <>
          <div className="phase-hud">
            <AnimatePresence mode="wait">
              <motion.span
                key={phase}
                className={`phase-pill phase--${phase}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
              >
                {PHASE_LABEL[phase] ?? phase}
              </motion.span>
            </AnimatePresence>
            {state && state.round > 0 && <span className="round">round {state.round}</span>}
            {you?.role && <span className="role-chip">{you.role}</span>}
          </div>

          {you?.role && objective && <p className="objective">{objective}</p>}

          <div className="center-stage">
            <AnimatePresence mode="wait">
              {state?.winner ? (
                <motion.div
                  key="winner"
                  className="winner-stack"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 18 }}
                >
                  <div className="winner-banner">🏆 {state.winner} wins</div>
                  <button onClick={onPlayAgain}>Play again</button>
                </motion.div>
              ) : phase === 'LOBBY' ? (
                <motion.div key="controls" className="controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <button className="secondary" onClick={addAiPlayer}>
                    + Add AI player
                  </button>
                  <button onClick={start} disabled={playerCount < 4}>
                    Start game ({playerCount}/4+)
                  </button>
                </motion.div>
              ) : actionHint ? (
                <motion.div key={actionHint} className="controls" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="action-hint">{actionHint}</div>
                  {onSkipVote && (
                    <button className="secondary" onClick={onSkipVote}>
                      Skip vote
                    </button>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {(state?.notes.length ?? 0) > 0 && (
            <div className="panel notes-panel">
              <h3>Private intel</h3>
              {state?.notes.map((note, i) => (
                <p key={i}>{note}</p>
              ))}
            </div>
          )}

          <div className="panel chat-panel">
            <h3>Table talk</h3>
            <div className="log">
              {chat.map((line, i) => (
                <p key={i}>
                  <strong>{line.name}:</strong> {line.text}
                </p>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) {
                  sendChat(draft.trim());
                  setDraft('');
                }
              }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say something…" />
              <button type="submit">Send</button>
            </form>
          </div>

          <aside className="panel reasoning-panel">
            <h3>🧠 AI reasoning</h3>
            <div className="reasoning-scroll">
              {reasoning.length === 0 ? (
                <p className="muted">
                  {you?.alive && phase !== 'GAME_OVER'
                    ? "The agents' hidden reasoning unlocks here once you're eliminated or the game ends."
                    : "Each agent's hidden reasoning streams here as it acts."}
                </p>
              ) : (
                groupByRound(reasoning).map(([round, entries]) => (
                  <div className="round-group" key={round}>
                    <h4>Round {round}</h4>
                    {entries.map((r, i) => (
                      <p key={i}>
                        <strong>{r.name}</strong>: {r.reasoning}
                      </p>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
