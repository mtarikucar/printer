"use client";

import { Suspense, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment } from "@react-three/drei";
import { motion } from "motion/react";
import * as THREE from "three";
import { useRef } from "react";
import type { GalleryItem } from "@/components/gallery-card";

function AutoRotateModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const ref = useRef<THREE.Group>(null);

  // Clone scene and normalize scale/position once
  const cloned = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const s = 2 / maxDim;
      clone.scale.setScalar(s);
      clone.position.set(-center.x * s, -center.y * s, -center.z * s);
    }
    return clone;
  }, [scene]);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.4;
    }
  });

  return (
    <group ref={ref}>
      <primitive object={cloned} />
    </group>
  );
}

function ModelCanvas({ url }: { url: string }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }}>
        <color attach="background" args={["#F3F4F6"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} color="#10B981" />
        <directionalLight position={[-5, 3, -5]} intensity={0.5} color="#1E293B" />
        <Suspense fallback={null}>
          <AutoRotateModel url={url} />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}

export function HeroShowcase({
  item,
  photoLabel,
  figurineLabel,
}: {
  item: GalleryItem;
  photoLabel: string;
  figurineLabel: string;
}) {
  return (
    <div className="w-full">
      {/* Desktop: side by side */}
      <div className="hidden md:flex items-center gap-4">
        {/* Photo side */}
        <motion.div
          className="flex-1 relative"
          initial={{ opacity: 0, x: -60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border-2 border-bg-subtle shadow-lg rotate-[-2deg]">
            {item.thumbnailUrl && (
              <img
                src={item.thumbnailUrl}
                alt={item.publicDisplayName || "Photo"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
          <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-bg-surface text-text-secondary text-xs font-medium px-3 py-1 rounded-full border border-bg-subtle shadow-sm">
            {photoLabel}
          </span>
        </motion.div>

        {/* Arrow */}
        <motion.div
          className="flex-shrink-0 flex flex-col items-center gap-2"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <svg
            className="w-10 h-10 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </motion.div>

        {/* 3D model side */}
        <motion.div
          className="flex-1 relative"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border-2 border-green-500/30 shadow-lg rotate-[2deg]">
            {item.glbUrl ? (
              <ModelCanvas url={item.glbUrl} />
            ) : item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt={item.publicDisplayName || "Figurine"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
          </div>
          <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-medium px-3 py-1 rounded-full shadow-sm">
            {figurineLabel}
          </span>
        </motion.div>
      </div>

      {/* Mobile: vertical stack */}
      <div className="md:hidden flex flex-col items-center gap-4">
        <motion.div
          className="relative w-full"
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="relative h-[250px] rounded-2xl overflow-hidden border-2 border-bg-subtle shadow-lg">
            {item.thumbnailUrl && (
              <img
                src={item.thumbnailUrl}
                alt={item.publicDisplayName || "Photo"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-bg-surface text-text-secondary text-xs font-medium px-3 py-1 rounded-full border border-bg-subtle shadow-sm">
            {photoLabel}
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <svg
            className="w-8 h-8 text-green-500 rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </motion.div>

        <motion.div
          className="relative w-full"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className="relative h-[250px] rounded-2xl overflow-hidden border-2 border-green-500/30 shadow-lg">
            {item.glbUrl ? (
              <ModelCanvas url={item.glbUrl} />
            ) : item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt={item.publicDisplayName || "Figurine"}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
          </div>
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-medium px-3 py-1 rounded-full shadow-sm">
            {figurineLabel}
          </span>
        </motion.div>
      </div>

      {/* Name below */}
      {item.publicDisplayName && (
        <motion.p
          className="text-center text-sm text-text-muted mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {item.publicDisplayName}
        </motion.p>
      )}
    </div>
  );
}
