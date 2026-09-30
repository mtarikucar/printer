#!/usr/bin/env python3
"""Convert ONE STEP/STP file to a binary STL with OpenCASCADE (cascadio).

Usage:
    step_mesh.py <in.step> <out.stl>
                 [--deflection 0.01] [--angular 0.5] [--relative]
                 [--max-faces 20000] [--max-address-space-gb 8]

Writes <out.stl> and, in the same directory, meta.json:

    {"ok": true, "triangles": N, "solidCount": N, "scaleApplied": 1000.0,
     "tessellation": {"deflectionMm": …, "angularRad": …, "relative": false}}

Exit 0 on success. On refusal exit 2 and write meta.json as
    {"ok": false, "error": "<code>", "message": "…"}
with the same two codes the TypeScript side knows: `step_too_complex` (the B-rep
is bigger than the ceiling) and `step_unreadable` (OCCT could not read or could
not transfer the file).

THE META CONTRACT IS FIVE KEYS, NOT FOUR. Success and refusal write the SAME
file, so one of them has to say which it is: `ok` is that one field, and the
parent never has to infer the payload's shape from which keys happen to be
present (a truncated or half-written meta.json would otherwise read as a
measurement with missing numbers — and a missing number is a NaN in the price).
The exit code remains the contract; meta.json is the detail, written best effort.
`ok` is pinned in scripts/test-step-mesh.py. The file NAME is fixed, so the
parent (S2) must give every conversion its own output directory: two concurrent
conversions sharing one directory would overwrite each other's verdict.

TWO DEVIATIONS FROM THE DESIGN DOCUMENT, both measured, both in the S1 report:
`--deflection` defaults to 0.01 mm (the design proposed 0.05 — it loses 0.325 %
of the cylinder's volume, over the 0.2 % budget) and the tessellation unit is
`angularRad`, not the design's `angularDeg` (cascadio's parameter is radians).
S4's `STEP_TESSELLATION` in src/lib/config/quote-step.ts must be written with
THESE two values, or the frozen price is computed from a mesh this script never
produced.

WHY THIS IS A SEPARATE PROCESS from analyze_quote_part.py — three reasons, all
measured in the S1 spike report
(.superpowers/sdd/2026-09-22-anlik-teklif-motoru/task-s1-report.md):

  (a) analyze_quote_part.py's RLIMIT_AS floor is a MEASURED number
      (DEFAULT_ADDRESS_SPACE_GB = 8.0, see the comment above it) and the
      measurement was taken without OCCT in the address space. Importing
      cascadio reserves its own arenas on top: a part at the face ceiling below
      needed 2.10 GiB of RESERVED address space for the conversion alone. Put
      the two in one process and the parent's ceiling stops meaning what it was
      measured to mean.
  (b) OCCT does not raise. With RLIMIT_AS at 2 GiB the conversion of a
      20k-face part dies with SIGSEGV — no MemoryError, no traceback, an EMPTY
      stderr. A process that dies that way can write no report at all. As a
      child it can die freely: the parent is still alive to write report.json,
      which is what keeps the stuck-part sweep from re-queueing the same job
      every 20 minutes forever.
  (c) The child can be given its own tessellation budget: use_parallel=False
      and its own RLIMIT_AS, neither of which the parent wants.

KVKK — THE STEP HEADER IS NEVER LOGGED. ISO 10303-21 puts FILE_NAME and
FILE_DESCRIPTION in the HEADER section, and real CAD exports fill them with the
designer's name, the company and the local file path. Nothing from the header
reaches meta.json, stdout or stderr. OCCT's own parser diagnostics quote the
offending source line — which for a malformed file can be a header line — so the
conversion runs with file descriptors 1 and 2 redirected to /dev/null and this
script writes its own message instead (see `_silence_fds`).
"""
import argparse
import contextlib
import io
import json
import os
import resource
import sys

# THE ONLY `import cascadio` IN THE REPOSITORY, and it is deliberately at module
# level even though nothing but `convert` below needs it: docker/Dockerfile's
# import guard imports this module, so a missing wheel or an unresolvable OCCT
# shared object fails the IMAGE BUILD rather than a customer's upload. Deferring
# it would also buy nothing — MEASURED, `import cascadio` alone reserves
# 1.59 GiB of address space (148 MB resident) and adding trimesh on top reserves
# not one page more, so there is no cheap half of this pair to skip.
import cascadio
import trimesh

# cascadio writes glTF and glTF is defined in METRES (the format's own unit),
# whatever unit the STEP file declares: cascadio detects that unit and scales
# the output into metres. So the factor to millimetres is a pure constant, not a
# per-file value. MEASURED, not assumed, on two fixtures: cube20.step (mm) came
# out 0.02 long and cube1in.step (a 1-unit cube declared INCH) came out 0.0254 —
# ×1000 gives 20 mm and 25.4 mm. The same two fixtures guard it in
# scripts/test-step-mesh.py, because a lost ×1000 would quote a 20 mm cube as a
# 0.02 mm one and the price would be off by a factor of a billion in volume.
SCALE_TO_MM = 1000.0
# cascadio's own default, KEPT after measuring the alternative. The design
# proposed 0.05 mm on the grounds that it is invisible below an SLA layer; the
# measurement refused it: on cylinder_r10h20.step (analytic 6283.19 mm³) a
# 0.05 mm deflection tessellates the wall into 45 segments and loses 0.325 % of
# the volume — over the 0.2 % budget the programme accepted, and the volume is
# the price. 0.01 mm gives 100 segments and 0.066 %. The cost is 2.25× the
# triangles on that part, which the memory measurement can pay (see
# DEFAULT_MAX_BREP_FACES). Change this and the price of every part uploaded
# afterwards changes with it.
DEFAULT_DEFLECTION_MM = 0.01
# cascadio's tol_angular is in RADIANS (cascadio/__init__.py: "Angular
# deflection tolerance for meshing in radians. Default is 0.5"). The design
# document calls the same value `angularDeg`, which cannot be right: read as
# 0.5° it is 0.008727 rad, and MEASURED at that value the angular limit takes
# over from the linear one — the r10 cylinder jumps from 396 to 5756 triangles
# and the deflection stops mattering at all (0.01 and 0.05 give the identical
# mesh). At the B-rep face ceiling that factor of 14.5 would put the triangle
# count far above analyze_quote_part.py's DEFAULT_MAX_INPUT_FACES. The unit is
# radians here and in meta.json (`angularRad`).
DEFAULT_ANGULAR_RAD = 0.5
# The B-rep face ceiling, checked from the BYTES before OCCT reserves anything.
# What it really bounds is the TRIANGLE count the next process has to measure.
# MEASURED on two synthetic STEP files, inside the built worker image, under the
# production `mem_limit: 2g` (docker/docker-compose.production.yml):
#
#   20,001 B-rep faces (15.1 MB STEP) → this script: 0.96 GiB peak RSS, 19.2 s,
#     1,173,392 triangles, 58.7 MB STL → analyze_quote_part.py then measures it
#     in 1.44 GiB and 66.5 s. The whole part fits.
#   41,472 B-rep faces (30.2 MB STEP) → this script: 1.62 GiB peak RSS, 39.6 s,
#     2,433,024 triangles, 121.7 MB STL → analyze_quote_part.py REFUSES it,
#     `too_many_faces`, because it is above DEFAULT_MAX_INPUT_FACES (1.5M).
#
# So the second file's 39.6 s of OCCT work and 121.7 MB of disk are spent on a
# part that is refused anyway; this pre-check moves that refusal to 0.8 s and
# 0.16 GiB. And 1.62 GiB is only 19 % below the container limit while the
# triangles-per-face ratio is geometry-dependent (58.7 on these fixtures), so a
# curvier part of the same size would be an OOM kill — the worst failure
# available here, because the process dies mid-allocation, no report is written,
# and the stuck-part sweep re-queues the same job every 20 minutes forever.
#
# Note what this means for the general upload ceiling: SEED_MAX_FILE_BYTES
# (32 MiB) does NOT protect the worker on its own — a 30 MB STEP is a legal
# upload and produces 2.4M triangles. The face count, not the byte count, is the
# gate. Raise it only together with `mem_limit` and DEFAULT_MAX_INPUT_FACES, and
# only with a fresh measurement.
DEFAULT_MAX_BREP_FACES = 20_000
# RLIMIT_AS counts RESERVED address space, not resident memory. MEASURED with
# this stack: the imports alone reserve 1.59 GiB, the 20k-face conversion peaks
# at 2.10 GiB reserved (0.67 GiB resident). Hence the floor:
# at 2.0 GiB that conversion SEGFAULTS inside OCCT (see (b) in the module
# docstring), at 2.2 GiB it passes. 2.5 is the measured floor plus a little
# room; the default follows analyze_quote_part.py's measured 8.0 so the two
# processes are read with the same units, and the flag keeps the number a
# deployment knob instead of a constant baked into this file.
DEFAULT_ADDRESS_SPACE_GB = 8.0
MIN_ADDRESS_SPACE_GB = 2.5
MAX_ADDRESS_SPACE_GB = 256.0
# ISO 10303-21 entity names that carry ONE bounded face of a solid. AP214
# exports write ADVANCED_FACE; AP203 manifold-surface exports write
# FACE_SURFACE. Both are counted and the two counts are added, which can only
# over-count (no file uses both for the same face) — the safe direction for a
# ceiling. Counting is done on the raw bytes in chunks, so the cost is one
# sequential read and constant memory.
BREP_FACE_TOKENS = (b"ADVANCED_FACE", b"FACE_SURFACE")
SCAN_CHUNK_BYTES = 4 * 1024 * 1024
# Twice the general upload ceiling (SEED_MAX_FILE_BYTES, 32 MiB): a file longer
# than this is scanned only up to here, and the partial count is then a LOWER
# bound on the whole file — still enough to refuse, never enough to admit.
SCAN_LIMIT_BYTES = 64 * 1024 * 1024


class StepError(Exception):
    """A refusal with a code the TypeScript side already knows."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@contextlib.contextmanager
def _silence_fds(*filenos: int):
    """Send these file descriptors to /dev/null for the duration of the block.

    OCCT prints its diagnostics from C++ straight to a file descriptor, so
    nothing on the python side (`contextlib.redirect_stdout`, a logging handler)
    can intercept them — MEASURED: a truncated STEP puts
    "**** ERR StepFile : Undefined Parsing: Line 97: …" on fd 1, not fd 2. Those
    diagnostics quote the offending line of the file, and in a STEP that line
    can be a HEADER line carrying the designer's name, company or local path
    (see the KVKK note in the module docstring). Both descriptors are swapped
    for the OCCT call only, so python's own warnings outside that window are
    still visible.
    """
    saved = {fileno: os.dup(fileno) for fileno in filenos}
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        for fileno in filenos:
            os.dup2(devnull, fileno)
        yield
    finally:
        for fileno, copy in saved.items():
            os.dup2(copy, fileno)
            os.close(copy)
        os.close(devnull)


def _count_from(window: bytes, token: bytes, start: int) -> int:
    """Occurrences of `token` in `window` that begin at index `start` or later."""
    count = 0
    position = start
    while True:
        found = window.find(token, position)
        if found < 0:
            return count
        count += 1
        position = found + 1


def count_brep_faces(path: str) -> tuple[int, bool]:
    """(faces found, truncated) — read in chunks, constant memory.

    The window overlap is what makes the count exact across chunk boundaries,
    and the per-token start index is what keeps it from counting the same match
    twice. The overlap has to be as long as the LONGEST token minus one, which
    is long enough to hold a whole SHORTER token — so for each token, a match
    that already ended inside the previous window (index ≤ len(overlap) - len)
    is skipped. Getting this wrong in the over-counting direction would refuse a
    legitimate part; in the under-counting direction it would admit one that
    cannot be measured. Neither is acceptable, so the count is exact.

    `truncated` is True when the file is longer than SCAN_LIMIT_BYTES, in which
    case the count covers the scanned prefix only and is a lower bound.
    """
    longest = max(len(token) for token in BREP_FACE_TOKENS)
    count = 0
    overlap = b""
    read = 0
    with open(path, "rb") as handle:
        while read < SCAN_LIMIT_BYTES:
            chunk = handle.read(min(SCAN_CHUNK_BYTES, SCAN_LIMIT_BYTES - read))
            if not chunk:
                return count, False
            read += len(chunk)
            window = overlap + chunk
            for token in BREP_FACE_TOKENS:
                count += _count_from(window, token, max(0, len(overlap) - len(token) + 1))
            overlap = window[-(longest - 1):]
        return count, bool(handle.read(1))


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


def convert(
    path: str, deflection_mm: float, angular_rad: float, relative: bool
) -> tuple[trimesh.Trimesh, int]:
    """STEP bytes → (welded trimesh mesh in MILLIMETRES, solid count)."""
    with open(path, "rb") as handle:
        data = handle.read()

    with _silence_fds(1, 2):
        glb = cascadio.load(
            data,
            file_type="step",
            tol_linear=deflection_mm,
            tol_angular=angular_rad,
            tol_relative=relative,
            # One glTF mesh primitive per PART, which is what makes the solid
            # count below the kernel's own answer. With False, OCCT writes one
            # primitive per FACE (measured: the r10 cylinder becomes 3) and the
            # number would mean nothing.
            merge_primitives=True,
            # Measured on the 20k-face part: parallel is 9.3 s against 17.6 s
            # and produces a BYTE-IDENTICAL glTF, but costs 7 % more resident
            # memory (731 MB against 683 MB) in threads whose arenas we do not
            # control. In a 2 g container the predictable number wins, and
            # 17.6 s is 5.9 % of the analysis timeout.
            use_parallel=False,
        )

    # cascadio signals every read/transfer failure by returning EMPTY bytes
    # (its docstring: "or empty bytes on error"); it does not raise. Measured
    # against an empty file, random bytes, a truncated STEP and a
    # header-without-geometry STEP — all four came back as b"".
    if not glb:
        raise StepError(
            "step_unreadable",
            "OCCT could not read this STEP file (no geometry was transferred)",
        )

    loaded = trimesh.load(io.BytesIO(glb), file_type="glb")
    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise StepError("step_unreadable", "the STEP file carries no solid geometry")
        # The kernel's product structure, not a connected-component count on
        # the triangles: an assembly of two touching bodies is two solids here
        # and one component there.
        solid_count = len(loaded.geometry)
        mesh = loaded.to_mesh()
    else:
        solid_count = 1
        mesh = loaded

    if len(mesh.faces) == 0:
        raise StepError("step_unreadable", "the STEP file tessellated to an empty mesh")

    # WELDING IS PART OF THE CONVERSION, NOT COSMETICS. OCCT triangulates face
    # by face and writes each face with its own vertices, so a closed cube
    # arrives with 24 vertices instead of 8 and reads as NOT watertight. Left
    # unwelded, `not_watertight` would fire on every STEP part and — worse —
    # the manufacturer would receive an STL full of seams. Measured: 24 → 8
    # vertices, is_watertight False → True. The scale is applied afterwards;
    # measured, the order makes no difference to the result.
    mesh.merge_vertices()
    mesh.apply_scale(SCALE_TO_MM)
    return mesh, solid_count


def write_meta(out_stl: str, payload: dict) -> None:
    path = os.path.join(os.path.dirname(os.path.abspath(out_stl)), "meta.json")
    with open(path, "w") as handle:
        json.dump(payload, handle, indent=2, allow_nan=False)


def write_failure(out_stl: str, code: str, message: str) -> None:
    """Best effort: the exit code is the contract, meta.json is the detail."""
    print(f"Error: {code}: {message}", file=sys.stderr)
    try:
        write_meta(out_stl, {"ok": False, "error": code, "message": message})
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: meta.json not written: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Tessellate one STEP/STP file into a binary STL in millimetres"
    )
    parser.add_argument("input")
    parser.add_argument("output", help="binary STL to write; meta.json lands beside it")
    parser.add_argument(
        "--deflection",
        type=float,
        default=DEFAULT_DEFLECTION_MM,
        help="linear tessellation tolerance in mm (this value SETS THE PRICE)",
    )
    parser.add_argument(
        "--angular",
        type=float,
        default=DEFAULT_ANGULAR_RAD,
        help="angular tessellation tolerance in RADIANS (cascadio's unit)",
    )
    parser.add_argument(
        "--relative",
        action="store_true",
        help="read --deflection as a fraction of edge length instead of mm",
    )
    parser.add_argument(
        "--max-faces",
        type=int,
        default=DEFAULT_MAX_BREP_FACES,
        help="refuse a STEP with more B-rep faces than this (counted from the bytes)",
    )
    parser.add_argument(
        "--max-address-space-gb",
        type=float,
        default=DEFAULT_ADDRESS_SPACE_GB,
        help="RLIMIT_AS ceiling in GB (reserved address space, not resident memory)",
    )
    args = parser.parse_args()

    # Argument problems are the CALLER's bug, not the part's: they print and
    # stop, and they deliberately do not write a meta.json that would look like
    # a verdict on the customer's file.
    if not (0.0001 <= args.deflection <= 10.0):
        print(f"Error: implausible deflection {args.deflection} mm", file=sys.stderr)
        return 2
    if not (0.0001 <= args.angular <= 3.14159):
        print(f"Error: implausible angular tolerance {args.angular} rad", file=sys.stderr)
        return 2
    if args.max_faces < 1:
        print("Error: the face ceiling must be positive", file=sys.stderr)
        return 2
    if not (MIN_ADDRESS_SPACE_GB <= args.max_address_space_gb <= MAX_ADDRESS_SPACE_GB):
        print(
            f"Error: implausible address space limit {args.max_address_space_gb} GB "
            f"(measured floor {MIN_ADDRESS_SPACE_GB} GB: below it OCCT dies by signal "
            f"instead of refusing)",
            file=sys.stderr,
        )
        return 2

    out_dir = os.path.dirname(os.path.abspath(args.output))
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as exc:
        print(f"Error: output directory {out_dir} unusable: {exc}", file=sys.stderr)
        return 2

    try:
        # The pre-check FIRST, before any of the heavy imports: an oversized
        # B-rep must be refused without OCCT ever reserving an arena.
        faces, truncated = count_brep_faces(args.input)
        if faces > args.max_faces:
            raise StepError(
                "step_too_complex",
                f"this STEP file declares {'at least ' if truncated else ''}{faces} "
                f"B-rep faces, above the {args.max_faces} that fit in the worker",
            )
        # After the pre-check, and after argparse: the imports above have
        # already reserved their 1.59 GiB, so this ceiling covers what the
        # conversion adds on top of them — measured 2.10 GiB total at the face
        # ceiling, which is why MIN_ADDRESS_SPACE_GB is not 2.0.
        limit_address_space(args.max_address_space_gb)
        mesh, solid_count = convert(
            args.input, args.deflection, args.angular, args.relative
        )
        try:
            mesh.export(args.output, file_type="stl")
        except OSError as exc:
            # Disk, not geometry: not the customer's part being refused, so it
            # gets no verdict in meta.json — but it must not surface as a
            # traceback either, because the parent reads the exit code.
            print(f"Error: {args.output} could not be written: {exc}", file=sys.stderr)
            return 2
    except StepError as exc:
        write_failure(args.output, exc.code, exc.message)
        return 2
    except FileNotFoundError:
        print(f"Error: input not found: {args.input}", file=sys.stderr)
        return 2
    except MemoryError:
        # Reachable when the python side (not OCCT) hits RLIMIT_AS; OCCT itself
        # dies by signal and never gets here, which is the parent's problem.
        write_failure(
            args.output,
            "step_too_complex",
            "the conversion ran out of the address space it was given",
        )
        return 2

    write_meta(
        args.output,
        {
            "ok": True,
            "triangles": int(len(mesh.faces)),
            "solidCount": int(solid_count),
            "scaleApplied": SCALE_TO_MM,
            "tessellation": {
                "deflectionMm": float(args.deflection),
                "angularRad": float(args.angular),
                "relative": bool(args.relative),
            },
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
