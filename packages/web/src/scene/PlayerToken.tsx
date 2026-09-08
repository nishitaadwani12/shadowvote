import { useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { PlayerPublic } from '@shadowvote/shared';

interface Props {
  player: PlayerPublic;
  position: [number, number, number];
  isYou: boolean;
  targetable: boolean;
  onPick: (id: string) => void;
}

/** A player's seat token: bobs gently, tilts over when eliminated, glows and scales when it can be targeted. */
export function PlayerToken({ player, position, isYou, targetable, onPick }: Props) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const alive = player.alive;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const want = hovered && targetable ? 1.18 : 1;
    g.scale.x += (want - g.scale.x) * 0.15;
    g.scale.y = g.scale.z = g.scale.x;
    g.position.y = position[1] + (alive ? Math.sin(state.clock.elapsedTime * 1.5 + position[0]) * 0.06 : 0);
  });

  const base = isYou ? '#8b6dff' : alive ? '#3a4256' : '#1c2029';
  const emissive = targetable ? (hovered ? '#ff4d6d' : '#7c5cff') : isYou ? '#3b2f80' : '#05070d';

  return (
    <group ref={group} position={position}>
      <mesh
        castShadow
        rotation={[alive ? 0 : Math.PI / 2.3, 0, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (targetable) setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (targetable) onPick(player.id);
        }}
      >
        <capsuleGeometry args={[0.32, 0.66, 6, 16]} />
        <meshStandardMaterial
          color={base}
          emissive={emissive}
          emissiveIntensity={targetable ? 0.9 : 0.35}
          roughness={0.45}
          metalness={0.25}
          transparent
          opacity={alive ? 1 : 0.5}
        />
      </mesh>

      <Html center distanceFactor={10} position={[0, 1.05, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
        <div className={`token-label${isYou ? ' you' : ''}${alive ? '' : ' dead'}${targetable ? ' targetable' : ''}`}>
          {player.isAi ? '🤖 ' : ''}
          {player.name}
          {isYou ? ' · you' : ''}
        </div>
      </Html>
    </group>
  );
}
