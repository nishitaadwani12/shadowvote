import { useState } from 'react';
import type { NightAction, Role } from '@shadowvote/shared';
import { useGameSocket } from './lib/ws';

const NIGHT_ACTION: Partial<Record<Role, NightAction>> = {
  WEREWOLF: 'KILL',
  DOCTOR: 'PROTECT',
  SEER: 'INSPECT',
};

const ACTION_VERB: Record<NightAction, string> = { KILL: 'kill', PROTECT: 'protect', INSPECT: 'inspect' };

const PERSONAS = ['a cautious analyst', 'an aggressive accuser', 'a quiet observer', 'a smooth-talking bluffer'];

export function App() {
  const { status, state, chat, reasoning, playerId, error, join, sendChat, start, addAi, vote, nightAction } =
    useGameSocket();
  const [gameId, setGameId] = useState('table-1');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const joined = playerId !== null;

  const you = state?.you ?? null;
  const phase = state?.phase ?? 'LOBBY';
  const myNightAction = you?.role ? NIGHT_ACTION[you.role] : undefined;
  const canActAtNight = phase === 'NIGHT' && you?.alive && myNightAction;
  const canVote = (phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTE') && you?.alive;

  function pickPlayer(targetId: string) {
    if (canActAtNight && myNightAction) nightAction(myNightAction, targetId);
    else if (canVote) vote(targetId);
  }

  function addAiPlayer() {
    const n = (state?.players.filter((p) => p.isAi).length ?? 0) + 1;
    const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)]!;
    addAi(`AI-${n}`, persona);
  }

  const targetable = Boolean(canActAtNight || canVote);
  const actionHint = canActAtNight
    ? `Night — click a player to ${ACTION_VERB[myNightAction!]}`
    : canVote
      ? 'Day — click a player to vote them out'
      : null;

  return (
    <div className="app">
      <header>
        <h1>🐺 ShadowVote</h1>
        <span className={`status status--${status}`}>{status}</span>
      </header>

      {error && <div className="error">{error}</div>}

      {!joined ? (
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) join(gameId.trim(), name.trim());
          }}
        >
          <input value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="Room" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <button type="submit" disabled={status !== 'open' || !name.trim()}>
            Join table
          </button>
        </form>
      ) : (
        <main className="game">
          <section className="players">
            <div className="phasebar">
              <span className="phase">{phase}</span>
              {state && state.round > 0 && <span className="muted">round {state.round}</span>}
              {you?.role && <span className="role">you are {you.role}</span>}
            </div>

            {state?.winner ? (
              <div className="winner">🏆 {state.winner} wins</div>
            ) : phase === 'LOBBY' ? (
              <div className="lobby-actions">
                <button className="secondary" onClick={addAiPlayer}>
                  + Add AI player
                </button>
                <button onClick={start} disabled={(state?.players.length ?? 0) < 4}>
                  Start game ({state?.players.length ?? 0}/4+)
                </button>
              </div>
            ) : (
              actionHint && <p className="hint">{actionHint}</p>
            )}

            <ul>
              {state?.players.map((p) => (
                <li key={p.id} className={p.alive ? '' : 'dead'}>
                  <span>
                    {p.name} {p.id === playerId ? '(you)' : ''} {p.isAi ? '🤖' : ''}
                  </span>
                  {targetable && p.alive && p.id !== playerId && (
                    <button className="pick" onClick={() => pickPlayer(p.id)}>
                      {canActAtNight ? ACTION_VERB[myNightAction!] : 'vote'}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {(state?.notes.length ?? 0) > 0 && (
              <div className="notes">
                <h3>Private notes</h3>
                {state?.notes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            )}
          </section>

          <section className="chat">
            <h2>Table talk</h2>
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
          </section>

          <aside className="reasoning">
            <h2>🧠 AI reasoning</h2>
            {reasoning.length === 0 ? (
              <p className="muted">Add AI players and start — each agent's hidden reasoning streams here as it acts.</p>
            ) : (
              reasoning.map((r, i) => (
                <p key={i}>
                  <strong>{r.name}</strong> <span className="muted">r{r.round}</span>: {r.reasoning}
                </p>
              ))
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
