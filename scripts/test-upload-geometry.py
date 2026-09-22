#!/usr/bin/env python3
"""Smoke test for scripts/process_upload_model.py (the legacy upload/product-file
geometry CLI) against the committed 20 mm cube fixture.

Usage:  $MESH_PYTHON scripts/test-upload-geometry.py

Runs the CLI exactly like its callers do (src/app/api/upload/model/route.ts with
a print height, src/lib/services/product-spec.ts with "0" = true size) and checks
the exit code, the GLB preview and the report contract.
"""
import json
import os
import subprocess
import sys
import tempfile

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(SCRIPTS_DIR, "process_upload_model.py")
CUBE20 = os.path.join(SCRIPTS_DIR, "fixtures", "quote", "cube20.stl")

# The full report contract the TypeScript callers rely on.
REPORT_KEYS = {
    "is_watertight",
    "is_volume",
    "vertex_count",
    "face_count",
    "component_count",
    "bounding_box",
    "volume_mm3",
    "bounding_box_mm",
    "min_wall_thickness_estimate_mm",
    "dropped_significant_component",
    "repairs_applied",
    "print_risk",
    "target_height_mm",
    "processing_time_seconds",
}

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {label}{'' if ok else f' ({detail})'}")
    if not ok:
        failures.append(label)


def near(actual: object, expected: float, tolerance: float) -> bool:
    return isinstance(actual, (int, float)) and abs(actual - expected) <= tolerance


def run(target_height: str, workdir: str) -> dict | None:
    glb_path = os.path.join(workdir, f"preview-{target_height}.glb")
    report_path = os.path.join(workdir, f"report-{target_height}.json")
    proc = subprocess.run(
        [sys.executable, CLI, CUBE20, glb_path, report_path, target_height],
        capture_output=True,
        text=True,
        timeout=120,
    )
    label = f"h={target_height}"
    check(f"{label}: exit 0", proc.returncode == 0, proc.stderr.strip()[-600:])
    if proc.returncode != 0:
        return None

    with open(glb_path, "rb") as handle:
        check(f"{label}: GLB preview written", handle.read(4) == b"glTF", "missing glTF magic")
    with open(report_path) as handle:
        report = json.load(handle)
    missing = sorted(REPORT_KEYS - report.keys())
    extra = sorted(report.keys() - REPORT_KEYS)
    check(f"{label}: report keys match the contract", not missing and not extra,
          f"missing={missing} extra={extra}")
    check(f"{label}: clean cube is a closed volume",
          report.get("is_watertight") is True and report.get("is_volume") is True,
          f"is_watertight={report.get('is_watertight')} is_volume={report.get('is_volume')}")
    check(f"{label}: no print risk on a clean cube", report.get("print_risk") == [],
          f"print_risk={report.get('print_risk')}")
    return report


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="upload-geometry-") as workdir:
        scaled = run("80", workdir)
        if scaled is not None:
            bbox = scaled.get("bounding_box_mm") or {}
            check("h=80: scaled to 80 mm tall", near(bbox.get("z"), 80.0, 0.01), f"bbox={bbox}")
            # A cube scaled uniformly to 80 mm: 80³.
            check("h=80: volume 512000 mm³", near(scaled.get("volume_mm3"), 512_000.0, 64.0),
                  f"volume_mm3={scaled.get('volume_mm3')}")

        true_size = run("0", workdir)
        if true_size is not None:
            bbox = true_size.get("bounding_box_mm") or {}
            check("h=0: volume 8000 ± 1 mm³", near(true_size.get("volume_mm3"), 8000.0, 1.0),
                  f"volume_mm3={true_size.get('volume_mm3')}")
            check("h=0: bbox 20 × 20 × 20 mm",
                  all(near(bbox.get(axis), 20.0, 0.01) for axis in ("x", "y", "z")),
                  f"bbox={bbox}")
            wall = true_size.get("min_wall_thickness_estimate_mm")
            check("h=0: wall estimate is the 20 mm cube side", near(wall, 20.0, 0.01),
                  f"min_wall_thickness_estimate_mm={wall}")

    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nall upload geometry checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
