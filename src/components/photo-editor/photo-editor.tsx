"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { CropperRef } from "react-advanced-cropper";
import { useDictionary } from "@/lib/i18n/locale-context";
import { EditorCanvas } from "./editor-canvas";
import { EditorToolbar } from "./editor-toolbar";
import { EditorAdjustments } from "./editor-adjustments";
import { EditorCutTool } from "./editor-cut-tool";
import { type ImageAdjustments, DEFAULT_ADJUSTMENTS, type EditorTool, getFilterStyle } from "./types";

interface PhotoEditorProps {
  file: File;
  onCancel: () => void;
  exportRef?: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
}

export function PhotoEditor({ file, onCancel, exportRef }: PhotoEditorProps) {
  const d = useDictionary();
  const cropperRef = useRef<CropperRef>(null);

  const [imageSrc, setImageSrc] = useState<string>("");
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);

  // AI feature state
  const [removeBgLoading, setRemoveBgLoading] = useState(false);
  const [detectLoading, setDetectLoading] = useState(false);
  const [removeBgStatus, setRemoveBgStatus] = useState<string | null>(null);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);

  // Cut tool state
  const [cutToolActive, setCutToolActive] = useState(false);

  // Track the current working file (may change after bg removal)
  const [currentFile, setCurrentFile] = useState<File>(file);

  useEffect(() => {
    const url = URL.createObjectURL(currentFile);
    setImageSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  const handleToolAction = useCallback((tool: EditorTool) => {
    const cropper = cropperRef.current;
    if (!cropper) return;

    switch (tool) {
      case "rotateLeft":
        cropper.rotateImage(-90);
        break;
      case "rotateRight":
        cropper.rotateImage(90);
        break;
      case "flipH":
        cropper.flipImage(true, false);
        break;
      case "flipV":
        cropper.flipImage(false, true);
        break;
      case "zoomIn":
        cropper.zoomImage(1.2);
        break;
      case "zoomOut":
        cropper.zoomImage(0.8);
        break;
    }
  }, []);

  const handleRemoveBg = useCallback(async () => {
    setRemoveBgLoading(true);
    setRemoveBgStatus(d["editor.tool.removeBg.uploading"]);

    try {
      const formData = new FormData();
      formData.append("image", currentFile);

      setRemoveBgStatus(d["editor.tool.removeBg.loading"]);

      const response = await fetch("/api/remove-background", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || "Background removal failed");
      }

      const blob = await response.blob();
      const originalName = currentFile.name.replace(/\.[^/.]+$/, "");
      const resultFile = new File([blob], `${originalName}_nobg.png`, { type: "image/png" });

      setCurrentFile(resultFile);
      setRemoveBgStatus(d["editor.tool.removeBg.success"]);
      setTimeout(() => setRemoveBgStatus(null), 3000);
    } catch (error) {
      console.error("Background removal failed:", error);
      setRemoveBgStatus(d["editor.tool.removeBg.failed"]);
      setTimeout(() => setRemoveBgStatus(null), 3000);
    } finally {
      setRemoveBgLoading(false);
    }
  }, [currentFile, d]);

  const handleDetectPerson = useCallback(async () => {
    setDetectLoading(true);
    setDetectStatus(d["editor.tool.detectPerson.loading"]);

    try {
      const { initializeDetector, detectPerson } = await import("@/lib/person-detection");
      await initializeDetector();

      const result = await detectPerson(currentFile);

      if (result.found && result.box) {
        const cropper = cropperRef.current;
        if (cropper) {
          cropper.setCoordinates({
            left: result.box.xmin,
            top: result.box.ymin,
            width: result.box.xmax - result.box.xmin,
            height: result.box.ymax - result.box.ymin,
          });
        }
        setDetectStatus(d["editor.tool.detectPerson.found"]);
      } else {
        setDetectStatus(d["editor.tool.detectPerson.notFound"]);
      }
      setTimeout(() => setDetectStatus(null), 3000);
    } catch (error) {
      console.error("Person detection failed:", error);
      setDetectStatus(d["editor.tool.detectPerson.notFound"]);
      setTimeout(() => setDetectStatus(null), 3000);
    } finally {
      setDetectLoading(false);
    }
  }, [currentFile, d]);

  // Expose export function to parent via ref
  const adjustmentsRef = useRef(adjustments);
  adjustmentsRef.current = adjustments;

  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async () => {
      const cropper = cropperRef.current;
      if (!cropper) return null;

      const canvas = cropper.getCanvas();
      if (!canvas) return null;

      const adj = adjustmentsRef.current;
      const hasAdjustments =
        adj.brightness !== 100 ||
        adj.contrast !== 100 ||
        adj.saturation !== 100;

      let finalCanvas = canvas;

      if (hasAdjustments) {
        finalCanvas = document.createElement("canvas");
        finalCanvas.width = canvas.width;
        finalCanvas.height = canvas.height;
        const ctx = finalCanvas.getContext("2d")!;
        ctx.filter = getFilterStyle(adj);
        ctx.drawImage(canvas, 0, 0);
      }

      return new Promise<Blob | null>((resolve) => {
        finalCanvas.toBlob((b) => resolve(b), "image/png");
      });
    };
    return () => { if (exportRef) exportRef.current = null; };
  }, [exportRef]);

  const handleCutToolApply = useCallback((blob: Blob) => {
    const newFile = new File([blob], "cut-photo.png", { type: "image/png" });
    setCurrentFile(newFile);
    setCutToolActive(false);
  }, []);

  // Cleanup AI models on unmount
  useEffect(() => {
    return () => {
      import("@/lib/person-detection").then((m) => m.disposeDetector()).catch(() => {});
    };
  }, []);

  // Memoize the aspect ratio for the toolbar comparison
  const currentAspectRatio = useMemo(() => aspectRatio, [aspectRatio]);

  if (cutToolActive && imageSrc) {
    return (
      <EditorCutTool
        imageSrc={imageSrc}
        onApply={handleCutToolApply}
        onCancel={() => setCutToolActive(false)}
      />
    );
  }

  return (
    <div className="card shadow-elevated overflow-hidden animate-fade-in-up">
      <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />

      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-bg-subtle">
        <h2 className="text-lg font-serif text-text-primary">{d["editor.title"]}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-4 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          {d["editor.cancel"]}
        </button>
      </div>

      {/* Canvas */}
      <div className="p-4">
        {imageSrc && (
          <EditorCanvas
            ref={cropperRef}
            imageSrc={imageSrc}
            aspectRatio={aspectRatio}
            adjustments={adjustments}
          />
        )}
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-t border-bg-subtle">
        <EditorToolbar
          onToolAction={handleToolAction}
          onRemoveBg={handleRemoveBg}
          onDetectPerson={handleDetectPerson}
          onCutTool={() => setCutToolActive(true)}
          removeBgLoading={removeBgLoading}
          detectLoading={detectLoading}
          removeBgStatus={removeBgStatus}
          detectStatus={detectStatus}
          aspectRatio={currentAspectRatio}
          onAspectRatioChange={setAspectRatio}
        />
      </div>

      {/* Adjustments */}
      <div className="px-6 py-4 border-t border-bg-subtle">
        <EditorAdjustments adjustments={adjustments} onChange={setAdjustments} />
      </div>
    </div>
  );
}
