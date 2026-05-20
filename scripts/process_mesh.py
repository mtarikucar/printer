#!/usr/bin/env python3
"""
Mesh processing pipeline for photo-to-figurine service.

Takes a GLB file, repairs it for 3D printing, adds a base,
and exports a watertight binary STL with a JSON report.

Usage:
    python process_mesh.py input.glb output.stl report.json
"""

import json
import sys
import time
import numpy as np

import trimesh
import pymeshlab


def load_mesh(input_path: str) -> trimesh.Trimesh:
    """Load a GLB/GLTF file and return the combined mesh."""
    scene = trimesh.load(input_path, force="scene")

    if isinstance(scene, trimesh.Scene):
        meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("No valid meshes found in file")
        if len(meshes) == 1:
            return meshes[0]
        # Combine all meshes into one
        combined = trimesh.util.concatenate(meshes)
        return combined
    elif isinstance(scene, trimesh.Trimesh):
        return scene
    else:
        raise ValueError(f"Unexpected type from trimesh.load: {type(scene)}")


def keep_largest_component(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, bool]:
    """If mesh has multiple disconnected bodies, keep only the largest.

    Returns (largest_component, dropped_significant). dropped_significant is
    True if any discarded component had >=10% of the largest's volume/area —
    a signal that Meshy interpreted the image as a multi-piece object and the
    user may want to review the result.
    """
    components = mesh.split()
    if len(components) <= 1:
        return mesh, False

    def size(m):
        return m.volume if m.is_volume else m.area

    sized = [(c, size(c)) for c in components]
    sized.sort(key=lambda p: p[1], reverse=True)
    largest, largest_size = sized[0]
    dropped_significant = any(
        s > 0 and (s / largest_size) >= 0.10 for _, s in sized[1:]
    )
    return largest, dropped_significant


def estimate_min_wall_thickness_mm(mesh: trimesh.Trimesh) -> float | None:
    """Estimate the thinnest wall of the mesh by sampling surface points and
    measuring inward ray distance. Returns None on failure.

    This is a coarse heuristic — good enough to flag obvious risk regions
    (< 1mm for FDM) without the cost of a full medial-axis computation.
    """
    try:
        # Sample up to 2000 points uniformly on the surface.
        sample_count = min(2000, max(200, len(mesh.faces) // 10))
        points, face_idx = trimesh.sample.sample_surface(mesh, sample_count)
        # Inward direction = -face_normal at each sample.
        normals = mesh.face_normals[face_idx]
        ray_origins = points - normals * 1e-4  # nudge inside the surface
        ray_directions = -normals

        # Cast inward rays; nearest hit distance = local thickness.
        locations, index_ray, _ = mesh.ray.intersects_location(
            ray_origins=ray_origins,
            ray_directions=ray_directions,
            multiple_hits=False,
        )
        if len(locations) == 0:
            return None
        distances = np.linalg.norm(locations - ray_origins[index_ray], axis=1)
        # Filter degenerate near-zero hits (grazing rays / self-intersection).
        valid = distances[distances > 0.05]
        if len(valid) == 0:
            return None
        return float(np.percentile(valid, 1))  # 1st percentile as min estimate
    except Exception as e:
        print(f"Warning: wall-thickness estimate failed: {e}", file=sys.stderr)
        return None


def repair_self_intersections(mesh: trimesh.Trimesh, repairs: list[str]) -> trimesh.Trimesh:
    """Run an extra pymeshlab pass to fix non-manifold faces left over after
    the primary repair step. No-op if the mesh is already clean."""
    try:
        ms = pymeshlab.MeshSet()
        m = pymeshlab.Mesh(
            vertex_matrix=mesh.vertices.astype(np.float64),
            face_matrix=mesh.faces.astype(np.int32),
        )
        ms.add_mesh(m)
        ms.meshing_repair_non_manifold_faces()
        repaired = ms.current_mesh()
        if repaired.face_number() != mesh.faces.shape[0]:
            repairs.append("repair_non_manifold_faces")
        return trimesh.Trimesh(
            vertices=repaired.vertex_matrix(),
            faces=repaired.face_matrix(),
            process=True,
        )
    except Exception as e:
        print(f"Warning: repair_non_manifold_faces failed: {e}", file=sys.stderr)
        return mesh


def repair_with_pymeshlab(mesh: trimesh.Trimesh, repairs: list[str]) -> trimesh.Trimesh:
    """Use pymeshlab to repair non-manifold geometry and close holes."""
    ms = pymeshlab.MeshSet()
    m = pymeshlab.Mesh(
        vertex_matrix=mesh.vertices.astype(np.float64),
        face_matrix=mesh.faces.astype(np.int32),
    )
    ms.add_mesh(m)

    # Repair non-manifold edges
    try:
        ms.meshing_repair_non_manifold_edges(method="Remove Faces")
        repairs.append("repair_non_manifold_edges")
    except Exception as e:
        print(f"Warning: repair_non_manifold_edges failed: {e}", file=sys.stderr)

    # Repair non-manifold vertices
    try:
        ms.meshing_repair_non_manifold_vertices()
        repairs.append("repair_non_manifold_vertices")
    except Exception as e:
        print(f"Warning: repair_non_manifold_vertices failed: {e}", file=sys.stderr)

    # Close holes
    try:
        ms.meshing_close_holes(maxholesize=100)
        repairs.append("close_holes")
    except Exception as e:
        print(f"Warning: close_holes failed: {e}", file=sys.stderr)

    # Extract repaired mesh
    repaired = ms.current_mesh()
    return trimesh.Trimesh(
        vertices=repaired.vertex_matrix(),
        faces=repaired.face_matrix(),
        process=True,
    )


def decimate_if_needed(
    mesh: trimesh.Trimesh, max_faces: int = 200000, target_faces: int = 150000, repairs: list[str] = []
) -> trimesh.Trimesh:
    """Decimate mesh if it has too many faces."""
    if len(mesh.faces) <= max_faces:
        return mesh

    ms = pymeshlab.MeshSet()
    m = pymeshlab.Mesh(
        vertex_matrix=mesh.vertices.astype(np.float64),
        face_matrix=mesh.faces.astype(np.int32),
    )
    ms.add_mesh(m)

    ms.meshing_decimation_quadric_edge_collapse(
        targetfacenum=target_faces,
        preservenormal=True,
        preservetopology=True,
    )
    repairs.append(f"decimated_{len(mesh.faces)}_to_{target_faces}")

    decimated = ms.current_mesh()
    return trimesh.Trimesh(
        vertices=decimated.vertex_matrix(),
        faces=decimated.face_matrix(),
        process=True,
    )


def scale_to_target(mesh: trimesh.Trimesh, target_height_mm: float = 80.0) -> trimesh.Trimesh:
    """Scale mesh so its height is the target height in mm."""
    bounds = mesh.bounds
    current_height = bounds[1][2] - bounds[0][2]

    if current_height <= 0:
        raise ValueError("Mesh has zero or negative height")

    scale_factor = target_height_mm / current_height
    mesh.apply_scale(scale_factor)

    # Center on XY plane, bottom at Z=0
    bounds = mesh.bounds
    translation = [
        -(bounds[0][0] + bounds[1][0]) / 2,
        -(bounds[0][1] + bounds[1][1]) / 2,
        -bounds[0][2],
    ]
    mesh.apply_translation(translation)

    return mesh


def add_base(mesh: trimesh.Trimesh, repairs: list[str]) -> tuple[trimesh.Trimesh, bool]:
    """Add a cylindrical base to the mesh using boolean union."""
    bounds = mesh.bounds
    width = bounds[1][0] - bounds[0][0]
    depth = bounds[1][1] - bounds[0][1]

    base_radius = max(width, depth) * 0.6 / 2
    base_radius = max(base_radius, 10.0)  # minimum 10mm radius
    base_height = 3.0

    # Create cylinder base
    base = trimesh.creation.cylinder(
        radius=base_radius,
        height=base_height,
        sections=64,
    )

    # Position base so top surface is at Z=0 (bottom of model)
    base.apply_translation([0, 0, -base_height / 2])

    # Try boolean union with manifold3d
    try:
        result = trimesh.boolean.union([mesh, base], engine="manifold")
        if isinstance(result, trimesh.Trimesh) and len(result.faces) > 0:
            repairs.append("base_added_boolean")
            return result, True
    except Exception as e:
        print(f"Warning: Boolean union failed: {e}", file=sys.stderr)

    # Fallback: concatenate (slicers handle overlapping solids)
    try:
        result = trimesh.util.concatenate([mesh, base])
        repairs.append("base_added_concatenate")
        return result, True
    except Exception as e:
        print(f"Warning: Base concatenation also failed: {e}", file=sys.stderr)
        return mesh, False


def validate_mesh(mesh: trimesh.Trimesh) -> dict:
    """Run validation checks and return report data."""
    bounds = mesh.bounds
    size = bounds[1] - bounds[0]

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
    }


def process_mesh(input_path: str, output_stl_path: str, report_path: str):
    """Main processing pipeline."""
    start_time = time.time()
    repairs: list[str] = []

    print(f"Loading mesh from {input_path}...")
    mesh = load_mesh(input_path)
    print(f"  Loaded: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces")

    # Keep largest component
    original_components = len(mesh.split())
    mesh, dropped_significant = keep_largest_component(mesh)
    if original_components > 1:
        repairs.append(f"kept_largest_of_{original_components}_components")
        print(f"  Kept largest of {original_components} components")

    # Repair with pymeshlab
    print("Repairing mesh...")
    mesh = repair_with_pymeshlab(mesh, repairs)
    print(f"  After repair: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces")

    # Extra pass for self-intersections / non-manifold faces missed above.
    mesh = repair_self_intersections(mesh, repairs)

    # Decimate if needed
    mesh = decimate_if_needed(mesh, repairs=repairs)

    # Scale to target height
    print("Scaling to 80mm height...")
    mesh = scale_to_target(mesh, target_height_mm=80.0)

    # Wall-thickness estimate happens AFTER scaling so the value is in mm.
    min_wall_mm = estimate_min_wall_thickness_mm(mesh)

    # Add base
    print("Adding base...")
    mesh, base_added = add_base(mesh, repairs)

    # Validate
    report = validate_mesh(mesh)
    report["base_added"] = base_added
    report["repairs_applied"] = repairs
    report["dropped_significant_component"] = dropped_significant
    report["min_wall_thickness_estimate_mm"] = (
        round(min_wall_mm, 3) if min_wall_mm is not None else None
    )
    risks: list[str] = []
    if min_wall_mm is not None and min_wall_mm < 1.0:
        risks.append("thin_walls")
    if dropped_significant:
        risks.append("dropped_significant_component")
    report["print_risk"] = risks
    report["processing_time_seconds"] = round(time.time() - start_time, 2)

    print(f"  Watertight: {report['is_watertight']}")
    print(f"  Volume: {report['is_volume']}")
    print(f"  Vertices: {report['vertex_count']}")
    print(f"  Faces: {report['face_count']}")
    print(f"  Components: {report['component_count']}")
    print(f"  Size (mm): {report['bounding_box']['size']}")
    print(f"  Base added: {base_added}")

    # Export binary STL
    print(f"Exporting STL to {output_stl_path}...")
    mesh.export(output_stl_path, file_type="stl")

    # Write report
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Done in {report['processing_time_seconds']}s")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} input.glb output.stl report.json", file=sys.stderr)
        sys.exit(1)

    process_mesh(sys.argv[1], sys.argv[2], sys.argv[3])
