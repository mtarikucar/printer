#!/usr/bin/env python3
"""Smoke test for scripts/analyze_quote_part.py (the instant-quote geometry CLI).

Usage:  $MESH_PYTHON scripts/test-analyze-quote-part.py

Runs the CLI exactly as the BullMQ worker does (input, format, out dir) against
the committed fixtures and checks the report contract, the measured numbers and
the three side files (thumb.png, preview.glb, canonical.stl).

The expected key set is READ OUT OF `src/lib/config/quote-types.ts`, so a key
renamed on the TypeScript side fails here instead of silently producing a report
no consumer can read. The STEP cases read `src/lib/config/quote-step.ts` the same
way: STEP parts are priced from a mesh WE produce, so the deflection the report
carries must be the one the shipped constant documents.
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
import trimesh
from PIL import Image

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
CLI = os.path.join(SCRIPTS_DIR, "analyze_quote_part.py")
sys.path.insert(0, SCRIPTS_DIR)
# The precheck is also exercised directly: the point of it is that the estimate
# is an UPPER BOUND on the triangles trimesh produces, and the only way to
# assert that is to compare it with the loaded mesh.
import analyze_quote_part  # noqa: E402
FIXTURES = os.path.join(SCRIPTS_DIR, "fixtures", "quote")
QUOTE_TYPES_TS = os.path.join(REPO_ROOT, "src", "lib", "config", "quote-types.ts")
QUOTE_STEP_TS = os.path.join(REPO_ROOT, "src", "lib", "config", "quote-step.ts")
# cylinder_r10h20.step: π × 10² × 20. The tessellation budget is the only
# OBJECTIVE number in this file that the price depends on directly.
CYLINDER_VOLUME_MM3 = 6283.185307
CYLINDER_TOLERANCE_PCT = 0.2
# render_turntable.BG_RGB — anything else in the image is the model.
BG_RGB = np.array([246, 246, 248], dtype=np.uint8)

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {label}{'' if ok else f' ({detail})'}")
    if not ok:
        failures.append(label)


def near(actual: object, expected: float, tolerance: float) -> bool:
    return isinstance(actual, (int, float)) and abs(actual - expected) <= tolerance


def contract_keys() -> set[str]:
    """The PartGeometry key set, parsed from the shared TypeScript contract."""
    with open(QUOTE_TYPES_TS) as handle:
        source = handle.read()
    body = re.search(r"export interface PartGeometry \{(.*?)\n\}", source, re.S)
    if body is None:
        raise SystemExit(f"PartGeometry interface not found in {QUOTE_TYPES_TS}")
    return set(re.findall(r"^  (\w+)\??:", body.group(1), re.M))


def step_tessellation() -> dict:
    """STEP_TESSELLATION, parsed from the shared TypeScript constant.

    A STEP part is priced from a mesh that did not exist before we tessellated
    it, so the deflection IS an input to the price. Reading the three numbers out
    of src/lib/config/quote-step.ts and comparing them with what the pipeline
    reported is what keeps the documented constant and the produced mesh from
    drifting apart (the frozen price would otherwise be computed from a mesh no
    shipped constant describes).
    """
    with open(QUOTE_STEP_TS) as handle:
        source = handle.read()
    body = re.search(r"export const STEP_TESSELLATION = \{(.*?)\n\}", source, re.S)
    if body is None:
        raise SystemExit(f"STEP_TESSELLATION not found in {QUOTE_STEP_TS}")
    fields = dict(re.findall(r"^\s*(\w+):\s*([^,\n]+),", body.group(1), re.M))
    return {
        "deflectionMm": float(fields["deflectionMm"]),
        "angularRad": float(fields["angularRad"]),
        "relative": fields["relative"] == "true",
    }


def check_contract(label: str, geometry: dict, keys: set[str]) -> None:
    """The report carries EXACTLY the PartGeometry keys — no more, no fewer.

    `parseGeometry` (src/lib/services/mesh-runner.ts) reads every key and throws
    `bad_report` on a missing one, deliberately: a key that is silently absent
    lands in the jsonb column as `undefined` and then as NaN in the price. So a
    field added for STEP has to be written as `null` by the mesh formats too, and
    this check runs on every format for exactly that reason.
    """
    missing = sorted(keys - geometry.keys())
    extra = sorted(geometry.keys() - keys)
    check(f"{label}: geometry matches PartGeometry key for key",
          not missing and not extra, f"missing={missing} extra={extra}")


def check_no_tessellation(label: str, geometry: dict) -> None:
    """A mesh format brings its own triangles; nothing was tessellated for it."""
    check(f"{label}: tessellation and solidCount are null (no kernel involved)",
          geometry.get("tessellation") is None and geometry.get("solidCount") is None,
          f"tessellation={geometry.get('tessellation')} solidCount={geometry.get('solidCount')}")


def analyze(
    fixture: str, fmt: str, workdir: str, *extra: str, source: str | None = None
) -> tuple[dict | None, str]:
    outdir = os.path.join(workdir, fixture.replace(".", "-"))
    proc = subprocess.run(
        [sys.executable, CLI, source or os.path.join(FIXTURES, fixture), fmt, outdir, *extra],
        capture_output=True,
        text=True,
        timeout=300,
    )
    check(f"{fixture}: exit 0", proc.returncode == 0, proc.stderr.strip()[-600:])
    report_path = os.path.join(outdir, "report.json")
    if not os.path.exists(report_path):
        check(f"{fixture}: report.json written", False, "missing")
        return None, outdir
    with open(report_path) as handle:
        report = json.load(handle)
    check(f"{fixture}: report ok", report.get("ok") is True, json.dumps(report)[:300])
    return report, outdir


def check_thumb(label: str, outdir: str, size: int) -> None:
    path = os.path.join(outdir, "thumb.png")
    if not os.path.exists(path):
        check(f"{label}: thumb.png written", False, "missing")
        return
    with Image.open(path) as img:
        check(f"{label}: thumb.png is a {size}×{size} PNG",
              img.format == "PNG" and img.size == (size, size), f"{img.format} {img.size}")
        pixels = np.asarray(img.convert("RGB"))
    model_pixels = int((pixels != BG_RGB).any(axis=2).sum())
    check(f"{label}: thumb.png shows the model", model_pixels > size * size * 0.05,
          f"{model_pixels} non-background pixels")


def main() -> int:
    keys = contract_keys()
    check("PartGeometry contract parsed from quote-types.ts", len(keys) >= 13, f"keys={sorted(keys)}")

    with tempfile.TemporaryDirectory(prefix="analyze-quote-part-") as workdir:
        # ── cube20.stl: the reference part, every output checked ──────────────
        report, outdir = analyze("cube20.stl", "stl", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check_contract("cube20.stl", geometry, keys)
            check_no_tessellation("cube20.stl", geometry)
            check("cube20.stl: volume 8000", near(geometry.get("volume"), 8000.0, 1.0),
                  f"volume={geometry.get('volume')}")
            check("cube20.stl: area 2400", near(geometry.get("area"), 2400.0, 1.0),
                  f"area={geometry.get('area')}")
            ext = geometry.get("extents") or {}
            check("cube20.stl: extents 20 × 20 × 20",
                  all(near(ext.get(axis), 20.0, 0.01) for axis in ("x", "y", "z")), f"extents={ext}")
            check("cube20.stl: bodyCount 1", geometry.get("bodyCount") == 1,
                  f"bodyCount={geometry.get('bodyCount')}")
            check("cube20.stl: isWatertight true", geometry.get("isWatertight") is True,
                  f"isWatertight={geometry.get('isWatertight')}")
            check("cube20.stl: isVolume true and volume measured, not estimated",
                  geometry.get("isVolume") is True and geometry.get("volumeEstimated") is False,
                  f"isVolume={geometry.get('isVolume')} volumeEstimated={geometry.get('volumeEstimated')}")
            check("cube20.stl: faceCount 12 (full resolution, not decimated)",
                  geometry.get("faceCount") == 12, f"faceCount={geometry.get('faceCount')}")
            check("cube20.stl: wallP1/P5 are the 20 mm side",
                  near(geometry.get("wallP1"), 20.0, 0.01) and near(geometry.get("wallP5"), 20.0, 0.01),
                  f"wallP1={geometry.get('wallP1')} wallP5={geometry.get('wallP5')}")
            check("cube20.stl: overhangArea 0 (the bottom face is not an overhang)",
                  near(geometry.get("overhangArea"), 0.0, 1e-6),
                  f"overhangArea={geometry.get('overhangArea')}")
            check("cube20.stl: STL carries no units", geometry.get("sourceUnits") is None,
                  f"sourceUnits={geometry.get('sourceUnits')}")
            check("cube20.stl: objectCount 1", geometry.get("objectCount") == 1,
                  f"objectCount={geometry.get('objectCount')}")

            check_thumb("cube20.stl", outdir, 512)

            glb_path = os.path.join(outdir, "preview.glb")
            if os.path.exists(glb_path):
                preview = trimesh.load(glb_path, force="mesh")
                check("cube20.stl: preview.glb loads with trimesh",
                      isinstance(preview, trimesh.Trimesh) and len(preview.faces) > 0,
                      f"{type(preview).__name__}")
            else:
                check("cube20.stl: preview.glb written", False, "missing")

            stl_path = os.path.join(outdir, "canonical.stl")
            if os.path.exists(stl_path):
                with open(stl_path, "rb") as handle:
                    head = handle.read(6)
                canonical = trimesh.load(stl_path, force="mesh")
                check("cube20.stl: canonical.stl is binary STL", head[:5] != b"solid", f"head={head!r}")
                check("cube20.stl: canonical.stl keeps volume and size",
                      near(float(abs(canonical.volume)), 8000.0, 1.0)
                      and near(float(max(canonical.extents)), 20.0, 0.01),
                      f"volume={float(abs(canonical.volume))} extents={canonical.extents}")
            else:
                check("cube20.stl: canonical.stl written", False, "missing")

        # ── cube20.obj: same cube, Y-up source ───────────────────────────────
        report, outdir = analyze("cube20.obj", "obj", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            ext = geometry.get("extents") or {}
            check("cube20.obj: same metrics as the STL cube",
                  near(geometry.get("volume"), 8000.0, 1.0)
                  and near(geometry.get("area"), 2400.0, 1.0)
                  and all(near(ext.get(axis), 20.0, 0.01) for axis in ("x", "y", "z"))
                  and geometry.get("bodyCount") == 1
                  and geometry.get("isWatertight") is True,
                  json.dumps(geometry))
            check("cube20.obj: OBJ carries no units", geometry.get("sourceUnits") is None,
                  f"sourceUnits={geometry.get('sourceUnits')}")
            check_contract("cube20.obj", geometry, keys)
            check_no_tessellation("cube20.obj", geometry)

        # ── two_bodies.stl: shells are counted, never merged or dropped ──────
        report, _ = analyze("two_bodies.stl", "stl", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("two_bodies.stl: bodyCount 2", geometry.get("bodyCount") == 2,
                  f"bodyCount={geometry.get('bodyCount')}")
            check("two_bodies.stl: both bodies kept in the volume",
                  near(geometry.get("volume"), 2000.0, 1.0), f"volume={geometry.get('volume')}")

        # The two ceilings are INDEPENDENT. Wall ceiling below the face count:
        # walls are dropped, the body count still comes from split().
        report, _ = analyze("two_bodies.stl", "stl", workdir + "/capped", "--max-faces-walls", "5")
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("two_bodies.stl (walls capped): walls skipped",
                  geometry.get("wallP1") is None and geometry.get("wallP5") is None,
                  f"wallP1={geometry.get('wallP1')} wallP5={geometry.get('wallP5')}")
            check("two_bodies.stl (walls capped): bodyCount still 2",
                  geometry.get("bodyCount") == 2, f"bodyCount={geometry.get('bodyCount')}")

        # Body ceiling below the face count, wall ceiling left at its default:
        # the connected-components path counts the same 2 shells and the walls
        # are still measured — neither flag reaches into the other's decision.
        report, _ = analyze(
            "two_bodies.stl", "stl", workdir + "/bodies-capped", "--max-faces-bodies", "5"
        )
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("two_bodies.stl (bodies capped): bodyCount still 2",
                  geometry.get("bodyCount") == 2, f"bodyCount={geometry.get('bodyCount')}")
            check("two_bodies.stl (bodies capped): walls still measured",
                  near(geometry.get("wallP1"), 10.0, 0.01) and near(geometry.get("wallP5"), 10.0, 0.01),
                  f"wallP1={geometry.get('wallP1')} wallP5={geometry.get('wallP5')}")

        # ── open_box.stl: not watertight, volume only as an estimate ─────────
        report, _ = analyze("open_box.stl", "stl", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("open_box.stl: isWatertight false", geometry.get("isWatertight") is False,
                  f"isWatertight={geometry.get('isWatertight')}")
            check("open_box.stl: volume is null or flagged as estimated",
                  geometry.get("volume") is None or geometry.get("volumeEstimated") is True,
                  f"volume={geometry.get('volume')} volumeEstimated={geometry.get('volumeEstimated')}")

        # ── cube1in.3mf: the unit is REPORTED, the mesh is NOT rescaled ──────
        report, outdir = analyze("cube1in.3mf", "3mf", workdir, "--thumb-size", "256")
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("cube1in.3mf: sourceUnits in", geometry.get("sourceUnits") == "in",
                  f"sourceUnits={geometry.get('sourceUnits')}")
            ext = geometry.get("extents") or {}
            check("cube1in.3mf: extents stay 1 (no rescaling in Python)",
                  all(near(ext.get(axis), 1.0, 0.001) for axis in ("x", "y", "z")), f"extents={ext}")
            check("cube1in.3mf: volume 1", near(geometry.get("volume"), 1.0, 0.001),
                  f"volume={geometry.get('volume')}")
            check("cube1in.3mf: objectCount 1", geometry.get("objectCount") == 1,
                  f"objectCount={geometry.get('objectCount')}")
            check_contract("cube1in.3mf", geometry, keys)
            check_no_tessellation("cube1in.3mf", geometry)
            check_thumb("cube1in.3mf (--thumb-size 256)", outdir, 256)

        # ── STEP: the branch that MAKES the mesh it measures ─────────────────
        # Every other format hands us triangles; STEP hands us surfaces, and the
        # child process (scripts/step_mesh.py, OCCT) turns them into triangles
        # with the parameters below. So for STEP the tessellation IS an input to
        # the price, and the unit is the file's own: ISO 10303 writes the length
        # unit into the file and the kernel applies it (cascadio emits metres,
        # the child scales ×1000) — nothing here assumes millimetres.
        tessellation = step_tessellation()
        report, outdir = analyze("cube20.step", "step", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check_contract("cube20.step", geometry, keys)
            check("cube20.step: volume 8000 mm³", near(geometry.get("volume"), 8000.0, 10.0),
                  f"volume={geometry.get('volume')}")
            ext = geometry.get("extents") or {}
            check("cube20.step: extents 20 × 20 × 20 mm",
                  all(near(ext.get(axis), 20.0, 0.01) for axis in ("x", "y", "z")),
                  f"extents={ext}")
            check("cube20.step: sourceUnits mm (read from the file, not assumed)",
                  geometry.get("sourceUnits") == "mm", f"sourceUnits={geometry.get('sourceUnits')}")
            check("cube20.step: tessellation is the shipped STEP_TESSELLATION",
                  geometry.get("tessellation") == tessellation,
                  f"report={geometry.get('tessellation')} quote-step.ts={tessellation}")
            check("cube20.step: solidCount 1 (from the kernel's product structure)",
                  geometry.get("solidCount") == 1, f"solidCount={geometry.get('solidCount')}")
            check("cube20.step: objectCount follows the solid count",
                  geometry.get("objectCount") == 1, f"objectCount={geometry.get('objectCount')}")
            # Vertex welding is part of the conversion: OCCT triangulates face by
            # face, so an unwelded cube reads as NOT watertight and the
            # manufacturer would receive an STL full of seams.
            check("cube20.step: isWatertight true (the conversion welded the vertices)",
                  geometry.get("isWatertight") is True,
                  f"isWatertight={geometry.get('isWatertight')}")
            stl_path = os.path.join(outdir, "canonical.stl")
            if os.path.exists(stl_path):
                with open(stl_path, "rb") as handle:
                    head = handle.read(6)
                canonical = trimesh.load(stl_path, force="mesh")
                # The manufacturer's file must be the geometry the price was
                # measured on, in millimetres, not the STEP we cannot slice.
                check("cube20.step: canonical.stl is a binary STL in mm",
                      head[:5] != b"solid"
                      and near(float(abs(canonical.volume)), 8000.0, 10.0)
                      and near(float(max(canonical.extents)), 20.0, 0.01),
                      f"head={head!r} volume={float(abs(canonical.volume))} "
                      f"extents={canonical.extents}")
            else:
                check("cube20.step: canonical.stl written", False, "missing")

        # cube1in.step declares INCH and carries a 1-unit cube: 25.4 mm is the
        # proof that the file's unit is applied and mm is never assumed.
        report, _ = analyze("cube1in.step", "step", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            ext = geometry.get("extents") or {}
            check("cube1in.step: extents 25.4 mm (the file's INCH unit was applied)",
                  all(near(ext.get(axis), 25.4, 0.01) for axis in ("x", "y", "z")),
                  f"extents={ext}")
            check("cube1in.step: sourceUnits still mm (the kernel converted it)",
                  geometry.get("sourceUnits") == "mm", f"sourceUnits={geometry.get('sourceUnits')}")

        # bracket_asym.step is 10 × 20 × 40 in the STEP file. The axes must come
        # out in the SAME order: glTF is Y-up and the OBJ branch rotates for that
        # reason, so whether this path needs the same rotation is a MEASURED
        # question (S1 §2.5: it does not — the part arrives Z-up).
        report, _ = analyze("bracket_asym.step", "step", workdir)
        if report and report.get("ok"):
            ext = (report.get("geometry") or {}).get("extents") or {}
            check("bracket_asym.step: extents (10, 20, 40) on the SAME axes (no Y↔Z swap)",
                  near(ext.get("x"), 10.0, 0.01) and near(ext.get("y"), 20.0, 0.01)
                  and near(ext.get("z"), 40.0, 0.01),
                  f"extents={ext} (a Y-up rotation would give 10, 40, 20)")

        # two_bodies.step is a real STEP assembly (3 PRODUCTs, 2 solids). The two
        # counts must AGREE: bodyCount is counted on the triangles, solidCount is
        # the kernel's product structure, and if they disagree the conversion
        # merged bodies the quote has to price separately.
        report, _ = analyze("two_bodies.step", "step", workdir)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("two_bodies.step: bodyCount 2 and solidCount 2 agree",
                  geometry.get("bodyCount") == 2 and geometry.get("solidCount") == 2,
                  f"bodyCount={geometry.get('bodyCount')} solidCount={geometry.get('solidCount')}")
            check("two_bodies.step: objectCount 2", geometry.get("objectCount") == 2,
                  f"objectCount={geometry.get('objectCount')}")

        # The deflection budget, measured against an analytic volume. This is the
        # single objective check on the tessellation constant: at the design's
        # proposed 0.05 mm the same cylinder loses 0.325 % of its volume, i.e. it
        # would be under-priced by more than the accepted budget.
        report, _ = analyze("cylinder_r10h20.step", "step", workdir)
        if report and report.get("ok"):
            volume = (report.get("geometry") or {}).get("volume")
            error_pct = (
                abs(volume - CYLINDER_VOLUME_MM3) / CYLINDER_VOLUME_MM3 * 100.0
                if isinstance(volume, (int, float)) else None
            )
            check(f"cylinder_r10h20.step: volume within {CYLINDER_TOLERANCE_PCT} % of "
                  f"{CYLINDER_VOLUME_MM3:.2f} mm³",
                  error_pct is not None and error_pct < CYLINDER_TOLERANCE_PCT,
                  f"volume={volume} error={error_pct}%")

        # ── the B-rep precheck refuses BEFORE the kernel reserves anything ────
        # cube20.step declares 6 ADVANCED_FACE entities; a ceiling of 5 must
        # refuse it from the BYTES, with its own code, and leave no output — the
        # whole point is that OCCT never runs (at the real ceiling it costs
        # 39.6 s and 1.6 GiB to find out).
        outdir = os.path.join(workdir, "step-too-complex")
        proc = subprocess.run(
            [sys.executable, CLI, os.path.join(FIXTURES, "cube20.step"), "step", outdir,
             "--max-brep-faces", "5"],
            capture_output=True, text=True, timeout=300,
        )
        check("STEP over --max-brep-faces: exit 2", proc.returncode == 2,
              f"exit={proc.returncode} {proc.stderr.strip()[-200:]}")
        report_path = os.path.join(outdir, "report.json")
        if os.path.exists(report_path):
            with open(report_path) as handle:
                report = json.load(handle)
            check("STEP over --max-brep-faces: refused as step_too_complex",
                  report.get("ok") is False and report.get("error") == "step_too_complex",
                  json.dumps(report)[:300])
        else:
            check("STEP over --max-brep-faces: failure report written", False,
                  "missing report.json")
        check("STEP over --max-brep-faces: nothing was converted",
              not os.path.exists(os.path.join(outdir, "canonical.stl")),
              "canonical.stl was written, so the kernel ran anyway")

        # ── a STEP the kernel cannot read gets the OTHER code ────────────────
        # The child returns exit 2 with its own verdict; the parent has to carry
        # that verdict into report.json, because that is what lets the analysis
        # give up after MAX_ANALYSIS_ATTEMPTS instead of re-queueing forever.
        with open(os.path.join(FIXTURES, "cube20.step"), "rb") as handle:
            whole_step = handle.read()
        broken_step = os.path.join(workdir, "truncated.step")
        with open(broken_step, "wb") as handle:
            # Half a STEP: the HEADER (with its author/organisation fields) is
            # intact, the DATA section is cut in the middle of the geometry.
            handle.write(whole_step[: len(whole_step) // 2])
        outdir = os.path.join(workdir, "step-unreadable")
        proc = subprocess.run(
            [sys.executable, CLI, broken_step, "step", outdir],
            capture_output=True, text=True, timeout=300,
        )
        check("truncated STEP: exit 2", proc.returncode == 2,
              f"exit={proc.returncode} {proc.stderr.strip()[-200:]}")
        report_path = os.path.join(outdir, "report.json")
        if os.path.exists(report_path):
            with open(report_path) as handle:
                report = json.load(handle)
            check("truncated STEP: the child's step_unreadable reaches report.json",
                  report.get("ok") is False and report.get("error") == "step_unreadable",
                  json.dumps(report)[:300])
        else:
            check("truncated STEP: failure report written", False, "missing report.json")
        # KVKK: OCCT's parser diagnostics quote the offending SOURCE LINE, which
        # in a STEP can be a HEADER line carrying the designer's name, company or
        # local path. Nothing from the file may appear in what we log or store.
        check("truncated STEP: no OCCT parser noise and no header token leaked",
              "ERR StepFile" not in (proc.stdout + proc.stderr)
              and "figurunica" not in (proc.stdout + proc.stderr).lower(),
              f"stdout={proc.stdout.strip()[-200:]} stderr={proc.stderr.strip()[-200:]}")

        # ── generated sphere: the down-facing area is really measured ────────
        # The cube above proves the plate footprint is excluded (overhang 0);
        # a sphere proves the rest of the rule works. Everything steeper than
        # 45° is the spherical cap 2πr²(1−cos45°) = 184.03 mm², minus the
        # sliver inside the 0.01 × height floor band.
        sphere_path = os.path.join(workdir, "sphere-source.stl")
        trimesh.creation.icosphere(subdivisions=4, radius=10.0).export(sphere_path)
        report, _ = analyze("sphere.stl", "stl", workdir, source=sphere_path)
        if report and report.get("ok"):
            geometry = report.get("geometry") or {}
            check("sphere: overhangArea is the sub-45° cap (184 mm²)",
                  near(geometry.get("overhangArea"), 184.03, 10.0),
                  f"overhangArea={geometry.get('overhangArea')}")

        # ── failure path: exit 2 plus a machine-readable report ──────────────
        broken = os.path.join(workdir, "broken.stl")
        with open(broken, "wb") as handle:
            handle.write(b"this is not a mesh" * 16)
        outdir = os.path.join(workdir, "broken-out")
        proc = subprocess.run(
            [sys.executable, CLI, broken, "stl", outdir],
            capture_output=True, text=True, timeout=120,
        )
        check("broken.stl: exit 2", proc.returncode == 2, f"exit={proc.returncode}")
        report_path = os.path.join(outdir, "report.json")
        if os.path.exists(report_path):
            with open(report_path) as handle:
                report = json.load(handle)
            check("broken.stl: report says ok false with an error code",
                  report.get("ok") is False and isinstance(report.get("error"), str)
                  and bool(report.get("error")) and isinstance(report.get("message"), str),
                  json.dumps(report)[:300])
        else:
            check("broken.stl: failure report written", False, "missing report.json")

        # ── the RLIMIT_AS ceiling is a flag, not a number baked into the file ─
        # A deployment that wants a tighter ceiling than the measured default
        # passes it in; an implausible one is refused with the documented
        # exit 2 instead of dying inside an allocation later on.
        report, _ = analyze(
            "cube20.stl", "stl", workdir + "/as-limit", "--max-address-space-gb", "6"
        )
        if report:
            check("cube20.stl (--max-address-space-gb 6): report ok", report.get("ok") is True,
                  json.dumps(report)[:200])
        proc = subprocess.run(
            [sys.executable, CLI, os.path.join(FIXTURES, "cube20.stl"), "stl",
             os.path.join(workdir, "as-limit-bad"), "--max-address-space-gb", "0.5"],
            capture_output=True, text=True, timeout=120,
        )
        check("--max-address-space-gb 0.5 is refused with exit 2", proc.returncode == 2,
              f"exit={proc.returncode} {proc.stderr.strip()[-200:]}")

        # ── face-count precheck: refused BEFORE the mesh is loaded ───────────
        # The worker container is capped at 2 GB and the mesh is measured at
        # full resolution, so a file that is small on disk but dense in
        # triangles must be refused with its own code instead of being
        # OOM-killed mid-allocation (no report.json, generic error, and a job
        # the sweeper re-queues every 20 minutes).
        dense = os.path.join(workdir, "dense-source.stl")
        # icosphere(4) = 20 × 4⁴ = 5120 faces, written as a binary STL, so the
        # estimate is read exactly out of the 84-byte header.
        trimesh.creation.icosphere(subdivisions=4, radius=10.0).export(dense)
        outdir = os.path.join(workdir, "too-many-faces")
        proc = subprocess.run(
            [sys.executable, CLI, dense, "stl", outdir, "--max-input-faces", "1000"],
            capture_output=True, text=True, timeout=120,
        )
        check("dense part over --max-input-faces: exit 2", proc.returncode == 2,
              f"exit={proc.returncode} {proc.stderr.strip()[-200:]}")
        report_path = os.path.join(outdir, "report.json")
        if os.path.exists(report_path):
            with open(report_path) as handle:
                report = json.load(handle)
            check("dense part: its own error code (not a generic load failure)",
                  report.get("ok") is False and report.get("error") == "too_many_faces",
                  json.dumps(report)[:300])
        else:
            check("dense part: failure report written", False, "missing report.json")
        # Nothing heavy ran: the refusal happens before load_part, so none of
        # the side files exist.
        check("dense part: stopped before writing any output file",
              not os.path.exists(os.path.join(outdir, "canonical.stl")),
              "canonical.stl was written, so the mesh was loaded anyway")
        # …and the same file passes with a ceiling above its face count.
        report, _ = analyze(
            "cube20.stl", "stl", workdir + "/faces-ok", "--max-input-faces", "20000"
        )
        if report:
            check("cube20.stl (--max-input-faces 20000): report ok", report.get("ok") is True,
                  json.dumps(report)[:200])

        # ── the estimate is an UPPER BOUND on triangles, not a line count ────
        # An OBJ `f` line is one face ELEMENT: trimesh fans a quad into two
        # triangles while loading, so counting face lines under-counts a quad
        # mesh (the default Blender/Maya export) exactly 2× and lets an
        # OOM-sized part past the ceiling.
        quad_cube = os.path.join(workdir, "quad-cube.obj")
        with open(quad_cube, "w") as handle:
            for x, y, z in [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
                            (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]:
                handle.write(f"v {x} {y} {z}\n")
            for quad in ("1 2 3 4", "5 6 7 8", "1 2 6 5",
                         "2 3 7 6", "3 4 8 7", "4 1 5 8"):
                handle.write(f"f {quad}\n")
        estimated, truncated = analyze_quote_part.estimate_face_count(quad_cube, "obj")
        loaded = len(trimesh.load(quad_cube, force="mesh").faces)
        check("quad OBJ: estimate is an upper bound on the loaded triangles",
              estimated is not None and not truncated and estimated >= loaded,
              f"estimate={estimated} truncated={truncated} loaded={loaded} "
              "(6 face lines, 12 triangles)")
        check("quad OBJ: estimate is not the face-line count",
              estimated == 12, f"estimate={estimated}, expected 12")

        # The failure this closes, end to end: a quad OBJ that is small on disk
        # and has FEWER face lines than the ceiling, but more triangles than
        # the 2 GB worker can hold. It must be refused, not loaded.
        quads = 800_000  # → 1.6M triangles, 800k face lines, ~8 MB on disk
        dense_obj = os.path.join(workdir, "dense-quads.obj")
        with open(dense_obj, "wb") as handle:
            handle.write(b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n")
            handle.write(b"f 1 2 3 4\n" * quads)
        size_mb = os.path.getsize(dense_obj) / 1024 / 1024
        check("dense quad OBJ fixture is inside the advertised upload ceiling",
              size_mb < 32, f"{size_mb:.1f} MB")
        check("dense quad OBJ has fewer face LINES than the ceiling "
              "(what the old estimate counted)",
              quads < 1_500_000, f"{quads} face lines")
        outdir = os.path.join(workdir, "dense-quads")
        proc = subprocess.run(
            [sys.executable, CLI, dense_obj, "obj", outdir,
             "--max-input-faces", "1500000"],
            capture_output=True, text=True, timeout=120,
        )
        check("dense quad OBJ over the triangle ceiling: exit 2", proc.returncode == 2,
              f"exit={proc.returncode} {proc.stderr.strip()[-200:]}")
        report_path = os.path.join(outdir, "report.json")
        if os.path.exists(report_path):
            with open(report_path) as handle:
                report = json.load(handle)
            check("dense quad OBJ: refused as too_many_faces before load",
                  report.get("ok") is False and report.get("error") == "too_many_faces",
                  json.dumps(report)[:300])
        else:
            check("dense quad OBJ: failure report written", False, "missing report.json")

        # ── STL byte bounds ─────────────────────────────────────────────────
        # A binary STL whose declared count no longer matches the file size
        # (trailing bytes) falls back to the byte ceiling, which must still sit
        # above the real facet count.
        sphere = trimesh.creation.icosphere(subdivisions=3, radius=5.0)
        trailing = os.path.join(workdir, "trailing.stl")
        sphere.export(trailing)
        check("binary STL: header count read exactly",
              analyze_quote_part.estimate_face_count(trailing, "stl")
              == (len(sphere.faces), False),
              f"{analyze_quote_part.estimate_face_count(trailing, 'stl')} vs {len(sphere.faces)}")
        with open(trailing, "ab") as handle:
            handle.write(b"\x00" * 7)
        estimated, _ = analyze_quote_part.estimate_face_count(trailing, "stl")
        check("binary STL with trailing bytes: still an upper bound",
              estimated is not None and estimated >= len(sphere.faces),
              f"estimate={estimated} facets={len(sphere.faces)}")
        # …and an ASCII STL written at the 86-byte floor (single spaces,
        # one-character numbers, no indentation) must not out-run the bound.
        facet = ("facet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 0 0 0\n"
                 "vertex 0 0 0\nendloop\nendfacet\n")
        check("the assumed ASCII facet floor is the real one",
              len(facet) == analyze_quote_part.ASCII_STL_MIN_FACET_BYTES,
              f"{len(facet)} vs {analyze_quote_part.ASCII_STL_MIN_FACET_BYTES}")
        ascii_stl = os.path.join(workdir, "floor.stl")
        facets = 4000
        with open(ascii_stl, "w") as handle:
            handle.write("solid s\n" + facet * facets + "endsolid s\n")
        estimated, _ = analyze_quote_part.estimate_face_count(ascii_stl, "stl")
        check("floor-formatted ASCII STL: still an upper bound",
              estimated is not None and estimated >= facets,
              f"estimate={estimated} facets={facets}")

        # ── a scan cut short at XML_SCAN_LIMIT_BYTES keeps its partial count ──
        # 3MF is a ZIP: the shipped 32 MiB upload ceiling holds a model part
        # that inflates far past the 256 MiB scan limit (measured with
        # zlib level 9: 20M `<triangle` elements = 610 MiB of XML compress to
        # 1.5 MiB). Returning None for that case skipped the precheck
        # altogether and handed ~20M triangles to load_part inside `mem_limit:
        # 2g` — the OOM kill the precheck exists to prevent. The prefix count
        # is a LOWER bound, so it cannot clear a file, but it can refuse one.
        element = b'<triangle v1="1" v2="2" v3="3"/>'  # 32 bytes
        count, truncated = analyze_quote_part.count_token(
            io.BytesIO(element * 100), analyze_quote_part.TRIANGLE_TOKEN, 64)
        check("count_token: a cut-short scan reports what it counted, not None",
              (count, truncated) == (2, True), f"count={count} truncated={truncated}")
        count, truncated = analyze_quote_part.count_token(
            io.BytesIO(element * 100), analyze_quote_part.TRIANGLE_TOKEN, 100 * 32)
        check("count_token: a stream ending exactly at the cap is not truncated",
              (count, truncated) == (100, False), f"count={count} truncated={truncated}")
        count, truncated = analyze_quote_part.count_obj_triangles(
            io.BytesIO(b"f 1 2 3 4\n" * 10), 25)
        check("count_obj_triangles: a cut-short scan reports what it counted",
              truncated is True and 4 <= count <= 6, f"count={count} truncated={truncated}")

        # …and the precheck acts on that partial count, before load_part.
        oversize = os.path.join(workdir, "scan-limit.3mf")
        with zipfile.ZipFile(oversize, "w", zipfile.ZIP_DEFLATED) as package:
            package.writestr(
                "3D/3dmodel.model",
                b'<model unit="millimeter"><resources><object id="1"><mesh><triangles>'
                + element * 20_000
                + b"</triangles></mesh></object></resources></model>")
        check("scan-limit 3MF fixture is tiny on disk (a ZIP hides the XML)",
              os.path.getsize(oversize) < 64 * 1024,
              f"{os.path.getsize(oversize)} bytes for 640 KB of model XML")
        real_limit = analyze_quote_part.XML_SCAN_LIMIT_BYTES
        try:
            # 32 KiB of the 640 KB model part: ~1000 of the 20 000 triangles.
            analyze_quote_part.XML_SCAN_LIMIT_BYTES = 32 * 1024
            estimated, truncated = analyze_quote_part.estimate_face_count(oversize, "3mf")
            check("3MF past the scan limit: partial count kept (was None)",
                  truncated is True and estimated is not None and estimated >= 900,
                  f"estimate={estimated} truncated={truncated}")
            outdir = os.path.join(workdir, "scan-limit-out")
            code = None
            try:
                analyze_quote_part.analyze(
                    oversize, "3mf", outdir, 256,
                    analyze_quote_part.DEFAULT_MAX_FACES_WALLS,
                    analyze_quote_part.DEFAULT_MAX_FACES_BODIES,
                    500, analyze_quote_part.DEFAULT_MAX_BREP_FACES)
            except analyze_quote_part.AnalysisError as exc:
                code = exc.code
            check("3MF past the scan limit, prefix already over the ceiling: refused",
                  code == "too_many_faces", f"code={code}")
            # Below the ceiling the prefix proves nothing about the triangles —
            # but the scan hitting its cap proves the model XML alone is bigger
            # than the limit, and trimesh reads that entry WHOLE into memory.
            code, message = None, ""
            try:
                analyze_quote_part.analyze(
                    oversize, "3mf", outdir, 256,
                    analyze_quote_part.DEFAULT_MAX_FACES_WALLS,
                    analyze_quote_part.DEFAULT_MAX_FACES_BODIES,
                    10_000_000, analyze_quote_part.DEFAULT_MAX_BREP_FACES)
            except analyze_quote_part.AnalysisError as exc:
                code, message = exc.code, exc.message
            check("3MF past the scan limit, prefix under the ceiling: still refused",
                  code == "too_many_faces" and "scan limit" in message,
                  f"code={code} message={message}")
            check("scan-limit refusal happens before load_part (no output written)",
                  not os.path.exists(os.path.join(outdir, "canonical.stl")),
                  "canonical.stl was written, so the mesh was loaded anyway")
        finally:
            analyze_quote_part.XML_SCAN_LIMIT_BYTES = real_limit
        # With the real limit back, an ordinary 3MF is counted whole. The count
        # is 13 for a 12-triangle cube because the `<triangles>` container tag
        # starts with the token too — an over-estimate of one per mesh, which
        # is the safe direction.
        estimated, truncated = analyze_quote_part.estimate_face_count(
            os.path.join(FIXTURES, "cube1in.3mf"), "3mf")
        check("cube1in.3mf: counted whole, not truncated, still an upper bound",
              truncated is False and estimated == 13,
              f"estimate={estimated} truncated={truncated} (12 triangles + <triangles>)")

    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nall analyze-quote-part checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
