"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { SculptCanvas } from "./SculptCanvas";
import { SculptToolbar } from "./SculptToolbar";
import { SculptSidebar } from "./SculptSidebar";
import { SculptStatusBar } from "./SculptStatusBar";
import type { BrushType, SymmetrySettings } from "@/lib/sculpting/engine/types";

interface MeshSculptorProps {
  glbUrl: string;
  orderId: string;
  generationId: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function MeshSculptor({
  glbUrl,
  orderId,
  generationId,
  onClose,
  onSaved,
}: MeshSculptorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sculptRef = useRef<SculptCanvas | null>(null);

  // UI state
  const [activeBrush, setActiveBrush] = useState<BrushType>("draw");
  const [brushSize, setBrushSize] = useState(0.15);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [symmetry, setSymmetry] = useState<SymmetrySettings>({ x: false, y: false, z: false });
  const [wireframe, setWireframe] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [vertexCount, setVertexCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize canvas and engine
  useEffect(() => {
    if (!canvasRef.current) return;

    const sculpt = new SculptCanvas(canvasRef.current);
    sculptRef.current = sculpt;

    sculpt.setCallbacks({
      onBrushChanged: (b) => setActiveBrush(b),
      onUndoStackChanged: (u, r) => {
        setUndoCount(u);
        setRedoCount(r);
        if (u > 0) setHasChanges(true);
      },
      onMeshStatsChanged: (v, f) => {
        setVertexCount(v);
        setFaceCount(f);
      },
      onLoadingChanged: (l) => setLoading(l),
    });

    let disposed = false;
    sculpt.loadMesh(glbUrl).catch((err) => {
      if (!disposed) {
        console.error("Failed to load mesh:", err);
        setLoading(false);
      }
    });

    return () => {
      disposed = true;
      sculpt.dispose();
      sculptRef.current = null;
    };
  }, [glbUrl]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip shortcuts when interacting with form inputs (sliders, text fields)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = sculptRef.current;
      if (!s) return;

      // Ctrl+Z / Ctrl+Shift+Z
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          s.undo();
        } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          s.redo();
        }
        return;
      }

      switch (e.key) {
        case "[":
          setBrushSize((prev) => {
            const next = Math.max(0.01, prev - 0.02);
            s.setBrushSize(next);
            return next;
          });
          break;
        case "]":
          setBrushSize((prev) => {
            const next = Math.min(1, prev + 0.02);
            s.setBrushSize(next);
            return next;
          });
          break;
        case "w":
        case "W":
          setWireframe(s.toggleWireframe());
          break;
        case "f":
        case "F":
          s.frameModel();
          break;
        case "x":
          setSymmetry((prev) => {
            const next = { ...prev, x: !prev.x };
            s.setSymmetry(next);
            return next;
          });
          break;
        case "y":
          setSymmetry((prev) => {
            const next = { ...prev, y: !prev.y };
            s.setSymmetry(next);
            return next;
          });
          break;
        case "z":
          setSymmetry((prev) => {
            const next = { ...prev, z: !prev.z };
            s.setSymmetry(next);
            return next;
          });
          break;
        // Quick-select brushes 1-9
        case "1": s.setBrush("draw"); break;
        case "2": s.setBrush("smooth"); break;
        case "3": s.setBrush("flatten"); break;
        case "4": s.setBrush("inflate"); break;
        case "5": s.setBrush("grab"); break;
        case "6": s.setBrush("pinch"); break;
        case "7": s.setBrush("crease"); break;
        case "8": s.setBrush("clay_strips"); break;
        case "9": s.setBrush("mask"); break;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Modifier keys (hold to activate)
      if (e.key === "Shift") {
        if (sculptRef.current) {
          sculptRef.current.engine.brushSettings.smoothOverride = true;
        }
      }
      if (e.key === "Control") {
        if (sculptRef.current) {
          sculptRef.current.engine.brushSettings.invert = true;
        }
      }
      // Also dispatch regular key actions from keydown (not keypress, which is deprecated)
      onKey(e);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        if (sculptRef.current) {
          sculptRef.current.engine.brushSettings.smoothOverride = false;
        }
      }
      if (e.key === "Control") {
        if (sculptRef.current) {
          sculptRef.current.engine.brushSettings.invert = false;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ─── Actions ─────────────────────────────────────────────

  const handleBrushChange = useCallback((type: BrushType) => {
    sculptRef.current?.setBrush(type);
    setActiveBrush(type);
  }, []);

  const handleSizeChange = useCallback((size: number) => {
    sculptRef.current?.setBrushSize(size);
    setBrushSize(size);
  }, []);

  const handleStrengthChange = useCallback((strength: number) => {
    sculptRef.current?.setBrushStrength(strength);
    setBrushStrength(strength);
  }, []);

  const handleSymmetryToggle = useCallback((axis: "x" | "y" | "z") => {
    setSymmetry((prev) => {
      const next = { ...prev, [axis]: !prev[axis] };
      sculptRef.current?.setSymmetry(next);
      return next;
    });
  }, []);

  const handleWireframeToggle = useCallback(() => {
    const result = sculptRef.current?.toggleWireframe();
    if (result !== undefined) setWireframe(result);
  }, []);

  const handleUndo = useCallback(() => sculptRef.current?.undo(), []);
  const handleRedo = useCallback(() => sculptRef.current?.redo(), []);
  const handleFrame = useCallback(() => sculptRef.current?.frameModel(), []);

  const handleSave = useCallback(async () => {
    const mesh = sculptRef.current?.getMesh();
    if (!mesh) return;

    setSaving(true);
    try {
      // Use the dedicated exporter which handles material swap, color attr cleanup, and matrix baking
      const { exportGLB } = await import("@/lib/sculpting/engine/MeshExporter");
      const glb = await exportGLB(mesh);

      // Upload to server
      const formData = new FormData();
      formData.append("glb", new Blob([glb], { type: "model/gltf-binary" }), "sculpted.glb");
      formData.append("generationId", generationId);

      const res = await fetch(`/api/admin/orders/${orderId}/save-sculpted-mesh`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }

      setHasChanges(false);
      onSaved?.();
    } catch (err) {
      console.error("Failed to save sculpted mesh:", err);
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [orderId, generationId, onSaved]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to close?"
      );
      if (!confirmed) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  // ─── Render ──────────────────────────────────────────────

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
      {/* Top toolbar */}
      <SculptToolbar
        activeBrush={activeBrush}
        symmetry={symmetry}
        wireframe={wireframe}
        onBrushChange={handleBrushChange}
        onSymmetryToggle={handleSymmetryToggle}
        onWireframeToggle={handleWireframeToggle}
        onFrame={handleFrame}
        onClose={handleClose}
      />

      {/* Main area: canvas + sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative">
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            style={{ touchAction: "none" }}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500 text-sm">Loading mesh...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <SculptSidebar
          brushSize={brushSize}
          brushStrength={brushStrength}
          undoCount={undoCount}
          redoCount={redoCount}
          saving={saving}
          onSizeChange={handleSizeChange}
          onStrengthChange={handleStrengthChange}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSave={handleSave}
        />
      </div>

      {/* Bottom status bar */}
      <SculptStatusBar
        activeBrush={activeBrush}
        vertexCount={vertexCount}
        faceCount={faceCount}
      />
    </div>
  );

  return createPortal(content, document.body);
}
