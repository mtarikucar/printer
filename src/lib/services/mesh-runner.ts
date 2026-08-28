/**
 * TypeScript → Python bridge for the mesh toolchain.
 *
 * There is no existing bridge in this repo: `scripts/process_mesh.py` has been
 * dead code with no caller since the Meshy removal in July 2026.
 *
 * The interpreter is resolved explicitly. The Docker image installs trimesh /
 * pymeshlab / manifold3d into /opt/venv and puts it first on PATH; invoking a
 * bare `python3` works only as long as nobody edits that ENV line, and fails
 * with a misleading ImportError when it is edited or when the worker runs
 * outside Docker.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min hard ceiling, then SIGKILL
const VENV_PYTHON = "/opt/venv/bin/python3";

export class MeshProcessError extends Error {
  constructor(
    message: string,
    readonly code: "python_missing" | "exit_nonzero" | "timeout" | "bad_report",
    readonly stderr?: string
  ) {
    super(message);
    this.name = "MeshProcessError";
  }
}

async function resolvePython(): Promise<string> {
  const explicit = process.env.MESH_PYTHON;
  if (explicit) return explicit;
  try {
    await access(VENV_PYTHON, constants.X_OK);
    return VENV_PYTHON;
  } catch {
    return "python3";
  }
}

function runScript(
  python: string,
  args: string[],
  timeoutMs: number,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (stdout && onLog) onLog(stdout.trim());
        if (stderr && onLog) onLog(`[stderr] ${stderr.trim()}`);
        if (!error) return resolve();
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new MeshProcessError(`Python not found at ${python}`, "python_missing"));
        }
        if ((error as { killed?: boolean }).killed) {
          return reject(new MeshProcessError(`Mesh job exceeded ${timeoutMs}ms`, "timeout", stderr));
        }
        reject(
          new MeshProcessError(
            `Mesh job exited ${(error as { code?: number }).code ?? "?"}`,
            "exit_nonzero",
            stderr?.slice(0, 4000)
          )
        );
      }
    );
    child.on("error", () => {
      /* handled by the callback above */
    });
  });
}

export interface RawMeshReport {
  is_watertight: boolean;
  is_volume: boolean;
  vertex_count: number;
  face_count: number;
  component_count: number;
  bounding_box: { min: number[]; max: number[]; size: number[] };
  volume_cm3: number;
  fill_ratio: number;
  base_added: boolean;
  repairs_applied: string[];
  dropped_significant_component: boolean;
  merged_component_count: number;
  min_wall_p1_mm: number | null;
  min_wall_p5_mm: number | null;
  target_height_mm: number;
  measured_height_mm: number;
  material: "resin" | "filament";
  processing_time_seconds: number;
}

/** Run scripts/process_mesh.py and return the parsed report. */
export async function runProcessMesh(args: {
  inputPath: string;
  outputStlPath: string;
  reportPath: string;
  heightMm: number;
  material: "resin" | "filament";
  timeoutMs?: number;
  onLog?: (line: string) => void;
}): Promise<RawMeshReport> {
  const python = await resolvePython();
  await runScript(
    python,
    [
      "scripts/process_mesh.py",
      args.inputPath,
      args.outputStlPath,
      args.reportPath,
      "--height-mm",
      String(args.heightMm),
      "--material",
      args.material,
    ],
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    args.onLog
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(args.reportPath, "utf8"));
  } catch (err) {
    throw new MeshProcessError("Mesh report is missing or unreadable", "bad_report", String(err));
  }
  const report = parsed as RawMeshReport;
  if (typeof report?.face_count !== "number" || !report?.bounding_box) {
    throw new MeshProcessError("Mesh report has unexpected shape", "bad_report");
  }
  return report;
}

/**
 * Render the customer-facing turntable. NON-FATAL by contract: if this fails we
 * still have Meshy's single thumbnail, and an approval message with a still
 * image beats no approval message at all.
 */
export async function runRenderTurntable(args: {
  inputPath: string;
  outputMp4Path: string;
  frames?: number;
  size?: number;
  timeoutMs?: number;
  onLog?: (line: string) => void;
}): Promise<boolean> {
  try {
    const python = await resolvePython();
    await runScript(
      python,
      [
        "scripts/render_turntable.py",
        args.inputPath,
        args.outputMp4Path,
        "--frames",
        String(args.frames ?? 24),
        "--size",
        String(args.size ?? 480),
      ],
      args.timeoutMs ?? 180_000,
      args.onLog
    );
    return true;
  } catch (err) {
    args.onLog?.(`[turntable] skipped: ${(err as Error).message}`);
    return false;
  }
}
