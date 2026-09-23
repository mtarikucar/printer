#!/usr/bin/env python3
"""Smoke test for scripts/analyze_quote_part.py (the instant-quote geometry CLI).

Usage:  $MESH_PYTHON scripts/test-analyze-quote-part.py

Runs the CLI exactly as the BullMQ worker does (input, format, out dir) against
the committed fixtures and checks the report contract, the measured numbers and
the three side files (thumb.png, preview.glb, canonical.stl).

The expected key set is READ OUT OF `src/lib/config/quote-types.ts`, so a key
renamed on the TypeScript side fails here instead of silently producing a report
no consumer can read.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import trimesh
from PIL import Image

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
CLI = os.path.join(SCRIPTS_DIR, "analyze_quote_part.py")
FIXTURES = os.path.join(SCRIPTS_DIR, "fixtures", "quote")
QUOTE_TYPES_TS = os.path.join(REPO_ROOT, "src", "lib", "config", "quote-types.ts")
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
            missing = sorted(keys - geometry.keys())
            extra = sorted(geometry.keys() - keys)
            check("cube20.stl: geometry matches PartGeometry key for key",
                  not missing and not extra, f"missing={missing} extra={extra}")
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
            check_thumb("cube1in.3mf (--thumb-size 256)", outdir, 256)

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

    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nall analyze-quote-part checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
