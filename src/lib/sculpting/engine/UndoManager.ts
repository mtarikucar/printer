import type { UndoSnapshot } from "./types";

export class UndoManager {
  private undoStack: UndoSnapshot[] = [];
  private redoStack: UndoSnapshot[] = [];
  private maxSteps: number;

  constructor(maxSteps: number = 50) {
    this.maxSteps = maxSteps;
  }

  /** Push a snapshot before a stroke begins */
  pushUndo(positions: Float32Array, maskValues: Float32Array): void {
    this.undoStack.push({
      positions: new Float32Array(positions),
      maskValues: new Float32Array(maskValues),
    });
    // Clear redo on new action
    this.redoStack.length = 0;
    // Evict oldest if over limit
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
  }

  /** Undo: returns the snapshot to restore, or null if nothing to undo */
  undo(
    currentPositions: Float32Array,
    currentMask: Float32Array
  ): UndoSnapshot | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return null;
    // Push current state to redo
    this.redoStack.push({
      positions: new Float32Array(currentPositions),
      maskValues: new Float32Array(currentMask),
    });
    return snapshot;
  }

  /** Redo: returns the snapshot to restore, or null if nothing to redo */
  redo(
    currentPositions: Float32Array,
    currentMask: Float32Array
  ): UndoSnapshot | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return null;
    // Push current state to undo
    this.undoStack.push({
      positions: new Float32Array(currentPositions),
      maskValues: new Float32Array(currentMask),
    });
    return snapshot;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
