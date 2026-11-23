# Copyright 2026 Courbure contributors. SPDX-License-Identifier: Apache-2.0
"""Rebuild the exported Courbure beam graph as local FreeCAD B-rep geometry."""

import argparse
import json
import math
from pathlib import Path


def finite_number(value, lo, hi):
    return type(value) in (int, float) and lo <= value <= hi and math.isfinite(value)


def read_graph(path):
    # Bound the input before parsing, including oversized files without a newline.
    with Path(path).open("rb") as stream:
        data = stream.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("The graph JSON exceeds 16 MiB.")
    payload = json.loads(data)
    if not isinstance(payload, dict):
        raise ValueError("Expected an exported graph or a report containing graph.")
    graph = payload.get("graph", payload)
    if not isinstance(graph, dict) or graph.get("units") != "mm":
        raise ValueError("Expected a Courbure graph with units in mm.")
    nodes, members = graph.get("nodes"), graph.get("members")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 1800:
        raise ValueError("The graph must contain 1 to 1800 nodes.")
    if not isinstance(members, list) or not 1 <= len(members) <= 4500:
        raise ValueError("The graph must contain 1 to 4500 members.")
    if any(not isinstance(p, list) or len(p) != 3 or
           not all(finite_number(x, -1e6, 1e6) for x in p) for p in nodes):
        raise ValueError("Every node needs three finite coordinates in mm.")
    checked = []
    seen = set()
    for m in members:
        if not isinstance(m, dict):
            raise ValueError("Each member must be an object.")
        a, b = m.get("a"), m.get("b")
        if any(type(i) is not int or not 0 <= i < len(nodes) for i in (a, b)) or a == b:
            raise ValueError("Invalid member endpoints.")
        edge = (min(a, b), max(a, b))
        if edge in seen or math.dist(nodes[a], nodes[b]) <= 1e-7:
            raise ValueError("Duplicate or zero-length member.")
        seen.add(edge)
        ra = m.get("radius_a_mm", m.get("radius_mm"))
        rb = m.get("radius_b_mm", m.get("radius_mm"))
        if any(not finite_number(r, 1e-7, 1e5) for r in (ra, rb)):
            raise ValueError("Member endpoint radii must be positive finite values in mm.")
        checked.append((a, b, ra, rb))
    # A raw graph contains only centerlines. Crop the reconstruction to the
    # physical core only when an explicit BCC box recipe supplies its extents.
    limits = None
    spec = payload.get("spec")
    if spec is not None:
        if not isinstance(spec, dict) or spec.get("family") != "bcc" or spec.get("envelope") != "box":
            raise ValueError("A supplied recipe must describe a BCC box.")
        size, height, skin = spec.get("size_mm"), spec.get("height_mm"), spec.get("skin_mm", 0)
        if (not finite_number(size, 1e-6, 1e6) or not finite_number(height, 1e-6, 1e6)
                or not finite_number(skin, 0, height/2) or 2*skin >= height):
            raise ValueError("Invalid recipe dimensions.")
        limits = (size / 2, size / 2, height / 2 - skin)
        if any(abs(x) > h + 1e-6 for p in nodes for x, h in zip(p, limits)):
            raise ValueError("Node coordinates exceed the supplied core envelope.")
    return nodes, checked, limits


def convert(source, destination, *, fuse=False):
    """Save a new FCStd or STEP file. Set fuse=True to boolean-union the solids."""
    target = Path(destination).expanduser().resolve()
    if target.suffix.lower() not in (".fcstd", ".step", ".stp"):
        raise ValueError("Use an .FCStd, .step or .stp output filename.")
    if target.exists():
        raise FileExistsError(f"Choose a new output filename: {target}")
    nodes, members, limits = read_graph(source)
    import FreeCAD as App
    import Part

    vectors = [App.Vector(*point) for point in nodes]
    joints = [0.0] * len(vectors)
    pieces = []
    for a, b, ra, rb in members:
        axis = vectors[b] - vectors[a]
        if math.isclose(ra, rb, rel_tol=1e-10, abs_tol=1e-10):
            solid = Part.makeCylinder((ra+rb)/2, axis.Length, vectors[a], axis)
        else:
            solid = Part.makeCone(ra, rb, axis.Length, vectors[a], axis)
        pieces.append(solid)
        joints[a] = max(joints[a], ra)
        joints[b] = max(joints[b], rb)
    pieces.extend(Part.makeSphere(r, p) for p, r in zip(vectors, joints) if r > 0)
    if limits:
        hx, hy, hz = limits
        box = Part.makeBox(2*hx, 2*hy, 2*hz, App.Vector(-hx, -hy, -hz))

        def crosses_boundary(piece):
            bounds = piece.BoundBox
            return (bounds.XMin < -hx or bounds.XMax > hx or bounds.YMin < -hy or
                    bounds.YMax > hy or bounds.ZMin < -hz or bounds.ZMax > hz)

        pieces = [piece.common(box) if crosses_boundary(piece) else piece for piece in pieces]
    if fuse:
        shape = pieces[0].multiFuse(pieces[1:]).removeSplitter()
    else:
        shape = Part.Compound(pieces)
    solids = len(shape.Solids)
    if shape.isNull() or not shape.isValid() or not solids:
        raise ValueError("Open CASCADE could not generate a valid solid reconstruction.")
    if target.suffix.lower() == ".fcstd":
        doc = App.newDocument("Courbure")
        try:
            feature = doc.addObject("Part::Feature", "Lattice")
            feature.Label = "Fused lattice" if fuse else "Lattice members and joints"
            feature.Shape = shape
            doc.recompute()
            doc.saveAs(str(target))
        finally:
            App.closeDocument(doc.Name)
    else:
        shape.exportStep(str(target))
    return {"members": len(members), "nodes": len(nodes), "solids": solids, "fused": fuse,
            "cropped_to_box_core": limits is not None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Courbure graph or graph report JSON")
    parser.add_argument("destination", type=Path, help="New .FCStd, .step or .stp file")
    parser.add_argument("--fuse", action="store_true", help="Boolean-union the CAD solids (potentially expensive)")
    args = parser.parse_args()
    print(json.dumps(convert(args.source, args.destination, fuse=args.fuse)))
