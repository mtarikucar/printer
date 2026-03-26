"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

function HeroSphere() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { pointer } = useThree();

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 0.2;
    meshRef.current.rotation.x = THREE.MathUtils.lerp(
      meshRef.current.rotation.x,
      pointer.y * 0.3,
      0.05
    );
    meshRef.current.rotation.z = THREE.MathUtils.lerp(
      meshRef.current.rotation.z,
      pointer.x * 0.2,
      0.05
    );
  });

  const sphereColor = useMemo(() => new THREE.Color("#10B981"), []);

  return (
    <mesh ref={meshRef} scale={2.2}>
      <icosahedronGeometry args={[1, 64]} />
      <MeshDistortMaterial
        color={sphereColor}
        roughness={0.3}
        metalness={0.9}
        distort={0.25}
        speed={1.5}
      />
    </mesh>
  );
}

export function HeroModel({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <color attach="background" args={["#F3F4F6"]} />
        <ambientLight intensity={0.2} />
        {/* Emerald key light */}
        <directionalLight
          position={[5, 5, 5]}
          intensity={1.2}
          color="#10B981"
        />
        {/* Cool fill light */}
        <directionalLight
          position={[-5, 3, -5]}
          intensity={0.6}
          color="#1E293B"
        />
        {/* Rim light */}
        <directionalLight
          position={[0, -3, 5]}
          intensity={0.3}
          color="#0A0A0B"
        />
        <HeroSphere />
      </Canvas>
    </div>
  );
}
