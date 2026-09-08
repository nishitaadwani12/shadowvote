import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatLine, ClientMessage, GameStateView, NightAction, ServerMessage } from '@shadowvote/shared';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws';
const SESSION_KEY = 'shadowvote-session';

export type Status = 'connecting' | 'open' | 'closed';

export interface ReasoningEntry {
  playerId: string;
  name: string;
  reasoning: string;
  round: number;
}

/**
 * Connects to the ShadowVote WebSocket gateway and exposes typed game state.
 * Reconnection/resync will be hardened in P4; P0 keeps a single live socket.
 */
export function useGameSocket() {
  const [status, setStatus] = useState<Status>('connecting');
  const [state, setState] = useState<GameStateView | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [reasoning, setReasoning] = useState<ReasoningEntry[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const gameRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;
    ws.onopen = () => {
      setStatus('open');
      // Auto-reconnect to a prior seat if we have one.
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          const { gameId, playerId } = JSON.parse(raw) as { gameId: string; playerId: string };
          if (gameId && playerId) {
            gameRef.current = gameId;
            ws.send(JSON.stringify({ t: 'REJOIN', gameId, playerId }));
          }
        } catch {
          localStorage.removeItem(SESSION_KEY);
        }
      }
    };
    ws.onclose = () => setStatus('closed');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      switch (msg.t) {
        case 'JOINED':
          setPlayerId(msg.playerId);
          gameRef.current = msg.gameId;
          localStorage.setItem(SESSION_KEY, JSON.stringify({ gameId: msg.gameId, playerId: msg.playerId }));
          break;
        case 'STATE':
          setState(msg.state);
          setChat(msg.state.transcript);
          break;
        case 'CHAT_MSG':
          setChat((prev) => [...prev, msg.line]);
          break;
        case 'AGENT_REASONING':
          setReasoning((prev) => [...prev, msg]);
          break;
        case 'ERROR':
          setError(msg.message);
          if (/Session expired/.test(msg.message)) localStorage.removeItem(SESSION_KEY);
          break;
        default:
          break;
      }
    };
    return () => ws.close();
  }, []);

  const sendRaw = useCallback((message: ClientMessage) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const join = useCallback(
    (gameId: string, name: string) => {
      gameRef.current = gameId;
      sendRaw({ t: 'JOIN', gameId, name });
    },
    [sendRaw],
  );

  const withGame = useCallback(
    (make: (gameId: string) => ClientMessage) => {
      if (gameRef.current) {
        setError(null);
        sendRaw(make(gameRef.current));
      }
    },
    [sendRaw],
  );

  const sendChat = useCallback((text: string) => withGame((gameId) => ({ t: 'CHAT', gameId, text })), [withGame]);
  const start = useCallback(() => withGame((gameId) => ({ t: 'START', gameId })), [withGame]);
  const addAi = useCallback(
    (name: string, persona: string) => withGame((gameId) => ({ t: 'ADD_AI', gameId, name, persona })),
    [withGame],
  );
  const vote = useCallback((targetId: string) => withGame((gameId) => ({ t: 'VOTE', gameId, targetId })), [withGame]);
  const nightAction = useCallback(
    (action: NightAction, targetId: string) => withGame((gameId) => ({ t: 'NIGHT_ACTION', gameId, action, targetId })),
    [withGame],
  );

  return { status, state, chat, reasoning, playerId, error, join, sendChat, start, addAi, vote, nightAction };
}

export type GameSocket = ReturnType<typeof useGameSocket>;
