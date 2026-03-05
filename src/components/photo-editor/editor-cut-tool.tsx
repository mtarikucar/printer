"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

type CutMode = "lasso" | "eraser";

interface EditorCutToolProps {
  imageSrc: string;
  onApply: (blob: Blob) => void;
  onCancel: () => void;
}

interface Point {
  x: number;
  y: number;
}

export function EditorCutTool({ imageSrc, onApply, onCancel }: EditorCutToolProps) {
  const d = useDictionary();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [mode, setMode] = useState<CutMode>("lasso");
  const [points, setPoints] = useState<Point[]>([]);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [brushSize, setBrushSize] = useState(20);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  // Trigger re-render when current eraser stroke updates
  const [, setRenderTick] = useState(0);

  // Refs for synchronous access in event handlers (avoid stale closure)
  const isDrawingRef = useRef(false);
  const modeRef = useRef<CutMode>("lasso");
  const pointsRef = useRef<Point[]>([]);
  const strokesRef = useRef<Point[][]>([]);
  const currentStrokeRef = useRef<Point[]>([]);
  const brushSizeRef = useRef(20);

  // Keep refs in sync with state
  modeRef.current = mode;
  pointsRef.current = points;
  strokesRef.current = strokes;
  brushSizeRef.current = brushSize;

  // Layout info for coordinate mapping
  const layoutRef = useRef<{
    offsetX: number;
    offsetY: number;
    scale: number;
    displayW: number;
    displayH: number;
  } | null>(null);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Compute layout for object-fit: contain
  const computeLayout = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return null;

    const dpr = devicePixelRatio;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = cw / ch;

    let displayW: number, displayH: number, offsetX: number, offsetY: number;
    if (imgAspect > canvasAspect) {
      displayW = cw;
      displayH = cw / imgAspect;
      offsetX = 0;
      offsetY = (ch - displayH) / 2;
    } else {
      displayH = ch;
      displayW = ch * imgAspect;
      offsetX = (cw - displayW) / 2;
      offsetY = 0;
    }

    const scale = displayW / img.naturalWidth;
    const layout = { offsetX, offsetY, scale, displayW, displayH };
    layoutRef.current = layout;
    return layout;
  }, []);

  // Draw checkerboard pattern
  const drawCheckerboard = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const size = 8;
    for (let row = 0; row < Math.ceil(h / size); row++) {
      for (let col = 0; col < Math.ceil(w / size); col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#e5e5e5" : "#ffffff";
        ctx.fillRect(x + col * size, y + row * size, size, size);
      }
    }
  }, []);

  // Build smooth quadratic bezier path from points
  const buildSmoothPath = useCallback((ctx: CanvasRenderingContext2D, pts: Point[], close: boolean) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      const cpy = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
    }
    if (close) ctx.closePath();
  }, []);

  // Render canvas — reads from refs for real-time accuracy
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = devicePixelRatio;
    const layout = computeLayout();
    if (!layout) return;

    const { offsetX, offsetY, displayW, displayH } = layout;
    const currentMode = modeRef.current;
    const currentPoints = pointsRef.current;
    const currentStrokes = strokesRef.current;
    const currentBrushSize = brushSizeRef.current;
    const drawing = isDrawingRef.current;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (currentMode === "lasso") {
      // Draw image
      ctx.drawImage(img, offsetX, offsetY, displayW, displayH);

      if (currentPoints.length > 2) {
        const closed = !drawing;

        // Darken outside area
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width / dpr, canvas.height / dpr);
        // Add lasso path as hole (evenodd)
        ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
        for (let i = 1; i < currentPoints.length; i++) {
          const prev = currentPoints[i - 1];
          const curr = currentPoints[i];
          const cpx = (prev.x + curr.x) / 2;
          const cpy = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
        }
        ctx.closePath();
        ctx.fill("evenodd");
        ctx.restore();

        // Draw lasso stroke line
        buildSmoothPath(ctx, currentPoints, closed);
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Eraser mode
      // Draw checkerboard behind image area
      drawCheckerboard(ctx, offsetX, offsetY, displayW, displayH);

      // Draw image to offscreen then erase strokes
      const offscreen = document.createElement("canvas");
      offscreen.width = displayW * dpr;
      offscreen.height = displayH * dpr;
      const oCtx = offscreen.getContext("2d")!;
      oCtx.scale(dpr, dpr);
      oCtx.drawImage(img, 0, 0, displayW, displayH);

      // Erase committed strokes
      oCtx.globalCompositeOperation = "destination-out";
      oCtx.lineCap = "round";
      oCtx.lineJoin = "round";
      oCtx.lineWidth = currentBrushSize;

      for (const stroke of currentStrokes) {
        if (stroke.length < 2) continue;
        oCtx.beginPath();
        oCtx.moveTo(stroke[0].x - offsetX, stroke[0].y - offsetY);
        for (let i = 1; i < stroke.length; i++) {
          oCtx.lineTo(stroke[i].x - offsetX, stroke[i].y - offsetY);
        }
        oCtx.stroke();
      }

      // Erase current stroke being drawn
      const cs = currentStrokeRef.current;
      if (drawing && cs.length > 1) {
        oCtx.beginPath();
        oCtx.moveTo(cs[0].x - offsetX, cs[0].y - offsetY);
        for (let i = 1; i < cs.length; i++) {
          oCtx.lineTo(cs[i].x - offsetX, cs[i].y - offsetY);
        }
        oCtx.stroke();
      }

      ctx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height, offsetX, offsetY, displayW, displayH);

      // Draw brush cursor
      if (cursorPos) {
        ctx.beginPath();
        ctx.arc(cursorPos.x, cursorPos.y, currentBrushSize / 2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cursorPos.x, cursorPos.y, currentBrushSize / 2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [computeLayout, drawCheckerboard, buildSmoothPath, cursorPos]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageLoaded) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = devicePixelRatio;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      render();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [imageLoaded, render]);

  // Re-render on state changes
  useEffect(() => {
    render();
  }, [render, points, strokes, brushSize, mode]);

  // Get canvas-relative coordinates
  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const pt = getCanvasPoint(e);
    isDrawingRef.current = true;

    if (modeRef.current === "lasso") {
      pointsRef.current = [pt];
      setPoints([pt]);
    } else {
      currentStrokeRef.current = [pt];
    }
  }, [getCanvasPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    setCursorPos(pt);

    if (!isDrawingRef.current) return;

    if (modeRef.current === "lasso") {
      pointsRef.current = [...pointsRef.current, pt];
      setPoints([...pointsRef.current]);
    } else {
      currentStrokeRef.current.push(pt);
      // Trigger re-render for live eraser preview
      setRenderTick((t) => t + 1);
    }
  }, [getCanvasPoint]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (modeRef.current === "eraser" && currentStrokeRef.current.length > 1) {
      const committedStroke = [...currentStrokeRef.current];
      currentStrokeRef.current = [];
      strokesRef.current = [...strokesRef.current, committedStroke];
      setStrokes([...strokesRef.current]);
    }
    // For lasso, points are already in state — just re-render with closed path
    setRenderTick((t) => t + 1);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setCursorPos(null);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (modeRef.current === "lasso") {
      pointsRef.current = [];
      setPoints([]);
    } else {
      const newStrokes = strokesRef.current.slice(0, -1);
      strokesRef.current = newStrokes;
      setStrokes(newStrokes);
    }
  }, []);

  const canUndo = mode === "lasso" ? points.length > 0 : strokes.length > 0;
  const canApply = mode === "lasso" ? points.length > 10 : strokes.length > 0;

  // Apply cut
  const handleApply = useCallback(() => {
    const img = imageRef.current;
    const layout = layoutRef.current;
    if (!img || !layout) return;

    const { offsetX, offsetY, scale } = layout;

    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d")!;

    const currentPoints = pointsRef.current;
    const currentStrokes = strokesRef.current;

    if (modeRef.current === "lasso") {
      if (currentPoints.length < 10) return;

      // Clip to lasso path (transformed to image coords)
      const imgPt = (p: Point) => ({
        x: (p.x - offsetX) / scale,
        y: (p.y - offsetY) / scale,
      });

      ctx.beginPath();
      const first = imgPt(currentPoints[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < currentPoints.length; i++) {
        const prev = imgPt(currentPoints[i - 1]);
        const curr = imgPt(currentPoints[i]);
        const cpx = (prev.x + curr.x) / 2;
        const cpy = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
      }
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0);
    } else {
      // Draw image then erase strokes
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const imgBrushSize = brushSizeRef.current / scale;
      ctx.lineWidth = imgBrushSize;

      for (const stroke of currentStrokes) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(
          (stroke[0].x - offsetX) / scale,
          (stroke[0].y - offsetY) / scale
        );
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(
            (stroke[i].x - offsetX) / scale,
            (stroke[i].y - offsetY) / scale
          );
        }
        ctx.stroke();
      }
    }

    offscreen.toBlob((blob) => {
      if (blob) onApply(blob);
    }, "image/png");
  }, [onApply]);

  // Reset when switching modes
  const switchMode = useCallback((newMode: CutMode) => {
    setMode(newMode);
    modeRef.current = newMode;
    pointsRef.current = [];
    strokesRef.current = [];
    currentStrokeRef.current = [];
    isDrawingRef.current = false;
    setPoints([]);
    setStrokes([]);
  }, []);

  return (
    <div className="card shadow-elevated overflow-hidden animate-fade-in-up">
      <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />

      {/* Mode selector + instruction */}
      <div className="px-6 py-4 border-b border-bg-subtle">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => switchMode("lasso")}
            className={`h-8 px-3 rounded-lg text-sm font-medium transition-colors ${
              mode === "lasso"
                ? "bg-green-500 text-white"
                : "bg-bg-elevated text-text-muted hover:text-text-primary border border-bg-subtle"
            }`}
          >
            {d["editor.cut.modeLasso"]}
          </button>
          <button
            type="button"
            onClick={() => switchMode("eraser")}
            className={`h-8 px-3 rounded-lg text-sm font-medium transition-colors ${
              mode === "eraser"
                ? "bg-green-500 text-white"
                : "bg-bg-elevated text-text-muted hover:text-text-primary border border-bg-subtle"
            }`}
          >
            {d["editor.cut.modeEraser"]}
          </button>
        </div>
        <p className="text-sm text-text-muted">
          {mode === "lasso" ? d["editor.cut.instructionLasso"] : d["editor.cut.instructionEraser"]}
        </p>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative bg-bg-muted"
        style={{ height: "min(500px, 60vh)" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          className="absolute inset-0 touch-none"
          style={{ cursor: mode === "eraser" ? "none" : "crosshair" }}
        />
      </div>

      {/* Brush size slider (eraser only) */}
      {mode === "eraser" && (
        <div className="px-6 py-3 border-t border-bg-subtle flex items-center gap-3">
          <span className="text-xs text-text-muted whitespace-nowrap">{d["editor.cut.brushSize"]}:</span>
          <input
            type="range"
            min={5}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="flex-1 accent-green-500"
          />
          <span className="text-xs text-text-muted font-mono w-8 text-right">{brushSize}px</span>
        </div>
      )}

      {/* Actions */}
      <div className="px-6 py-4 border-t border-bg-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-bg-elevated text-text-secondary hover:text-text-primary text-sm font-medium border border-bg-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-base">↩</span>
            {d["editor.cut.undo"]}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            {d["editor.cut.cancel"]}
          </button>
        </div>
        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="btn-primary !py-2 !px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {mode === "lasso" && points.length > 0 && points.length <= 10
            ? d["editor.cut.tooFewPoints"]
            : d["editor.cut.apply"]}
        </button>
      </div>
    </div>
  );
}
