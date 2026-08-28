#!/usr/bin/env python3
"""Turn a Meshy GLB into a print-ready STL plus a numeric report the print gate
can rule on.

Usage:
    process_mesh.py <input.glb> <output.stl> <report.json>
                    --height-mm 150 [--material resin]

Pipeline order matters and every step here was chosen against measured output
from the live Meshy API (2026-08-27/28), not from first principles:

  1. orient_z_up    glTF is Y-up, STL/slicers are Z-up. Without this the height
                    is measured on the figure's DEPTH: a 150 mm target produced
                    a 433 mm tall object and glued the base to the figure's back.
                    This is the bug that most likely sank the first Meshy attempt.
  2. merge_components  union every shell above 2% of the largest instead of
                    deleting it. keep_largest_component() alone amputates an
                    arm/bow/sword and the result stays PERFECTLY watertight, so
                    every naive check passes and a one-armed figure ships.
  3. pymeshlab repair
  4. decimate       cap face count so the slicer is not drowned.
  5. scale_to_target  to (height - base height): the target is the FINISHED object.
  6. wall measurement  deterministic (see estimate_wall_percentiles).
  7. add_base       the cylinder OVERLAPS the model. A base whose top face is
                    coplanar with the model's bottom unions into two
                    disconnected solids — watertight, but component_count == 2,
                    which fails the gate on every single order.

NOTE: the caller must hand us Meshy's REPAIRED glb (POST /openapi/v1/print/repair).
Raw meshy-7 output measured 610 disconnected shells, is_watertight false, and
this pipeline cannot rescue it — the union fails and the concatenate fallback
loses two thirds of the faces.
"""
import argparse
import json
import sys
import time

import numpy as np
import trimesh

try:
    import pymeshlab
except ImportError:  # pragma: no cover - deployment guard
    pymeshlab = None

BASE_HEIGHT_MM = 3.0
# The cylinder pokes this far INTO the model so the boolean actually fuses.
BASE_OVERLAP_MM = 0.6
# Union any shell at least this fraction of the largest one's volume.
COMPONENT_KEEP_RATIO = 0.02
# Anything below KEEP_RATIO but above this is a real feature we had to drop.
COMPONENT_SIGNIFICANT_RATIO = 0.001
# Meshy is asked for target_polycount=300000, so a healthy mesh lands just under
# this and is never decimated. Decimation is a safety net, not a stage.
MAX_FACES = 400_000
DECIMATE_TARGET = 300_000


def load_mesh(input_path: str) -> trimesh.Trimesh:
    """Load a GLB/GLTF and return one mesh with node transforms APPLIED.

    The previous version read `scene.geometry.values()` directly, which silently
    discarded the scene graph transform.
    """
    loaded = trimesh.load(input_path, force="scene")
    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    if not isinstance(loaded, trimesh.Scene):
        raise ValueError(f"Unexpected type from trimesh.load: {type(loaded)}")

    meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        raise ValueError("No valid meshes found in file")
    try:
        combined = loaded.to_geometry()
        if isinstance(combined, trimesh.Trimesh) and len(combined.faces) > 0:
            return combined
    except Exception as exc:  # noqa: BLE001 - fall back, never fail the job here
        print(f"Warning: scene.to_geometry() failed ({exc}); using raw geometry", file=sys.stderr)
    return meshes[0] if len(meshes) == 1 else trimesh.util.concatenate(meshes)


def orient_z_up(mesh: trimesh.Trimesh, repairs: list[str]) -> trimesh.Trimesh:
    """Put the figure's long axis on Z, which is what scaling and the base assume."""
    extents = np.asarray(mesh.bounding_box.extents, dtype=float)
    if int(np.argmax(extents)) == 2:
        repairs.append("axis_already_z_up")
        return mesh

    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    if int(np.argmax(np.asarray(mesh.bounding_box.extents, dtype=float))) == 2:
        repairs.append("axis_rotated_y_up_to_z_up")
        return mesh

    # Neither Y nor Z was the long axis; bring X up as a last resort.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    repairs.append("axis_rotated_x_up_to_z_up")
    return mesh


def merge_components(
    mesh: trimesh.Trimesh, repairs: list[str]
) -> tuple[trimesh.Trimesh, int, bool]:
    """Fuse accessory shells into the body; report anything real we still lost."""
    components = mesh.split(only_watertight=False)
    if len(components) <= 1:
        return mesh, 1, False

    volumes = [abs(c.volume) if c.volume else 0.0 for c in components]
    largest = max(volumes) if volumes else 0.0
    if largest <= 0:
        return mesh, len(components), False

    keep = [c for c, v in zip(components, volumes) if v >= largest * COMPONENT_KEEP_RATIO]
    dropped_significant = any(
        largest * COMPONENT_SIGNIFICANT_RATIO <= v < largest * COMPONENT_KEEP_RATIO
        for v in volumes
    )

    if len(keep) <= 1:
        repairs.append(f"kept_largest_of_{len(components)}_components")
        return (keep[0] if keep else mesh), 1, dropped_significant

    try:
        merged = trimesh.boolean.union(keep, engine="manifold")
        if isinstance(merged, trimesh.Trimesh) and len(merged.faces) > 0:
            repairs.append(f"merged_{len(keep)}_components_boolean")
            return merged, len(keep), dropped_significant
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: component union failed: {exc}", file=sys.stderr)

    repairs.append(f"merged_{len(keep)}_components_concatenate")
    return trimesh.util.concatenate(keep), len(keep), dropped_significant


def repair_with_pymeshlab(mesh: trimesh.Trimesh, repairs: list[str]) -> trimesh.Trimesh:
    # Meshy's print/repair already returns a watertight, manifold, hole-free
    # mesh. Running close-holes / remove-faces over a good mesh only risks
    # breaking it, so this is a rescue path, not a stage.
    if mesh.is_watertight and mesh.is_volume:
        repairs.append("repair_skipped_already_clean")
        return mesh
    if pymeshlab is None:
        print("Warning: pymeshlab unavailable; skipping repair", file=sys.stderr)
        return mesh
    try:
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        ms.meshing_repair_non_manifold_edges(method="Remove Faces")
        ms.meshing_repair_non_manifold_vertices()
        ms.meshing_close_holes(maxholesize=300)
        out = ms.current_mesh()
        repairs.append("pymeshlab_repair")
        return trimesh.Trimesh(
            vertices=out.vertex_matrix(), faces=out.face_matrix(), process=True
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: pymeshlab repair failed: {exc}", file=sys.stderr)
        return mesh


def decimate_if_needed(mesh: trimesh.Trimesh, repairs: list[str]) -> trimesh.Trimesh:
    if len(mesh.faces) <= MAX_FACES or pymeshlab is None:
        return mesh
    try:
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        # preservetopology=True is NOT optional: without it quadric edge collapse
        # silently breaks watertightness (measured: wt True -> False) and no
        # later repair filter in this stack puts it back.
        ms.meshing_decimation_quadric_edge_collapse(
            targetfacenum=DECIMATE_TARGET,
            preserveboundary=True,
            preservenormal=True,
            preservetopology=True,
            planarquadric=True,
        )
        out = ms.current_mesh()
        repairs.append(f"decimated_to_{DECIMATE_TARGET}")
        return trimesh.Trimesh(
            vertices=out.vertex_matrix(), faces=out.face_matrix(), process=True
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: decimation failed: {exc}", file=sys.stderr)
        return mesh


def scale_to_target(mesh: trimesh.Trimesh, target_height_mm: float) -> trimesh.Trimesh:
    current = mesh.bounds[1][2] - mesh.bounds[0][2]
    if current <= 0:
        raise ValueError("Mesh has zero height on Z after orientation")
    mesh.apply_scale(target_height_mm / current)
    bounds = mesh.bounds
    mesh.apply_translation(
        [
            -(bounds[0][0] + bounds[1][0]) / 2,
            -(bounds[0][1] + bounds[1][1]) / 2,
            -bounds[0][2],
        ]
    )
    return mesh


def estimate_wall_percentiles(
    mesh: trimesh.Trimesh, max_samples: int = 6000
) -> tuple[float | None, float | None]:
    """Thinnest-wall estimate, in mm, as (p1, p5).

    DETERMINISTIC on purpose: rays start at an evenly strided subset of face
    centroids rather than a random surface sample. The random version moved the
    p1 estimate by up to 0.12 mm between identical runs, and a gate whose
    verdict flips between identical runs is not a gate.

    p1 catches a single thin splinter; p5 says whether thinness is widespread.
    """
    try:
        face_count = len(mesh.faces)
        if face_count == 0:
            return None, None
        stride = max(1, face_count // max_samples)
        idx = np.arange(0, face_count, stride)
        normals = mesh.face_normals[idx]
        origins = mesh.triangles_center[idx] - normals * 1e-4
        locations, index_ray, _ = mesh.ray.intersects_location(
            ray_origins=origins, ray_directions=-normals, multiple_hits=False
        )
        if len(locations) == 0:
            return None, None
        distances = np.linalg.norm(locations - origins[index_ray], axis=1)
        valid = distances[distances > 0.05]
        if len(valid) == 0:
            return None, None
        return float(np.percentile(valid, 1)), float(np.percentile(valid, 5))
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: wall-thickness estimate failed: {exc}", file=sys.stderr)
        return None, None


def add_base(mesh: trimesh.Trimesh, repairs: list[str]) -> tuple[trimesh.Trimesh, bool]:
    bounds = mesh.bounds
    width = bounds[1][0] - bounds[0][0]
    depth = bounds[1][1] - bounds[0][1]
    radius = max(max(width, depth) * 0.6 / 2, 10.0)

    height = BASE_HEIGHT_MM + BASE_OVERLAP_MM
    base = trimesh.creation.cylinder(radius=radius, height=height, sections=64)
    base.apply_translation([0, 0, -height / 2 + BASE_OVERLAP_MM])

    try:
        result = trimesh.boolean.union([mesh, base], engine="manifold")
        if isinstance(result, trimesh.Trimesh) and len(result.faces) > 0:
            repairs.append("base_added_boolean")
            return result, True
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: base union failed: {exc}", file=sys.stderr)

    try:
        repairs.append("base_added_concatenate")
        return trimesh.util.concatenate([mesh, base]), True
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: base concatenation failed: {exc}", file=sys.stderr)
        return mesh, False


def build_report(mesh: trimesh.Trimesh) -> dict:
    bounds = mesh.bounds
    size = bounds[1] - bounds[0]
    volume_cm3 = float(abs(mesh.volume)) / 1000.0
    bbox_cm3 = float(size[0] * size[1] * size[2]) / 1000.0
    return {
        "is_watertight": bool(mesh.is_watertight),
        "is_volume": bool(mesh.is_volume),
        "vertex_count": int(len(mesh.vertices)),
        "face_count": int(len(mesh.faces)),
        "component_count": len(mesh.split()),
        "bounding_box": {
            "min": bounds[0].tolist(),
            "max": bounds[1].tolist(),
            "size": size.tolist(),
        },
        "volume_cm3": round(volume_cm3, 3),
        "fill_ratio": round(volume_cm3 / bbox_cm3, 4) if bbox_cm3 > 0 else 0.0,
    }


def process_mesh(
    input_path: str, output_stl_path: str, report_path: str, height_mm: float, material: str
) -> dict:
    started = time.time()
    repairs: list[str] = []

    mesh = load_mesh(input_path)
    print(f"Loaded: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces")

    mesh = orient_z_up(mesh, repairs)
    mesh, merged_count, dropped_significant = merge_components(mesh, repairs)
    mesh = repair_with_pymeshlab(mesh, repairs)
    mesh = decimate_if_needed(mesh, repairs)

    body_height = max(height_mm - BASE_HEIGHT_MM, 1.0)
    mesh = scale_to_target(mesh, body_height)

    p1, p5 = estimate_wall_percentiles(mesh)
    mesh, base_added = add_base(mesh, repairs)

    report = build_report(mesh)
    report.update(
        {
            "base_added": base_added,
            "repairs_applied": repairs,
            "dropped_significant_component": dropped_significant,
            "merged_component_count": merged_count,
            "min_wall_p1_mm": None if p1 is None else round(p1, 3),
            "min_wall_p5_mm": None if p5 is None else round(p5, 3),
            "target_height_mm": height_mm,
            "measured_height_mm": round(float(report["bounding_box"]["size"][2]), 2),
            "material": material,
            "processing_time_seconds": round(time.time() - started, 2),
        }
    )

    mesh.export(output_stl_path, file_type="stl")
    with open(report_path, "w") as handle:
        json.dump(report, handle, indent=2)

    print(json.dumps({k: v for k, v in report.items() if k != "bounding_box"}, indent=2))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a Meshy GLB for resin printing")
    parser.add_argument("input")
    parser.add_argument("output_stl")
    parser.add_argument("report")
    parser.add_argument("--height-mm", type=float, required=True)
    parser.add_argument("--material", default="resin", choices=["resin", "filament"])
    args = parser.parse_args()

    if args.height_mm <= 0 or args.height_mm > 1000:
        print(f"Error: implausible height {args.height_mm} mm", file=sys.stderr)
        return 2
    try:
        process_mesh(args.input, args.output_stl, args.report, args.height_mm, args.material)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
