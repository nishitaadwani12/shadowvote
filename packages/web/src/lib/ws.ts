import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatLine, ClientMessage, GameStateView, ServerMessage } from '@shadowvote/shared';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws';

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

  const socketRef = useRef<WebSocket | null>(null);
  const gameRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;
    ws.onopen = () => setStatus('open');
    ws.onclose = () => setStatus('closed');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      switch (msg.t) {
        case 'JOINED':
          setPlayerId(msg.playerId);
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

  const sendChat = useCallback(
    (text: string) => {
      if (gameRef.current) sendRaw({ t: 'CHAT', gameId: gameRef.current, text });
    },
    [sendRaw],
  );

  return { status, state, chat, reasoning, playerId, join, sendChat };
}
