#!/usr/bin/env python3
"""Faz 3 — process a customer-uploaded STL/OBJ for printing + auto pricing.

Usage:  process_upload_model.py <input.stl|obj|glb> <output.glb> <report.json> <target_height_mm>

Reuses the geometry helpers from process_mesh.py. Loads the user mesh, keeps the
largest body, decimates if huge, scales to the target print height, repairs to a
closed volume, then writes a GLB preview + a JSON report with the *scaled* volume
(mm³), bounding box, watertightness, and print-risk flags. The volume drives
auto pricing server-side (uploadModelPriceKurus)."""
import sys
import json
import time

# Same dir on sys.path when run as `python3 scripts/process_upload_model.py`.
from process_mesh import (  # type: ignore
    load_mesh,
    keep_largest_component,
    decimate_if_needed,
    scale_to_target,
    repair_with_pymeshlab,
    repair_self_intersections,
    validate_mesh,
    estimate_min_wall_thickness_mm,
)


def process(input_path: str, output_glb_path: str, report_path: str, target_height_mm: float):
    t0 = time.time()
    repairs: list[str] = []

    mesh = load_mesh(input_path)  # trimesh.load handles .stl / .obj / .glb by ext
    mesh, dropped = keep_largest_component(mesh)
    mesh = decimate_if_needed(mesh, repairs=repairs)
    mesh = scale_to_target(mesh, target_height_mm)

    # Try to close the mesh so volume is meaningful; tolerate failures.
    try:
        mesh = repair_with_pymeshlab(mesh, repairs)
    except Exception:
        try:
            mesh = repair_self_intersections(mesh, repairs)
        except Exception:
            pass

    info = validate_mesh(mesh)
    min_wall = estimate_min_wall_thickness_mm(mesh)
    volume_mm3 = float(mesh.volume) if info.get("is_volume") else None

    print_risk: list[str] = []
    if not info.get("is_volume"):
        print_risk.append("not_watertight")
    if min_wall is not None and min_wall < 1.0:
        print_risk.append("thin_walls")
    if dropped:
        print_risk.append("dropped_significant_component")

    bbox = info.get("bounding_box", {}) or {}
    size = bbox.get("size", [None, None, None])

    report = {
        **info,
        "volume_mm3": volume_mm3,
        "bounding_box_mm": {"x": size[0], "y": size[1], "z": size[2]},
        "min_wall_thickness_estimate_mm": min_wall,
        "dropped_significant_component": dropped,
        "repairs_applied": repairs,
        "print_risk": print_risk,
        "target_height_mm": target_height_mm,
        "processing_time_seconds": round(time.time() - t0, 2),
    }

    mesh.export(output_glb_path, file_type="glb")
    with open(report_path, "w") as f:
        json.dump(report, f)
    print(f"OK volume_mm3={volume_mm3} risk={print_risk}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        print(
            f"Usage: {sys.argv[0]} input.stl output.glb report.json target_height_mm",
            file=sys.stderr,
        )
        sys.exit(1)
    process(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]))
