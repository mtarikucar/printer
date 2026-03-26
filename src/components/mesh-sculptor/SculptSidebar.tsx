"use client";

interface SculptSidebarProps {
  brushSize: number;
  brushStrength: number;
  undoCount: number;
  redoCount: number;
  saving: boolean;
  onSizeChange: (size: number) => void;
  onStrengthChange: (strength: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function SculptSidebar({
  brushSize,
  brushStrength,
  undoCount,
  redoCount,
  saving,
  onSizeChange,
  onStrengthChange,
  onUndo,
  onRedo,
  onSave,
}: SculptSidebarProps) {
  return (
    <div className="w-56 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      {/* Brush Settings */}
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-3">Brush Settings</h3>

        {/* Size */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Size</span>
            <span>{brushSize.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={brushSize}
            onChange={(e) => onSizeChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>[ / ]</span>
          </div>
        </div>

        {/* Strength */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Strength</span>
            <span>{(brushStrength * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={brushStrength}
            onChange={(e) => onStrengthChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-200 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500"
          />
        </div>
      </div>

      {/* Modifiers hint */}
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Modifiers</h3>
        <div className="space-y-1 text-[11px] text-gray-500">
          <div className="flex justify-between">
            <span>Smooth</span>
            <kbd className="px-1 rounded bg-gray-100 text-gray-600 text-[10px]">Shift</kbd>
          </div>
          <div className="flex justify-between">
            <span>Invert</span>
            <kbd className="px-1 rounded bg-gray-100 text-gray-600 text-[10px]">Ctrl</kbd>
          </div>
        </div>
      </div>

      {/* Undo / Redo */}
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">History</h3>
        <div className="flex gap-2">
          <button
            onClick={onUndo}
            disabled={undoCount === 0}
            className="flex-1 px-2 py-1.5 text-xs rounded bg-gray-50 text-gray-500 hover:bg-gray-100
              disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Undo ({undoCount})
          </button>
          <button
            onClick={onRedo}
            disabled={redoCount === 0}
            className="flex-1 px-2 py-1.5 text-xs rounded bg-gray-50 text-gray-500 hover:bg-gray-100
              disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Redo ({redoCount})
          </button>
        </div>
        <div className="text-[10px] text-gray-400 mt-1 text-center">
          Ctrl+Z / Ctrl+Shift+Z
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save */}
      <div className="p-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-emerald-600 text-white
            hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            "Save & Close"
          )}
        </button>
      </div>
    </div>
  );
}
