#!/usr/bin/env python3
"""Render a 360° turntable MP4 of a model, for the customer approval message.

Usage:
    render_turntable.py <input.glb|stl> <output.mp4> [--frames 24] [--size 480]

Why a hand-rolled rasteriser: Meshy returns NO turntable video for image-to-3d
(`video_url` is null; only a single `thumbnail_url`), pyrender+OSMesa does not
build in this image, and matplotlib's painter algorithm tears on a 20k-face
mesh. This needs nothing but numpy — already a hard dependency of trimesh — and
gets correct occlusion from a real z-buffer.

ffmpeg is the only new system dependency. WhatsApp accepts H.264 mp4 with no
audio stream, which is what this writes.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time

import numpy as np
import trimesh

try:
    import pymeshlab
except ImportError:  # pragma: no cover
    pymeshlab = None

LIGHT = np.array([0.35, -0.75, 0.55])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
BG_RGB = np.array([246, 246, 248], dtype=np.float32)
MODEL_RGB = np.array([196, 200, 210], dtype=np.float32)
# Rendering cost is linear in face count; the print STL keeps the full detail.
TURNTABLE_FACES = 12_000
TILT_DEGREES = -12.0


def simplify(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    if len(mesh.faces) <= TURNTABLE_FACES or pymeshlab is None:
        return mesh
    try:
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        ms.meshing_decimation_quadric_edge_collapse(
            targetfacenum=TURNTABLE_FACES,
            preserveboundary=True,
            preservenormal=True,
            preservetopology=True,
            planarquadric=True,
        )
        out = ms.current_mesh()
        return trimesh.Trimesh(vertices=out.vertex_matrix(), faces=out.face_matrix(), process=True)
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: turntable simplify failed: {exc}", file=sys.stderr)
        return mesh


def render_frame(tris: np.ndarray, normals: np.ndarray, size: int) -> np.ndarray:
    """Orthographic z-buffer rasteriser. Camera looks along +y; z is up."""
    shade = np.clip(normals @ LIGHT, 0.0, 1.0) * 0.72 + 0.28
    colors = MODEL_RGB[None, :] * shade[:, None]

    xs, zs = tris[:, :, 0], tris[:, :, 2]
    lo = np.array([xs.min(), zs.min()])
    hi = np.array([xs.max(), zs.max()])
    span = float(max(hi - lo)) * 1.12 or 1.0
    cx, cz = (lo + hi) / 2.0
    sx = (xs - cx) / span * size + size / 2.0
    sy = size / 2.0 - (zs - cz) / span * size
    depth = tris[:, :, 1]

    img = np.repeat(np.repeat(BG_RGB[None, None, :], size, 0), size, 1)
    zbuf = np.full((size, size), np.inf, dtype=np.float32)

    for i in range(len(tris)):
        ix0 = max(0, int(np.floor(sx[i].min())))
        ix1 = min(size - 1, int(np.ceil(sx[i].max())))
        iy0 = max(0, int(np.floor(sy[i].min())))
        iy1 = min(size - 1, int(np.ceil(sy[i].max())))
        if ix1 < ix0 or iy1 < iy0:
            continue
        px, py = np.meshgrid(
            np.arange(ix0, ix1 + 1) + 0.5, np.arange(iy0, iy1 + 1) + 0.5
        )
        ax, ay = sx[i, 0], sy[i, 0]
        bx, by = sx[i, 1], sy[i, 1]
        cx2, cy2 = sx[i, 2], sy[i, 2]
        den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2)
        if abs(den) < 1e-9:
            continue
        w0 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den
        w1 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        zz = w0 * depth[i, 0] + w1 * depth[i, 1] + w2 * depth[i, 2]
        window = zbuf[iy0 : iy1 + 1, ix0 : ix1 + 1]
        hit = inside & (zz < window)
        if not hit.any():
            continue
        window[hit] = zz[hit]
        img[iy0 : iy1 + 1, ix0 : ix1 + 1][hit] = colors[i]

    return np.clip(img, 0, 255).astype(np.uint8)


def write_png(path: str, rgb: np.ndarray) -> None:
    """Minimal PNG writer so imageio/Pillow are not required."""
    import struct
    import zlib

    height, width, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def render_turntable(input_path: str, output_path: str, frames: int, size: int) -> float:
    started = time.time()
    mesh = trimesh.load(input_path, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("no renderable geometry")

    # glTF is Y-up; STL comes out of our own pipeline already Z-up.
    if input_path.lower().endswith((".glb", ".gltf")):
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))

    mesh = simplify(mesh)
    mesh.apply_translation(-mesh.bounds.mean(axis=0))
    mesh.apply_scale(1.0 / max(mesh.bounding_box.extents))

    tris, normals = mesh.triangles, mesh.face_normals
    tilt = trimesh.transformations.rotation_matrix(np.deg2rad(TILT_DEGREES), [1, 0, 0])[:3, :3]

    with tempfile.TemporaryDirectory() as tmp:
        for index, angle in enumerate(np.linspace(0, 2 * np.pi, frames, endpoint=False)):
            cos_a, sin_a = np.cos(angle), np.sin(angle)
            rot = np.array([[cos_a, -sin_a, 0], [sin_a, cos_a, 0], [0, 0, 1]]) @ tilt
            write_png(
                os.path.join(tmp, f"f_{index:03d}.png"),
                render_frame(tris @ rot.T, normals @ rot.T, size),
            )
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-framerate", "10",
                "-i", os.path.join(tmp, "f_%03d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path,
            ],
            check=True,
        )
    return time.time() - started


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a turntable MP4 of a 3D model")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--size", type=int, default=480)
    args = parser.parse_args()
    try:
        seconds = render_turntable(args.input, args.output, args.frames, args.size)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    size_bytes = os.path.getsize(args.output)
    print(f"turntable: {args.frames} frames in {seconds:.1f}s -> {size_bytes} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
