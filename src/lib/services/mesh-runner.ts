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
import { join } from "node:path";
import { QUOTE_UNITS } from "@/lib/config/quote-types";
import type { PartGeometry, QuoteSourceFormat, QuoteUnits, Vec3 } from "@/lib/config/quote-types";

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min hard ceiling, then SIGKILL
/** Quote analysis is a customer waiting on a price, not a background render. */
const ANALYZE_TIMEOUT_MS = 300_000;
const VENV_PYTHON = "/opt/venv/bin/python3";

export class MeshProcessError extends Error {
  constructor(
    message: string,
    readonly code: "python_missing" | "exit_nonzero" | "timeout" | "bad_report" | "too_heavy",
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

// ─── Anlık teklif: parça analizi ────────────────────────────────────────────

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseVec3(value: unknown): Vec3 | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const z = finiteNumber(raw.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}

/**
 * Validate the Python report against the PartGeometry contract.
 *
 * Every key is checked, because a silently missing one becomes `undefined` in
 * the jsonb column and then NaN in the price — a wrong price is worse than a
 * failed analysis.
 */
function parseGeometry(raw: unknown): PartGeometry {
  const geometry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const invalid: string[] = [];

  const required = (key: string): number => {
    const value = finiteNumber(geometry[key]);
    if (value === null) invalid.push(key);
    return value ?? 0;
  };
  const nullable = (key: string): number | null => {
    if (!(key in geometry)) {
      invalid.push(key);
      return null;
    }
    const value = geometry[key];
    if (value === null) return null;
    const parsed = finiteNumber(value);
    if (parsed === null) invalid.push(key);
    return parsed;
  };
  const flag = (key: string): boolean => {
    if (typeof geometry[key] !== "boolean") invalid.push(key);
    return geometry[key] === true;
  };

  const extents = parseVec3(geometry.extents);
  if (extents === null) invalid.push("extents");

  let sourceUnits: QuoteUnits | null = null;
  if (!("sourceUnits" in geometry)) {
    invalid.push("sourceUnits");
  } else if (geometry.sourceUnits !== null) {
    const value = geometry.sourceUnits;
    if (typeof value === "string" && (QUOTE_UNITS as readonly string[]).includes(value)) {
      sourceUnits = value as QuoteUnits;
    } else {
      invalid.push("sourceUnits");
    }
  }

  const parsed: PartGeometry = {
    volume: nullable("volume"),
    area: required("area"),
    extents: extents ?? { x: 0, y: 0, z: 0 },
    bodyCount: required("bodyCount"),
    isWatertight: flag("isWatertight"),
    isVolume: flag("isVolume"),
    volumeEstimated: flag("volumeEstimated"),
    faceCount: required("faceCount"),
    wallP1: nullable("wallP1"),
    wallP5: nullable("wallP5"),
    overhangArea: required("overhangArea"),
    sourceUnits,
    objectCount: required("objectCount"),
  };

  if (invalid.length > 0) {
    throw new MeshProcessError(
      `Part analysis report has invalid fields: ${invalid.join(", ")}`,
      "bad_report"
    );
  }
  return parsed;
}

/** Enrich a nonzero exit with the failure code the script left in report.json. */
async function describeFailure(error: unknown, reportPath: string): Promise<unknown> {
  if (!(error instanceof MeshProcessError) || error.code !== "exit_nonzero") return error;
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      ok?: unknown;
      error?: unknown;
      message?: unknown;
    };
    if (report?.ok === false && typeof report.error === "string" && report.error) {
      const detail = typeof report.message === "string" ? `: ${report.message}` : "";
      return new MeshProcessError(
        `Part analysis failed (${report.error})${detail}`,
        // `quote_parts.analysis_error` yalnız bu KABA kodu saklar, python'un
        // kendi kodunu değil. "Parça bu konteyner için fazla ağır" ise müşteriye
        // ve admine "dosya bozuk"tan BAŞKA bir şey söylemek zorundadır: tek
        // çıkışı sadeleştirilmiş bir model ya da manuel teklif.
        report.error === "too_many_faces" ? "too_heavy" : "exit_nonzero",
        error.stderr
      );
    }
  } catch {
    /* no report, or not JSON — the original exit error is the best we have */
  }
  return error;
}

/**
 * Run scripts/analyze_quote_part.py and return the validated geometry.
 *
 * The script also writes `thumb.png`, `preview.glb` and `canonical.stl` into
 * `outDir`; the caller decides what to store. Geometry is in FILE UNITS at
 * scale 1 — millimetres are `scaledGeometry()`'s job, never this one's.
 */
export async function runAnalyzeQuotePart(args: {
  inputPath: string;
  format: QuoteSourceFormat;
  outDir: string;
  timeoutMs?: number;
  onLog?: (line: string) => void;
}): Promise<{ geometry: PartGeometry }> {
  const python = await resolvePython();
  const reportPath = join(args.outDir, "report.json");
  // Absolute: the worker process does not always start in /app.
  const script = join(process.cwd(), "scripts", "analyze_quote_part.py");

  try {
    await runScript(
      python,
      [script, args.inputPath, args.format, args.outDir],
      args.timeoutMs ?? ANALYZE_TIMEOUT_MS,
      args.onLog
    );
  } catch (err) {
    throw await describeFailure(err, reportPath);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (err) {
    throw new MeshProcessError(
      "Part analysis report is missing or unreadable",
      "bad_report",
      String(err)
    );
  }
  const report = parsed as { ok?: unknown; geometry?: unknown };
  if (report?.ok !== true) {
    throw new MeshProcessError("Part analysis report is not a success report", "bad_report");
  }
  return { geometry: parseGeometry(report.geometry) };
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
