"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import type { EditorTool } from "./types";

interface EditorToolbarProps {
  onToolAction: (tool: EditorTool) => void;
  onRemoveBg: () => void;
  onDetectPerson: () => void;
  onCutTool: () => void;
  removeBgLoading: boolean;
  detectLoading: boolean;
  removeBgStatus?: string | null;
  detectStatus?: string | null;
  aspectRatio: number | undefined;
  onAspectRatioChange: (ratio: number | undefined) => void;
}

export function EditorToolbar({
  onToolAction,
  onRemoveBg,
  onDetectPerson,
  onCutTool,
  removeBgLoading,
  detectLoading,
  removeBgStatus,
  detectStatus,
  aspectRatio,
  onAspectRatioChange,
}: EditorToolbarProps) {
  const d = useDictionary();

  const tools: { key: EditorTool; icon: string; label: string }[] = [
    { key: "rotateLeft", icon: "↺", label: d["editor.tool.rotateLeft"] },
    { key: "rotateRight", icon: "↻", label: d["editor.tool.rotateRight"] },
    { key: "flipH", icon: "↔", label: d["editor.tool.flipH"] },
    { key: "flipV", icon: "↕", label: d["editor.tool.flipV"] },
    { key: "zoomIn", icon: "+", label: d["editor.tool.zoomIn"] },
    { key: "zoomOut", icon: "−", label: d["editor.tool.zoomOut"] },
  ];

  const aspectOptions: { label: string; value: number | undefined }[] = [
    { label: d["editor.aspect.free"], value: undefined },
    { label: d["editor.aspect.portrait"], value: 3 / 4 },
    { label: d["editor.aspect.square"], value: 1 },
    { label: d["editor.aspect.figurine"], value: 4 / 5 },
  ];

  return (
    <div className="space-y-3">
      {/* Transform tools */}
      <div className="flex flex-wrap items-center gap-1.5">
        {tools.map((tool) => (
          <button
            key={tool.key}
            type="button"
            onClick={() => onToolAction(tool.key)}
            title={tool.label}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-bg-elevated hover:bg-bg-muted text-text-secondary hover:text-text-primary transition-colors text-lg font-medium border border-bg-subtle"
          >
            {tool.icon}
          </button>
        ))}

        <div className="w-px h-7 bg-bg-subtle mx-1" />

        {/* AI tools */}
        <button
          type="button"
          onClick={onRemoveBg}
          disabled={removeBgLoading}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-bg-elevated hover:bg-bg-muted text-text-secondary hover:text-text-primary transition-colors text-sm font-medium border border-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {removeBgLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
          {d["editor.tool.removeBg"]}
        </button>

        <button
          type="button"
          onClick={onDetectPerson}
          disabled={detectLoading}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-bg-elevated hover:bg-bg-muted text-text-secondary hover:text-text-primary transition-colors text-sm font-medium border border-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {detectLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          )}
          {d["editor.tool.detectPerson"]}
        </button>

        <button
          type="button"
          onClick={onCutTool}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-bg-elevated hover:bg-bg-muted text-text-secondary hover:text-text-primary transition-colors text-sm font-medium border border-bg-subtle"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
          </svg>
          {d["editor.tool.cut"]}
        </button>
      </div>

      {/* Status messages */}
      {(removeBgStatus || detectStatus) && (
        <div className="flex flex-wrap gap-2">
          {removeBgStatus && (
            <span className="text-xs px-2 py-1 rounded-full bg-bg-elevated text-text-muted">
              {removeBgStatus}
            </span>
          )}
          {detectStatus && (
            <span className="text-xs px-2 py-1 rounded-full bg-bg-elevated text-text-muted">
              {detectStatus}
            </span>
          )}
        </div>
      )}

      {/* Aspect ratio */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-muted mr-1">{d["editor.tool.crop"]}:</span>
        {aspectOptions.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onAspectRatioChange(opt.value)}
            className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
              aspectRatio === opt.value
                ? "bg-green-500 text-white"
                : "bg-bg-elevated text-text-muted hover:text-text-primary border border-bg-subtle"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
