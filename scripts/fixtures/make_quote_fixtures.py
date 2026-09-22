#!/usr/bin/env python3
"""Regenerate the geometry fixtures under scripts/fixtures/quote/.

Usage:  python3 scripts/fixtures/make_quote_fixtures.py [out_dir]

Standard library only, on purpose: the bytes must not depend on the installed
trimesh version. The STL header is fixed and the 3MF zip entries carry a fixed
timestamp, so re-running this reproduces the committed files.

  cube20.stl      binary STL, one closed 20 mm cube (volume 8000 mm³)
  cube20.obj      the same cube as OBJ (shared vertices, 1-based faces)
  two_bodies.stl  binary STL, two disjoint closed 10 mm cubes (10 mm apart on X)
  open_box.stl    binary STL, the 20 mm cube with its +Z face missing
  cube1in.3mf     3MF, one 1-unit cube declared as <model unit="inch">
"""
import os
import struct
import sys
import zipfile

Vec = tuple[float, float, float]
Tri = tuple[int, int, int]

STL_HEADER_TAG = b"figurunica quote fixture"
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def box(lo: Vec, hi: Vec, skip_faces: tuple[tuple[int, int], ...] = ()) -> tuple[list[Vec], list[Tri]]:
    """An axis-aligned box as 8 shared vertices + 12 outward-wound triangles.

    `skip_faces` lists (axis, side) pairs to leave out, side 0 = min, 1 = max.
    """
    vertices: list[Vec] = []
    index: dict[Vec, int] = {}

    def vid(p: Vec) -> int:
        if p not in index:
            index[p] = len(vertices)
            vertices.append(p)
        return index[p]

    center = tuple((lo[i] + hi[i]) / 2 for i in range(3))
    faces: list[Tri] = []
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        for side in (0, 1):
            if (axis, side) in skip_faces:
                continue
            quad = []
            for cu, cv in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = [0.0, 0.0, 0.0]
                p[axis] = (lo, hi)[side][axis]
                p[u] = (lo, hi)[cu][u]
                p[v] = (lo, hi)[cv][v]
                quad.append(vid((p[0], p[1], p[2])))
            for a, b, c in ((quad[0], quad[1], quad[2]), (quad[0], quad[2], quad[3])):
                pa, pb, pc = vertices[a], vertices[b], vertices[c]
                normal = _cross(_sub(pb, pa), _sub(pc, pa))
                centroid = tuple((pa[i] + pb[i] + pc[i]) / 3 for i in range(3))
                # Counter-clockwise seen from outside: the normal points away
                # from the box centre.
                if _dot(normal, _sub(centroid, center)) < 0:
                    b, c = c, b
                faces.append((a, b, c))
    return vertices, faces


def combine(*parts: tuple[list[Vec], list[Tri]]) -> tuple[list[Vec], list[Tri]]:
    vertices: list[Vec] = []
    faces: list[Tri] = []
    for part_vertices, part_faces in parts:
        offset = len(vertices)
        vertices.extend(part_vertices)
        faces.extend((a + offset, b + offset, c + offset) for a, b, c in part_faces)
    return vertices, faces


def stl_bytes(name: str, vertices: list[Vec], faces: list[Tri]) -> bytes:
    # The header must not start with "solid", or readers take it for ASCII STL.
    header = (STL_HEADER_TAG + b": " + name.encode("ascii")).ljust(80, b"\0")[:80]
    out = [header, struct.pack("<I", len(faces))]
    for a, b, c in faces:
        pa, pb, pc = vertices[a], vertices[b], vertices[c]
        n = _cross(_sub(pb, pa), _sub(pc, pa))
        length = _dot(n, n) ** 0.5
        n = (n[0] / length, n[1] / length, n[2] / length)
        out.append(struct.pack("<12fH", *n, *pa, *pb, *pc, 0))
    return b"".join(out)


def _num(x: float) -> str:
    return f"{x:g}"


def obj_bytes(name: str, vertices: list[Vec], faces: list[Tri]) -> bytes:
    lines = [f"# {STL_HEADER_TAG.decode('ascii')}: {name}", f"o {name}"]
    lines += [f"v {_num(x)} {_num(y)} {_num(z)}" for x, y, z in vertices]
    lines += [f"f {a + 1} {b + 1} {c + 1}" for a, b, c in faces]
    return ("\n".join(lines) + "\n").encode("ascii")


CONTENT_TYPES_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
"""

RELS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
"""


def model_xml(unit: str, vertices: list[Vec], faces: list[Tri]) -> str:
    vertex_rows = "\n".join(
        f'          <vertex x="{_num(x)}" y="{_num(y)}" z="{_num(z)}" />' for x, y, z in vertices
    )
    triangle_rows = "\n".join(
        f'          <triangle v1="{a}" v2="{b}" v3="{c}" />' for a, b, c in faces
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="{unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
{vertex_rows}
        </vertices>
        <triangles>
{triangle_rows}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>
"""


def write_3mf(path: str, unit: str, vertices: list[Vec], faces: list[Tri]) -> None:
    entries = [
        ("[Content_Types].xml", CONTENT_TYPES_XML),
        ("_rels/.rels", RELS_XML),
        ("3D/3dmodel.model", model_xml(unit, vertices, faces)),
    ]
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in entries:
            info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            archive.writestr(info, text.encode("utf-8"), compresslevel=9)


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "quote")
    os.makedirs(out_dir, exist_ok=True)

    cube20 = box((0.0, 0.0, 0.0), (20.0, 20.0, 20.0))
    two_bodies = combine(
        box((0.0, 0.0, 0.0), (10.0, 10.0, 10.0)),
        box((20.0, 0.0, 0.0), (30.0, 10.0, 10.0)),
    )
    open_box = box((0.0, 0.0, 0.0), (20.0, 20.0, 20.0), skip_faces=((2, 1),))
    cube1 = box((0.0, 0.0, 0.0), (1.0, 1.0, 1.0))

    mesh_files = {
        "cube20.stl": stl_bytes("cube20", *cube20),
        "cube20.obj": obj_bytes("cube20", *cube20),
        "two_bodies.stl": stl_bytes("two_bodies", *two_bodies),
        "open_box.stl": stl_bytes("open_box", *open_box),
    }
    for name, data in mesh_files.items():
        with open(os.path.join(out_dir, name), "wb") as handle:
            handle.write(data)
    write_3mf(os.path.join(out_dir, "cube1in.3mf"), "inch", *cube1)

    for name in [*mesh_files, "cube1in.3mf"]:
        print(f"wrote {os.path.join(out_dir, name)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
