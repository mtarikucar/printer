#!/usr/bin/env python3
"""Contract test for scripts/step_mesh.py (the OCCT child CLI).

Usage:  $MESH_PYTHON scripts/test-step-mesh.py

Not wired into `npm run test:unit` on purpose: that chain is a string of
`npx tsx` calls and a python step in the middle would break it in CI. This file
is run by hand with the venv python, and it stands by name in the task's gate
list.

Every case below exists to prove ONE claim about the conversion, because each of
those claims is a way the price can silently go wrong:

  metre scale      cascadio writes glTF, and glTF is metres — a missing ×1000
                   would quote a 20 mm cube as a 0.02 mm one.
  file units       the kernel applies the file's OWN unit; we never assume mm.
  axis order       a swapped Y/Z would print the part lying on its side.
  solidCount       the assembly hint comes from the kernel's product structure,
                   not from counting connected components in the mesh.
  face pre-check   an oversized B-rep is refused from the BYTES, before OCCT
                   reserves anything (a 41k-face part measured 2.07 GiB peak
                   RSS — an OOM kill in the 2 g worker container).
  clean refusal    a broken STEP comes back as an exit code and a named error,
                   never a python traceback and never a silent abort.
  memory ceiling   --max-address-space-gb is a DEPLOYMENT KNOB: the number on
                   the command line is read back out of RLIMIT_AS, inside the
                   run, before OCCT reserves anything. A successful conversion
                   proves nothing here — limit_address_space() swallows every
                   setrlimit failure into a stderr warning, so a knob that
                   never applies looks identical from the outside.
  watertight       OCCT triangulates face by face; without vertex welding the
                   mesh reads "not watertight" and the manufacturer receives an
                   STL full of holes. This assertion is the task's acceptance
                   criterion, not a nicety.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
import trimesh

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(SCRIPTS_DIR, "step_mesh.py")
sys.path.insert(0, SCRIPTS_DIR)
# The face pre-check is also exercised directly: its whole job is to be EXACT
# across the chunk boundary, and the only way to assert that is to move the
# boundary under a file whose true count is known.
import step_mesh  # noqa: E402
FIXTURES = os.path.join(SCRIPTS_DIR, "fixtures", "quote")
# π r² h with r = 10 mm, h = 20 mm. The ONLY fixture whose true volume is known
# in closed form, so the only objective check on the tessellation budget.
CYLINDER_VOLUME_MM3 = math.pi * 100.0 * 20.0
VOLUME_BUDGET_PERCENT = 0.2

# Run in a CHILD, twice over, because RLIMIT_AS is a property of a process: this
# test process must not end up carrying the ceiling itself, and the thing under
# observation is the CLI's OWN run, not a re-implementation of it.
#
#   (1) limit_address_space() on its own — does setrlimit actually land?
#   (2) main() driven through argv — is the flag's value in force at the moment
#       convert() is entered? convert() is where cascadio reserves its arenas,
#       so anything later would be too late. The spy reads the live soft limit
#       and then calls the REAL conversion, so this is a full conversion of the
#       fixture under the ceiling, not a stub.
#
# Both numbers are printed as one JSON line; the parent asserts the exact bytes.
RLIMIT_PROBE_SOURCE = '''\
"""Read RLIMIT_AS back out of step_mesh: from the helper, and from a real run."""
import json
import resource
import sys

scripts_dir, step_path, out_stl = sys.argv[1:4]
sys.path.insert(0, scripts_dir)
import step_mesh

step_mesh.limit_address_space(4.0)
direct = resource.getrlimit(resource.RLIMIT_AS)[0]

observed = {}
real_convert = step_mesh.convert


def spy(*args, **kwargs):
    observed["soft"] = resource.getrlimit(resource.RLIMIT_AS)[0]
    return real_convert(*args, **kwargs)


step_mesh.convert = spy
sys.argv = ["step_mesh.py", step_path, out_stl, "--max-address-space-gb", "3"]
code = step_mesh.main()
print(json.dumps({"direct": direct, "inMain": observed.get("soft"), "exit": code}))
'''
PROBE_DIRECT_BYTES = 4 * 1024**3
PROBE_MAIN_BYTES = 3 * 1024**3

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {label}{'' if ok else f' ({detail})'}")
    if not ok:
        failures.append(label)


def run(
    workdir: str, fixture: str, *extra: str, source: str | None = None, tag: str = ""
) -> tuple[subprocess.CompletedProcess, str, dict | None]:
    outdir = os.path.join(workdir, (tag or fixture).replace(".", "-"))
    os.makedirs(outdir, exist_ok=True)
    out_stl = os.path.join(outdir, "out.stl")
    proc = subprocess.run(
        [sys.executable, CLI, source or os.path.join(FIXTURES, fixture), out_stl, *extra],
        capture_output=True,
        text=True,
        timeout=300,
    )
    meta_path = os.path.join(outdir, "meta.json")
    meta = None
    if os.path.exists(meta_path):
        with open(meta_path) as handle:
            meta = json.load(handle)
    return proc, out_stl, meta


def load_stl(path: str) -> trimesh.Trimesh:
    mesh = trimesh.load(path, file_type="stl")
    assert isinstance(mesh, trimesh.Trimesh)
    return mesh


def near(actual: object, expected: float, tolerance: float) -> bool:
    return isinstance(actual, (int, float)) and abs(actual - expected) <= tolerance


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="step-mesh-") as workdir:
        # ── cube20.step: the reference conversion, every output checked ───────
        proc, out_stl, meta = run(workdir, "cube20.step")
        check("cube20.step: exit 0", proc.returncode == 0, proc.stderr.strip()[-400:])
        check("cube20.step: meta.json written", meta is not None)
        if meta is not None:
            check(
                "cube20.step: meta.json carries exactly the contract keys",
                set(meta) == {"ok", "triangles", "solidCount", "scaleApplied", "tessellation"},
                f"keys={sorted(meta)}",
            )
            check("cube20.step: meta ok", meta.get("ok") is True, json.dumps(meta)[:200])
            check(
                "cube20.step: tessellation carries exactly the three parameters",
                isinstance(meta.get("tessellation"), dict)
                and set(meta["tessellation"]) == {"deflectionMm", "angularRad", "relative"},
                f"tessellation={meta.get('tessellation')}",
            )
            check(
                "cube20.step: scaleApplied is the MEASURED metre→mm factor",
                meta.get("scaleApplied") == 1000.0,
                f"scaleApplied={meta.get('scaleApplied')}",
            )
            check("cube20.step: solidCount 1", meta.get("solidCount") == 1,
                  f"solidCount={meta.get('solidCount')}")
            check("cube20.step: triangles 12", meta.get("triangles") == 12,
                  f"triangles={meta.get('triangles')}")
        if os.path.exists(out_stl):
            with open(out_stl, "rb") as handle:
                head = handle.read(6)
            check("cube20.step: out.stl is BINARY STL", head[:5] != b"solid", f"head={head!r}")
            mesh = load_stl(out_stl)
            check(
                "cube20.step: out.stl box is 20 mm — the metre scale was APPLIED",
                all(near(float(v), 20.0, 0.001) for v in mesh.extents),
                f"extents={np.round(mesh.extents, 6).tolist()}",
            )
            check(
                "cube20.step: out.stl is watertight — OCCT's face-by-face "
                "triangles were WELDED, so the manufacturer gets no holes",
                mesh.is_watertight is True,
                f"vertices={len(mesh.vertices)} faces={len(mesh.faces)}",
            )
            check("cube20.step: meta.triangles matches the written STL",
                  meta is not None and meta.get("triangles") == len(mesh.faces),
                  f"meta={meta and meta.get('triangles')} stl={len(mesh.faces)}")
        else:
            check("cube20.step: out.stl written", False, "missing")

        # ── cube1in.step: 1-unit cube declared INCH. Proves the kernel applies
        #    the file's OWN unit; a mm assumption would quote a 1 mm cube. ─────
        proc, out_stl, meta = run(workdir, "cube1in.step")
        check("cube1in.step: exit 0", proc.returncode == 0, proc.stderr.strip()[-400:])
        if os.path.exists(out_stl):
            mesh = load_stl(out_stl)
            check(
                "cube1in.step: out.stl box is 25.4 mm — the FILE's inch unit was "
                "converted by the kernel, not assumed to be mm",
                all(near(float(v), 25.4, 0.001) for v in mesh.extents),
                f"extents={np.round(mesh.extents, 6).tolist()}",
            )

        # ── bracket_asym.step: 10 × 20 × 40. glTF is a Y-up format, so the
        #    question "does the STEP path need the +90° X rotation the OBJ
        #    branch applies" is answered here, by the axis ORDER. ─────────────
        proc, out_stl, meta = run(workdir, "bracket_asym.step")
        check("bracket_asym.step: exit 0", proc.returncode == 0, proc.stderr.strip()[-400:])
        if os.path.exists(out_stl):
            mesh = load_stl(out_stl)
            check(
                "bracket_asym.step: extents are (10, 20, 40) in THAT order — the "
                "part comes out Z-up like the source, no rotation applied",
                [round(float(v), 3) for v in mesh.extents] == [10.0, 20.0, 40.0],
                f"extents={np.round(mesh.extents, 6).tolist()}",
            )

        # ── two_bodies.step: two PRODUCTS in the STEP tree. ──────────────────
        proc, out_stl, meta = run(workdir, "two_bodies.step")
        check("two_bodies.step: exit 0", proc.returncode == 0, proc.stderr.strip()[-400:])
        if meta is not None:
            check(
                "two_bodies.step: solidCount 2 — the assembly hint comes from the "
                "KERNEL's product structure, not from splitting the mesh",
                meta.get("solidCount") == 2,
                f"solidCount={meta.get('solidCount')}",
            )
            check("two_bodies.step: triangles 24", meta.get("triangles") == 24,
                  f"triangles={meta.get('triangles')}")

        # ── cylinder_r10h20.step: the tessellation budget, measured. ─────────
        proc, out_stl, meta = run(workdir, "cylinder_r10h20.step")
        check("cylinder_r10h20.step: exit 0", proc.returncode == 0, proc.stderr.strip()[-400:])
        if os.path.exists(out_stl):
            mesh = load_stl(out_stl)
            error_percent = abs(mesh.volume - CYLINDER_VOLUME_MM3) / CYLINDER_VOLUME_MM3 * 100.0
            check(
                f"cylinder_r10h20.step: volume is within {VOLUME_BUDGET_PERCENT}% of the "
                f"analytic {CYLINDER_VOLUME_MM3:.2f} mm³ at the DEFAULT deflection",
                error_percent < VOLUME_BUDGET_PERCENT,
                f"volume={mesh.volume:.4f} error={error_percent:.4f}%",
            )
            check("cylinder_r10h20.step: out.stl is watertight",
                  mesh.is_watertight is True, f"faces={len(mesh.faces)}")

        # ── --max-faces: the B-rep pre-check, from the BYTES. Two files, one
        #    under the ceiling and one over it, with the SAME ceiling. ────────
        proc, out_stl, meta = run(
            workdir, "cylinder_r10h20.step", "--max-faces", "6", tag="maxfaces-under"
        )
        check("--max-faces 6: a 3-face part passes", proc.returncode == 0,
              proc.stderr.strip()[-400:])
        proc, out_stl, meta = run(
            workdir, "two_bodies.step", "--max-faces", "6", tag="maxfaces-over"
        )
        check("--max-faces 6: a 12-face part is refused with exit 2",
              proc.returncode == 2, f"returncode={proc.returncode}")
        check("--max-faces 6: the refusal is NAMED step_too_complex",
              meta is not None and meta.get("error") == "step_too_complex",
              f"meta={json.dumps(meta)[:200] if meta else None}")
        check(
            "--max-faces 6: refused BEFORE the mesh was built (no out.stl)",
            not os.path.exists(out_stl),
            "out.stl exists, so OCCT ran anyway",
        )
        check("--max-faces 6: no python traceback", "Traceback" not in proc.stderr,
              proc.stderr.strip()[-400:])

        # ── a truncated STEP: OCCT's own refusal, turned into an exit code. ──
        with open(os.path.join(FIXTURES, "cube20.step"), "rb") as handle:
            whole = handle.read()
        broken = os.path.join(workdir, "truncated.step")
        with open(broken, "wb") as handle:
            handle.write(whole[: len(whole) // 2])
        proc, out_stl, meta = run(workdir, "truncated.step", source=broken, tag="truncated")
        check("truncated.step: exit 2", proc.returncode == 2, f"returncode={proc.returncode}")
        check("truncated.step: the refusal is NAMED step_unreadable",
              meta is not None and meta.get("error") == "step_unreadable",
              f"meta={json.dumps(meta)[:200] if meta else None}")
        check("truncated.step: a C++ failure became a clean refusal, not a traceback",
              "Traceback" not in proc.stderr, proc.stderr.strip()[-400:])
        check("truncated.step: no out.stl left behind", not os.path.exists(out_stl))
        check(
            "truncated.step: OCCT's parser chatter is NOT forwarded (it quotes the "
            "offending source line, and in a STEP that can be the HEADER)",
            "ERR StepFile" not in proc.stderr and "ERR StepFile" not in proc.stdout,
            proc.stderr.strip()[-400:],
        )

        # ── --max-address-space-gb: the knob, OBSERVED in RLIMIT_AS. ─────────
        #    Without this probe nothing in this file can tell the knob from a
        #    no-op: gutting limit_address_space() (`return` at the top) and
        #    making setrlimit raise both leave every other check here green —
        #    measured, see the S1 fix report.
        probe_path = os.path.join(workdir, "rlimit_probe.py")
        with open(probe_path, "w") as handle:
            handle.write(RLIMIT_PROBE_SOURCE)
        probe_out = os.path.join(workdir, "as-probe", "out.stl")
        os.makedirs(os.path.dirname(probe_out), exist_ok=True)
        probe = subprocess.run(
            [sys.executable, probe_path, SCRIPTS_DIR,
             os.path.join(FIXTURES, "cube20.step"), probe_out],
            capture_output=True,
            text=True,
            timeout=300,
        )
        seen: dict = {}
        if probe.stdout.strip():
            try:
                seen = json.loads(probe.stdout.strip().splitlines()[-1])
            except ValueError:
                seen = {}
        probe_detail = f"stdout={probe.stdout.strip()[-200:]} stderr={probe.stderr.strip()[-200:]}"
        check(
            "limit_address_space(4) really lowers RLIMIT_AS to 4 GiB — the "
            "ceiling is APPLIED, not merely accepted on the command line",
            seen.get("direct") == PROBE_DIRECT_BYTES,
            probe_detail,
        )
        check(
            "--max-address-space-gb 3 is already in force when the conversion "
            "STARTS — the flag is a deployment knob, not a no-op",
            seen.get("inMain") == PROBE_MAIN_BYTES,
            probe_detail,
        )
        check(
            "the fixture still converts under the 3 GiB ceiling it was handed",
            seen.get("exit") == 0,
            probe_detail,
        )
        # The real CLI, same flag, across a real process boundary: the value is
        # pinned above, this only proves the flag does not break the CLI path.
        proc, out_stl, meta = run(
            workdir, "cube20.step", "--max-address-space-gb", "4", tag="as-ok"
        )
        check("--max-address-space-gb 4: the CLI still converts under an explicit "
              "ceiling", proc.returncode == 0, proc.stderr.strip()[-400:])
        # 1 GB is BELOW MIN_ADDRESS_SPACE_GB (2.5, the measured floor), so this
        # case is the argparse guard, not the conversion: it is refused before
        # any work, which is the point — a ceiling under the floor would make
        # OCCT die by signal instead of refusing, and a dead child writes no
        # report at all.
        proc, out_stl, meta = run(
            workdir, "cube20.step", "--max-address-space-gb", "1", tag="as-too-small"
        )
        check("--max-address-space-gb 1 (under the measured floor): refused with "
              "exit 2 before any work, not a MemoryError",
              proc.returncode == 2, f"returncode={proc.returncode}")
        check("--max-address-space-gb 1: no python traceback",
              "Traceback" not in proc.stderr and "MemoryError" not in proc.stderr,
              proc.stderr.strip()[-400:])
        check("--max-address-space-gb 1: the refusal says which limit is wrong",
              "address space" in proc.stderr.lower(), proc.stderr.strip()[-400:])
        check("--max-address-space-gb 1: refused with NO meta.json — an argument "
              "bug is the caller's, not a verdict on the customer's file",
              meta is None, f"meta={json.dumps(meta) if meta else None}")

        # ── the face counter itself: exact, whatever the chunk size. ─────────
        for fixture, expected in (
            ("cube20.step", 6),
            ("cylinder_r10h20.step", 3),
            ("two_bodies.step", 12),
        ):
            found, truncated = step_mesh.count_brep_faces(os.path.join(FIXTURES, fixture))
            check(f"count_brep_faces({fixture}) == {expected}, whole file",
                  (found, truncated) == (expected, False), f"found={found} truncated={truncated}")
        # One byte at a time puts a token boundary inside every window, which is
        # where an off-by-one over-counts (a false refusal) or under-counts (an
        # unmeasurable part admitted).
        real_chunk = step_mesh.SCAN_CHUNK_BYTES
        try:
            for chunk in (1, 7, 12, 13, 64):
                step_mesh.SCAN_CHUNK_BYTES = chunk
                found, truncated = step_mesh.count_brep_faces(
                    os.path.join(FIXTURES, "two_bodies.step"))
                check(f"count_brep_faces is exact with a {chunk}-byte chunk",
                      (found, truncated) == (12, False), f"found={found} truncated={truncated}")
        finally:
            step_mesh.SCAN_CHUNK_BYTES = real_chunk
        # Past the scan limit the count is a LOWER bound, and a lower bound that
        # already clears the ceiling is enough to refuse.
        real_limit = step_mesh.SCAN_LIMIT_BYTES
        try:
            step_mesh.SCAN_LIMIT_BYTES = 2048
            found, truncated = step_mesh.count_brep_faces(
                os.path.join(FIXTURES, "two_bodies.step"))
            check("count_brep_faces past the scan limit reports a truncated lower bound",
                  truncated is True and 0 <= found < 12, f"found={found} truncated={truncated}")
        finally:
            step_mesh.SCAN_LIMIT_BYTES = real_limit

    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nall step-mesh checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
