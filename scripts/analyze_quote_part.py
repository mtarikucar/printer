#!/usr/bin/env python3
"""Measure ONE uploaded part for the instant quote engine.

Usage:
    analyze_quote_part.py <input> <stl|obj|3mf> <outdir>
                          [--thumb-size 512] [--max-faces-walls 2500000]
                          [--max-faces-bodies 2500000]
                          [--max-input-faces 1500000]
                          [--max-address-space-gb 8]

Writes into <outdir>:
    report.json    {"ok": true, "geometry": <PartGeometry>, "timings": {…}}
    thumb.png      3/4 isometric still (default 512²)
    preview.glb    ≤200k faces, Y-up, for <model-viewer>
    canonical.stl  binary STL of the ORIGINAL geometry, in file units

Exit 0 on success. On failure exit 2 and, whenever it is still possible, write
report.json as {"ok": false, "error": "<code>", "message": "…"}.

`geometry` is the `PartGeometry` interface from src/lib/config/quote-types.ts,
key for key, in camelCase. Three rules this file exists to enforce:

  1. MEASURE THE FULL-RESOLUTION MESH AT SCALE 1, IN FILE UNITS. Decimation is
     for the preview only, repair only ever touches a COPY, and unit/scale are
     applied afterwards in TypeScript (`quote-units.ts`). Changing the unit or
     the scale must never re-run this script.
  2. NEVER merge or drop shells. `process_mesh.merge_components` exists for
     figurines; an engineering part with two bodies is quoted as two bodies, so
     `bodyCount` counts them and every one of them is measured.
  3. 3MF UNITS ARE REPORTED, NOT APPLIED. trimesh 5.1 only sets `scene.units`;
     it does not convert the geometry (measured against the cube1in.3mf
     fixture: a 1 inch cube still loads as a 1-unit cube). So the `unit`
     attribute is read out of the package XML and returned as `sourceUnits`
     while the mesh stays exactly as the file wrote it.
"""
import argparse
import json
import os
import re
import resource
import sys
import time
import zipfile

import numpy as np
import trimesh

# Same dir on sys.path when run as `python3 scripts/analyze_quote_part.py`.
from process_mesh import (  # type: ignore
    load_mesh,
    repair_with_pymeshlab,
    estimate_wall_percentiles,
)
from render_turntable import render_frame, simplify, write_png  # type: ignore

try:
    from PIL import Image
except ImportError:  # pragma: no cover - older images ship without Pillow
    Image = None

try:
    import pymeshlab
except ImportError:  # pragma: no cover - deployment guard
    pymeshlab = None

# A runaway mesh must die inside the worker, not take the box down with it.
#
# RLIMIT_AS counts RESERVED address space, not memory in use, and this stack
# reserves a lot of it up front. Measured on a 16-core Linux box with the
# scripts/requirements.txt versions (/proc/self/status VmPeak vs VmHWM):
#
#   import trimesh + pymeshlab   1.70 GB reserved,  0.16 GB resident
#   327k-face part, full run     3.20 GB reserved,  0.52 GB resident
#   1.31M-face part, full run    4.21 GB reserved,  1.51 GB resident
#
# So the 3 GB the plan suggested kills an ordinary 327k-face part
# ("out_of_memory: Unable to allocate 7.50 MiB for an array with shape
# (983040,)", reproducible with `--max-address-space-gb 3`) while that part is
# using half a gigabyte of real memory. The default is therefore the measured
# 8 GB — room for the 2.5M-face wall ceiling, still a stop for a mesh trying to
# allocate its way through the host — and `--max-address-space-gb` turns the
# number into a deployment knob instead of a constant baked into this file: a
# smaller container can be given the plan's 3 GB without editing the script.
DEFAULT_ADDRESS_SPACE_GB = 8.0
# Below this the process cannot even finish `import trimesh` (1.70 GB reserved).
MIN_ADDRESS_SPACE_GB = 2.0
MAX_ADDRESS_SPACE_GB = 256.0
# <model-viewer> gets a light mesh; the price and the printer use the original.
PREVIEW_TARGET_FACES = 200_000
# Two INDEPENDENT ceilings that happen to start at the same number. Wall
# percentiles are dropped above the first one (there is no cheaper way to get
# them); the body count is never dropped, it only switches above the second one
# to `connected_components`, which counts the same shells without building a
# submesh for each. Splitting them means the wall ceiling can be tuned for a
# slow box without silently changing how bodies are counted, and vice versa.
DEFAULT_MAX_FACES_WALLS = 2_500_000
DEFAULT_MAX_FACES_BODIES = 2_500_000
# The mesh is measured at FULL resolution, so the face count — not the byte
# count — decides whether the job fits in the worker container
# (docker/docker-compose.production.yml: `mem_limit: 2g`). Measured with this
# script and /usr/bin/time -v: 327k faces → 0.51 GiB RSS, 1.31M → 1.50 GiB,
# 1.99M → 2.43 GiB, i.e. an OOM kill inside a 2 GiB cgroup. An OOM kill is the
# worst possible failure here: the process dies mid-allocation, report.json is
# never written, the part gets the generic "file unreadable" message and the
# stuck-part sweep re-queues the same job every 20 minutes forever. So the face
# count is estimated from the BYTES first — no mesh loaded — and an oversized
# part is refused with its own code. Raise this only together with `mem_limit`.
DEFAULT_MAX_INPUT_FACES = 1_500_000
# Binary STL: 80-byte header + uint32 facet count, then 50 bytes per facet.
# (size - 84) // 50 is therefore a true ceiling on the facets a binary file can
# hold, whatever its header claims and whatever trails it.
BINARY_STL_HEADER_BYTES = 84
BINARY_STL_FACET_BYTES = 50
# Smallest legal ASCII facet block, written with single spaces, one-character
# numbers and no indentation:
#   "facet normal 0 0 0\n"  19 + "outer loop\n"  11 + 3 × "vertex 0 0 0\n"  39
#   + "endloop\n"  8 + "endfacet\n"  9  =  86 bytes
# (the old 130 was a guess at *typical* formatting, not a floor — at 130 a
# compact ASCII file under-counts by ~1.5×). size // 86 is the ceiling.
ASCII_STL_MIN_FACET_BYTES = 86
TRIANGLE_TOKEN = b"<triangle"
# An OBJ face line starts with the token "f". It declares ONE FACE ELEMENT, not
# one triangle: trimesh fans an n-gon into n-2 triangles while loading
# (exchange/obj.py), so a quad mesh — the default Blender/Maya export — yields
# twice as many triangles as face lines. Counting the lines is therefore an
# UNDER-estimate, which is the one thing the precheck may never produce; the
# indices on each line are counted instead (see count_obj_triangles).
OBJ_FACE_TOKEN = b"f"
# trimesh merges backslash continuations before parsing (`text.replace("\\\n",
# "")`), so one face element may span several physical lines.
OBJ_CONTINUATION = b"\\"
# Above this the counter stops buffering a single unterminated line and folds
# its finished tokens in, so a newline-free OBJ cannot grow the scan buffer.
OBJ_MAX_LINE_BYTES = 4 * 1024 * 1024
# cos(135°): steeper than 45° from the build plate, i.e. it needs support.
OVERHANG_NORMAL_Z = -0.707
# Faces whose highest vertex sits this deep in the bottom slab rest ON the
# plate; they are down-facing but they are not overhangs.
FLOOR_BAND_RATIO = 0.01
THUMB_ELEVATION_DEG = 30.0  # POSITIVE: the top tilts toward the camera.
THUMB_AZIMUTH_DEG = 45.0
# 3MF: `<mesh>` is only ever a child of `<object>`, so counting the opening
# tags counts the objects that carry geometry.
MESH_TOKEN = b"<mesh"
MODEL_ENTRY_RE = re.compile(r"3D/.*\.model$", re.IGNORECASE)
MODEL_UNIT_RE = re.compile(rb"<model\b[^>]*?\bunit\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
# QuoteUnits only knows mm/cm/in; micron, foot and meter get no suggestion
# rather than a wrong one (the customer picks the unit in that case).
UNIT_MAP = {"millimeter": "mm", "centimeter": "cm", "inch": "in"}
XML_HEAD_BYTES = 64 * 1024
XML_CHUNK_BYTES = 4 * 1024 * 1024
XML_SCAN_LIMIT_BYTES = 256 * 1024 * 1024


class AnalysisError(Exception):
    """Failure with a machine-readable code for report.json."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def limit_address_space(limit_gb: float) -> None:
    """Best effort RLIMIT_AS. A hard limit below ours is left alone."""
    try:
        _soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        target = int(limit_gb * 1024**3)
        if hard != resource.RLIM_INFINITY:
            target = min(target, hard)
        resource.setrlimit(resource.RLIMIT_AS, (target, hard))
    except Exception as exc:  # noqa: BLE001 - never fail the job over this
        print(f"Warning: RLIMIT_AS not applied: {exc}", file=sys.stderr)


def count_token(stream, token: bytes, limit_bytes: int) -> int | None:
    """Occurrences of `token` in a stream, read in chunks (constant memory).

    The window overlap is what makes it exact across chunk boundaries.
    `None` when the stream is longer than `limit_bytes`: a count that stopped
    early is an UNDER-estimate, and no caller of this module may act on one.
    """
    count = 0
    overlap = b""
    read = 0
    while read < limit_bytes:
        chunk = stream.read(min(XML_CHUNK_BYTES, limit_bytes - read))
        if not chunk:
            return count
        read += len(chunk)
        window = overlap + chunk
        count += window.count(token)
        overlap = window[-(len(token) - 1) :]
    return None if stream.read(1) else count


def count_obj_triangles(stream, limit_bytes: int) -> int | None:
    """Upper bound on the triangles an OBJ yields AFTER triangulation.

    Every `f` line is one face element with k vertex references, which trimesh
    fans into k-2 triangles, so the bound is Σ max(1, k-2) — not the number of
    face lines (a quad mesh is exactly 2× that). Backslash continuations are
    folded the way trimesh folds them, and only the token count is carried
    across lines, so memory stays constant on any input.

    `None` when the stream is longer than `limit_bytes` (see `count_token`).
    """
    total = 0
    tail = b""
    read = 0
    # State of the logical line being assembled across continuations.
    open_line = False  # previous physical line ended with a backslash
    is_face = False  # …and that logical line is an `f` line
    tokens = 0  # whitespace-separated tokens seen on it so far, `f` included

    def fold(part: bytes, *, continued: bool) -> int:
        """Fold one piece of a logical line in; returns triangles completed."""
        nonlocal open_line, is_face, tokens
        if open_line:
            if is_face:
                tokens += len(part.split())
        else:
            # Only `f` lines are split: a 1M-vertex file must not pay for it.
            stripped = part.lstrip()
            is_face = stripped[:1] == OBJ_FACE_TOKEN and (
                len(stripped) == 1 or stripped[1:2].isspace()
            )
            tokens = len(stripped.split()) if is_face else 0
        if continued:
            open_line = True
            return 0
        open_line = False
        if not is_face:
            return 0
        is_face = False
        # tokens = "f" + k references ⇒ k - 2 triangles, never below 1 so a
        # malformed line still counts as geometry rather than as nothing.
        return max(1, tokens - 3)

    def consume(line: bytes) -> int:
        """One physical line, its backslash continuation folded as trimesh's."""
        if line.endswith(b"\r"):
            line = line[:-1]
        continued = line.endswith(OBJ_CONTINUATION)
        return fold(line[:-1] if continued else line, continued=continued)

    while True:
        if read >= limit_bytes:
            # Past the cap: only a file that ends exactly here is countable.
            if stream.read(1):
                return None
            break
        chunk = stream.read(min(XML_CHUNK_BYTES, limit_bytes - read))
        if not chunk:
            break
        read += len(chunk)
        buffer = tail + chunk
        cut = buffer.rfind(b"\n")
        if cut == -1:
            tail = buffer
            if len(tail) > OBJ_MAX_LINE_BYTES:
                # A whole OBJ written on one line: fold the complete tokens in
                # and carry only the last, possibly unfinished one, so the
                # buffer cannot grow with the file.
                split_at = tail.rfind(b" ")
                if split_at > 0:
                    total += fold(tail[:split_at], continued=True)
                    tail = tail[split_at:]
            continue
        tail = buffer[cut + 1 :]
        for line in buffer[:cut].split(b"\n"):
            total += consume(line)
    if tail:
        total += consume(tail)
    if open_line and is_face:
        # The file ended on a continuation; the face it opened still counts.
        total += max(1, tokens - 3)
    return total


def estimate_face_count(input_path: str, source_format: str) -> int | None:
    """Upper bound on the triangle count, read from the BYTES — no mesh loaded.

    `None` means "cannot be told cheaply": the precheck then lets the file
    through rather than refusing a part it has not measured. Every branch is an
    over-estimate or exact, never an under-estimate that would let an
    OOM-sized mesh past. Branch by branch, the bound is:

      stl, header size matches the file     exact (the declared facet count)
      stl, anything else                    max((size-84)//50, size//86), the
                                            larger of the binary-with-trailing-
                                            bytes and compact-ASCII ceilings
      obj                                   Σ max(1, references-2) per face
                                            line, i.e. the post-triangulation
                                            count (see count_obj_triangles)
      3mf                                   `<triangle` elements, exact
      obj/3mf longer than XML_SCAN_LIMIT    None (a truncated scan would
                                            under-count)
    """
    try:
        size = os.path.getsize(input_path)
        if source_format == "stl":
            with open(input_path, "rb") as handle:
                head = handle.read(BINARY_STL_HEADER_BYTES)
            if len(head) == BINARY_STL_HEADER_BYTES:
                declared = int.from_bytes(head[80:84], "little")
                # The only reliable binary-vs-ASCII test: the size the header
                # implies. ("solid" is not one — binary writers use it too.)
                if BINARY_STL_HEADER_BYTES + BINARY_STL_FACET_BYTES * declared == size:
                    return declared
            # Either ASCII, or binary whose header count disagrees with the
            # file (trailing bytes, a truncated tail, a lying writer). Take the
            # larger of the two byte ceilings so neither reading can slip past.
            return max(
                (size - BINARY_STL_HEADER_BYTES) // BINARY_STL_FACET_BYTES,
                size // ASCII_STL_MIN_FACET_BYTES,
                0,
            )
        if source_format == "obj":
            with open(input_path, "rb") as handle:
                return count_obj_triangles(handle, XML_SCAN_LIMIT_BYTES)
        if source_format == "3mf":
            # 3MF is a ZIP: 32 MB on disk can be 300 MB of XML, which is the
            # one format where the byte ceiling says nothing about the mesh.
            with zipfile.ZipFile(input_path) as package:
                entry = next(
                    (n for n in package.namelist() if MODEL_ENTRY_RE.match(n)), None
                )
                if entry is None:
                    return None
                with package.open(entry) as handle:
                    return count_token(handle, TRIANGLE_TOKEN, XML_SCAN_LIMIT_BYTES)
    except Exception as exc:  # noqa: BLE001 - a hint must never fail the job
        print(f"Warning: face precheck skipped: {exc}", file=sys.stderr)
    return None


def read_3mf_model_meta(input_path: str) -> tuple[str | None, int]:
    """(sourceUnits, objectCount) from the first `3D/*.model` entry.

    Deliberately NO XML parser: the package comes from an anonymous visitor and
    an entity-expansion bomb would be expanded before any element callback ran.
    Reading is chunked and capped, so a deflate bomb cannot blow the memory
    limit either.
    """
    try:
        with zipfile.ZipFile(input_path) as archive:
            names = sorted(n for n in archive.namelist() if MODEL_ENTRY_RE.match(n))
            if not names:
                return None, 0
            with archive.open(names[0]) as handle:
                head = handle.read(XML_HEAD_BYTES)
                matched = MODEL_UNIT_RE.search(head)
                unit = None
                if matched:
                    unit = UNIT_MAP.get(matched.group(1).decode("utf-8", "replace").strip().lower())
                count = head.count(MESH_TOKEN)
                overlap = head[-(len(MESH_TOKEN) - 1) :]
                read = len(head)
                while read < XML_SCAN_LIMIT_BYTES:
                    chunk = handle.read(XML_CHUNK_BYTES)
                    if not chunk:
                        break
                    read += len(chunk)
                    window = overlap + chunk
                    count += window.count(MESH_TOKEN)
                    overlap = window[-(len(MESH_TOKEN) - 1) :]
        return unit, count
    except Exception as exc:  # noqa: BLE001 - metadata is a hint, not the price
        print(f"Warning: 3MF metadata unreadable: {exc}", file=sys.stderr)
        return None, 0


def load_part(input_path: str, source_format: str) -> trimesh.Trimesh:
    """Full-resolution mesh, scale 1, Z-up, in the file's own units."""
    try:
        mesh = load_mesh(input_path)
    except Exception as exc:  # noqa: BLE001
        raise AnalysisError("load_failed", f"Mesh could not be loaded: {exc}") from exc
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise AnalysisError("empty_mesh", "File contains no triangles")
    if source_format == "obj":
        # OBJ is written Y-up by most modellers; STL and 3MF are Z-up. Every
        # later step (overhangs, the thumbnail, the printer) assumes Z-up.
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    return mesh


def count_bodies(mesh: trimesh.Trimesh, capped: bool) -> int:
    """Disconnected shells. Nothing is merged and nothing is dropped."""
    if capped:
        # Same count as split(), without building a submesh per component.
        components = trimesh.graph.connected_components(
            mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1
        )
        return int(len(components))
    return int(len(mesh.split(only_watertight=False)))


def overhang_area(mesh: trimesh.Trimesh, extent_z: float) -> float:
    """Down-facing area that needs support; the footprint on the plate is not it."""
    normals = mesh.face_normals
    down = normals[:, 2] < OVERHANG_NORMAL_Z
    if not bool(down.any()):
        return 0.0
    min_z = float(mesh.bounds[0][2])
    band = min_z + FLOOR_BAND_RATIO * float(extent_z)
    highest_vertex_z = mesh.triangles[:, :, 2].max(axis=1)
    on_floor = highest_vertex_z <= band
    return float(mesh.area_faces[down & ~on_floor].sum())


def required_number(value: float, label: str) -> float:
    number = float(value)
    if not np.isfinite(number):
        raise AnalysisError("bad_geometry", f"{label} is not a finite number")
    return number


def optional_number(value: float | None) -> float | None:
    if value is None:
        return None
    number = float(value)
    return number if np.isfinite(number) else None


def measure(
    mesh: trimesh.Trimesh,
    source_units: str | None,
    object_count: int,
    max_faces_walls: int,
    max_faces_bodies: int,
) -> dict:
    """The PartGeometry payload, measured on the untouched full-resolution mesh."""
    face_count = len(mesh.faces)
    walls_capped = face_count > max_faces_walls
    bodies_capped = face_count > max_faces_bodies
    extents = np.asarray(mesh.extents, dtype=float)
    watertight = bool(mesh.is_watertight)

    repaired: trimesh.Trimesh | None = None
    volume: float | None
    volume_estimated = False
    if watertight:
        volume = required_number(abs(mesh.volume), "volume")
    else:
        # The repair NEVER touches the mesh we measure, export or print.
        repaired = repair_with_pymeshlab(mesh.copy(), [])
        if repaired.is_volume:
            volume = optional_number(abs(repaired.volume))
            volume_estimated = volume is not None
        else:
            volume = None

    wall_p1: float | None = None
    wall_p5: float | None = None
    if not walls_capped:
        wall_p1, wall_p5 = estimate_wall_percentiles(repaired if repaired is not None else mesh)

    return {
        "volume": volume,
        "area": required_number(mesh.area, "area"),
        "extents": {
            "x": required_number(extents[0], "extents.x"),
            "y": required_number(extents[1], "extents.y"),
            "z": required_number(extents[2], "extents.z"),
        },
        "bodyCount": count_bodies(mesh, bodies_capped),
        "isWatertight": watertight,
        "isVolume": bool(mesh.is_volume),
        "volumeEstimated": volume_estimated,
        "faceCount": int(face_count),
        "wallP1": optional_number(wall_p1),
        "wallP5": optional_number(wall_p5),
        "overhangArea": required_number(overhang_area(mesh, extents[2]), "overhangArea"),
        "sourceUnits": source_units,
        "objectCount": int(object_count),
    }


def write_canonical_stl(mesh: trimesh.Trimesh, path: str) -> None:
    """Binary STL of the ORIGINAL geometry: unrepaired, undecimated, file units.

    This is the file the manufacturer prints, so it must not inherit any of the
    cosmetic simplifications the preview gets.
    """
    try:
        mesh.export(path, file_type="stl")
    except Exception as exc:  # noqa: BLE001
        raise AnalysisError("canonical_failed", f"canonical.stl could not be written: {exc}") from exc


def write_thumbnail(mesh: trimesh.Trimesh, path: str, size: int) -> None:
    # .copy(): simplify() hands the mesh straight back under 12k faces, and the
    # centring/scaling below would otherwise move the mesh we measure.
    view = simplify(mesh.copy())
    view.apply_translation(-view.bounds.mean(axis=0))
    largest = float(max(view.bounding_box.extents))
    if not np.isfinite(largest) or largest <= 0:
        raise ValueError("degenerate bounding box")
    view.apply_scale(1.0 / largest)

    elevation = trimesh.transformations.rotation_matrix(
        np.deg2rad(THUMB_ELEVATION_DEG), [1, 0, 0]
    )[:3, :3]
    azimuth = trimesh.transformations.rotation_matrix(
        np.deg2rad(THUMB_AZIMUTH_DEG), [0, 0, 1]
    )[:3, :3]
    rotation = elevation @ azimuth

    image = render_frame(view.triangles @ rotation.T, view.face_normals @ rotation.T, size)
    if Image is None:
        write_png(path, image)
        return
    Image.fromarray(image, mode="RGB").save(path, format="PNG", optimize=True)


def decimate_to(mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    """process_mesh.decimate_if_needed with the preview's own target."""
    if len(mesh.faces) <= target_faces or pymeshlab is None:
        return mesh
    meshset = pymeshlab.MeshSet()
    meshset.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
    meshset.meshing_decimation_quadric_edge_collapse(
        targetfacenum=target_faces,
        preserveboundary=True,
        preservenormal=True,
        preservetopology=True,
        planarquadric=True,
    )
    out = meshset.current_mesh()
    return trimesh.Trimesh(vertices=out.vertex_matrix(), faces=out.face_matrix(), process=True)


def write_preview_glb(mesh: trimesh.Trimesh, path: str) -> None:
    preview = decimate_to(mesh.copy(), PREVIEW_TARGET_FACES)
    # glTF is Y-up and model-viewer applies no up-axis fix of its own.
    preview.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    preview.export(path, file_type="glb")


def analyze(
    input_path: str,
    source_format: str,
    out_dir: str,
    thumb_size: int,
    max_faces_walls: int,
    max_faces_bodies: int,
    max_input_faces: int,
) -> dict:
    started = time.time()
    timings: dict[str, float] = {}
    warnings: list[str] = []

    # BEFORE load_part: the kernel's OOM killer cannot be caught, a refusal can.
    estimated_faces = estimate_face_count(input_path, source_format)
    if estimated_faces is not None and estimated_faces > max_input_faces:
        raise AnalysisError(
            "too_many_faces",
            f"Mesh has about {estimated_faces} triangles, above the {max_input_faces} ceiling",
        )

    mark = time.time()
    mesh = load_part(input_path, source_format)
    source_units: str | None = None
    object_count = 1
    if source_format == "3mf":
        source_units, object_count = read_3mf_model_meta(input_path)
        object_count = max(object_count, 1)
    timings["loadSeconds"] = round(time.time() - mark, 3)

    mark = time.time()
    geometry = measure(mesh, source_units, object_count, max_faces_walls, max_faces_bodies)
    timings["measureSeconds"] = round(time.time() - mark, 3)

    mark = time.time()
    write_canonical_stl(mesh, os.path.join(out_dir, "canonical.stl"))
    timings["canonicalSeconds"] = round(time.time() - mark, 3)

    # The thumbnail and the preview are cosmetic: a failure there must not void
    # a measurement the customer can already be quoted on.
    mark = time.time()
    try:
        write_thumbnail(mesh, os.path.join(out_dir, "thumb.png"), thumb_size)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"thumbnail_failed: {exc}")
        print(f"Warning: thumbnail failed: {exc}", file=sys.stderr)
    timings["thumbSeconds"] = round(time.time() - mark, 3)

    mark = time.time()
    try:
        write_preview_glb(mesh, os.path.join(out_dir, "preview.glb"))
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"preview_failed: {exc}")
        print(f"Warning: preview GLB failed: {exc}", file=sys.stderr)
    timings["previewSeconds"] = round(time.time() - mark, 3)

    timings["totalSeconds"] = round(time.time() - started, 3)
    return {"ok": True, "geometry": geometry, "timings": timings, "warnings": warnings}


def write_report(out_dir: str, payload: dict) -> None:
    with open(os.path.join(out_dir, "report.json"), "w") as handle:
        json.dump(payload, handle, indent=2, allow_nan=False)


def write_failure(out_dir: str, code: str, message: str) -> None:
    """Best effort: the exit code is the contract, the report is the detail."""
    try:
        write_report(out_dir, {"ok": False, "error": code, "message": message})
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: failure report not written: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure an uploaded part for an instant quote")
    parser.add_argument("input")
    parser.add_argument("format", choices=["stl", "obj", "3mf"])
    parser.add_argument("outdir")
    parser.add_argument("--thumb-size", type=int, default=512)
    parser.add_argument(
        "--max-faces-walls",
        type=int,
        default=DEFAULT_MAX_FACES_WALLS,
        help="above this face count wallP1/wallP5 are reported as null",
    )
    parser.add_argument(
        "--max-faces-bodies",
        type=int,
        default=DEFAULT_MAX_FACES_BODIES,
        help="above this face count bodyCount switches to the connected-components path",
    )
    parser.add_argument(
        "--max-input-faces",
        type=int,
        default=DEFAULT_MAX_INPUT_FACES,
        help="refuse a part whose estimated triangle count is above this (before loading it)",
    )
    parser.add_argument(
        "--max-address-space-gb",
        type=float,
        default=DEFAULT_ADDRESS_SPACE_GB,
        help="RLIMIT_AS ceiling in GB (reserved address space, not resident memory)",
    )
    args = parser.parse_args()

    # The image is size² × 3 bytes before compression; an absurd value would
    # hit RLIMIT_AS instead of producing a thumbnail.
    if args.thumb_size < 64 or args.thumb_size > 2048:
        print(f"Error: implausible thumbnail size {args.thumb_size}", file=sys.stderr)
        return 2
    if not (MIN_ADDRESS_SPACE_GB <= args.max_address_space_gb <= MAX_ADDRESS_SPACE_GB):
        print(
            f"Error: implausible address space limit {args.max_address_space_gb} GB",
            file=sys.stderr,
        )
        return 2
    if args.max_faces_walls < 1 or args.max_faces_bodies < 1 or args.max_input_faces < 1:
        print("Error: face ceilings must be positive", file=sys.stderr)
        return 2

    # After parsing (argparse allocates nothing) so the ceiling is the one the
    # caller asked for; the interpreter's own imports are already reserved.
    limit_address_space(args.max_address_space_gb)

    try:
        os.makedirs(args.outdir, exist_ok=True)
    except OSError as exc:
        print(f"Error: output directory unusable: {exc}", file=sys.stderr)
        return 2

    try:
        report = analyze(
            args.input,
            args.format,
            args.outdir,
            args.thumb_size,
            args.max_faces_walls,
            args.max_faces_bodies,
            args.max_input_faces,
        )
        write_report(args.outdir, report)
    except AnalysisError as exc:
        print(f"Error: {exc.code}: {exc.message}", file=sys.stderr)
        write_failure(args.outdir, exc.code, exc.message)
        return 2
    except MemoryError as exc:
        # Its own code: "this part is too heavy for the machine" is a different
        # message to the customer than "this file is broken".
        print(f"Error: out_of_memory: {exc}", file=sys.stderr)
        write_failure(args.outdir, "out_of_memory", str(exc))
        return 2
    except Exception as exc:  # noqa: BLE001 - every failure gets a report
        print(f"Error: internal: {exc}", file=sys.stderr)
        write_failure(args.outdir, "internal", str(exc))
        return 2

    geometry = report["geometry"]
    print(
        f"OK volume={geometry['volume']} area={geometry['area']:.3f} "
        f"faces={geometry['faceCount']} bodies={geometry['bodyCount']} "
        f"units={geometry['sourceUnits']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
