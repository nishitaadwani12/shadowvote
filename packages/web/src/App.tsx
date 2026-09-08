import { useState } from 'react';
import { useGameSocket } from './lib/ws';

export function App() {
  const { status, state, chat, reasoning, playerId, join, sendChat } = useGameSocket();
  const [gameId, setGameId] = useState('table-1');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const joined = playerId !== null;

  return (
    <div className="app">
      <header>
        <h1>🐺 ShadowVote</h1>
        <span className={`status status--${status}`}>{status}</span>
      </header>

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
            <h2>Players — {state?.phase ?? 'LOBBY'}</h2>
            <ul>
              {state?.players.map((p) => (
                <li key={p.id} className={p.alive ? '' : 'dead'}>
                  {p.name} {p.id === playerId ? '(you)' : ''} {p.isAi ? '🤖' : ''}
                </li>
              ))}
            </ul>
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
              <p className="muted">Hidden agent reasoning appears here once AI players join (P2).</p>
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
