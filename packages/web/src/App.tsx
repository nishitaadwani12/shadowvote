import { useState } from 'react';
import type { NightAction, Role } from '@shadowvote/shared';
import { useGameSocket } from './lib/ws';
import { GameScene } from './scene/GameScene';
import { Hud } from './ui/Hud';

const NIGHT_ACTION: Partial<Record<Role, NightAction>> = {
  WEREWOLF: 'KILL',
  DOCTOR: 'PROTECT',
  SEER: 'INSPECT',
};
const ACTION_VERB: Record<NightAction, string> = { KILL: 'kill', PROTECT: 'protect', INSPECT: 'inspect' };

const ROLE_OBJECTIVE: Record<Role, string> = {
  WEREWOLF: 'Cull a villager each night; blend in and dodge the day vote.',
  SEER: 'Inspect one player each night; steer the village to the wolves.',
  DOCTOR: 'Protect one player from the wolves each night.',
  VILLAGER: 'Reason and rally votes to eliminate the werewolves.',
};

const PERSONAS = ['a cautious analyst', 'an aggressive accuser', 'a quiet observer', 'a smooth-talking bluffer'];

export function App() {
  const sock = useGameSocket();
  const { state, playerId } = sock;
  const [room, setRoom] = useState('table-1');

  // Finished games are terminal on the server, so a rematch uses a fresh room.
  const playAgain = () => {
    sock.reset();
    setRoom(`table-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  const you = state?.you ?? null;
  const phase = state?.phase ?? 'LOBBY';
  const myNightAction = you?.role ? NIGHT_ACTION[you.role] : undefined;
  const canActAtNight = phase === 'NIGHT' && !!you?.alive && !!myNightAction;
  const canVote = (phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTE') && !!you?.alive;
  const targetable = canActAtNight || canVote;
  const dead = !!(you && !you.alive);

  const pickPlayer = (id: string) => {
    if (canActAtNight && myNightAction) sock.nightAction(myNightAction, id);
    else if (canVote) sock.vote(id);
  };

  const actionHint = dead
    ? "You've been eliminated — watching."
    : canActAtNight
      ? `Night — tap a player to ${ACTION_VERB[myNightAction!]}`
      : canVote
        ? 'Day — tap a player to vote them out'
        : phase === 'NIGHT'
          ? 'Night falls. The special roles are acting…'
          : phase === 'DAY_DISCUSSION' || phase === 'DAY_VOTE'
            ? 'Discussion underway…'
            : null;

  return (
    <div className="shell">
      <GameScene
        players={state?.players ?? []}
        phase={phase}
        playerId={playerId}
        targetable={targetable}
        onPick={pickPlayer}
      />
      <Hud
        sock={sock}
        you={you}
        phase={phase}
        actionHint={actionHint}
        objective={you?.role ? ROLE_OBJECTIVE[you.role] : null}
        personas={PERSONAS}
        room={room}
        setRoom={setRoom}
        onPlayAgain={playAgain}
      />
    </div>
  );
}
