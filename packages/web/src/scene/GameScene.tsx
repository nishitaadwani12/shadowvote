import { Canvas } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import type { GameStateView } from '@shadowvote/shared';
import { PlayerToken } from './PlayerToken';

interface Props {
  players: GameStateView['players'];
  phase: string;
  playerId: string | null;
  targetable: boolean;
  onPick: (id: string) => void;
}

/** The cinematic 3D table: players ringed around it, day/night lighting, an orbit-able camera. */
export function GameScene({ players, phase, playerId, targetable, onPick }: Props) {
  const isNight = phase === 'NIGHT';
  const bg = isNight ? '#070912' : phase === 'GAME_OVER' ? '#0c0a16' : '#0f1420';
  const n = Math.max(players.length, 1);
  const radius = Math.min(2 + n * 0.32, 4.2);
  const idle = phase === 'LOBBY' || phase === 'GAME_OVER';

  return (
    <Canvas shadows camera={{ position: [0, 6.5, 9], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 12, 27]} />

      <ambientLight intensity={isNight ? 0.3 : 0.7} />
      <directionalLight
        castShadow
        position={[6, 10, 6]}
        intensity={isNight ? 0.5 : 1.2}
        color={isNight ? '#94a6ff' : '#ffe6b0'}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[0, 4, 0]} intensity={isNight ? 1.3 : 0.5} color={isNight ? '#8fb3ff' : '#ffd18a'} distance={16} />

      {/* Table + glowing rim */}
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <cylinderGeometry args={[radius + 0.9, radius + 1.15, 0.3, 64]} />
        <meshStandardMaterial color="#151a27" roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius + 0.5, radius + 0.7, 64]} />
        <meshStandardMaterial color="#7c5cff" emissive="#7c5cff" emissiveIntensity={0.7} toneMapped={false} />
      </mesh>

      {/* Ground catches shadows */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]}>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color={bg} />
      </mesh>

      {/* Moon at night, sun by day */}
      <Float speed={1.6} floatIntensity={0.7} rotationIntensity={0.15}>
        <mesh position={[0, 3.4, 0]}>
          <sphereGeometry args={[0.62, 32, 32]} />
          <meshStandardMaterial
            color={isNight ? '#d5e2ff' : '#ffcf6b'}
            emissive={isNight ? '#8fb3ff' : '#ffb347'}
            emissiveIntensity={1.3}
            toneMapped={false}
          />
        </mesh>
      </Float>

      {players.map((p, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const pos: [number, number, number] = [Math.cos(a) * radius, 0.4, Math.sin(a) * radius];
        return (
          <PlayerToken
            key={p.id}
            player={p}
            position={pos}
            isYou={p.id === playerId}
            targetable={targetable && p.alive && p.id !== playerId}
            onPick={onPick}
          />
        );
      })}

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={idle}
        autoRotateSpeed={0.6}
        minPolarAngle={0.6}
        maxPolarAngle={1.35}
        target={[0, 0.5, 0]}
      />
    </Canvas>
  );
}
