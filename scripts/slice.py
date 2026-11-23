#!/usr/bin/env python3
"""Slice a local STL or geometry-only Courbure 3MF using a selected PrusaSlicer profile."""
import argparse
from math import isfinite
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from zipfile import BadZipFile, ZipFile


def read_profile(path):
    if path.suffix.lower() != ".ini" or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Choose a single PrusaSlicer exported configuration (.ini, up to 2 MiB).")
    text = path.read_text(encoding="utf-8-sig")
    settings = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]*", key) or key.lower() in settings:
            raise ValueError("Select one exported flat PrusaSlicer configuration with unique setting names.")
        if "\x00" in value:
            raise ValueError("Invalid character in the configuration.")
        settings[key.lower()] = value.strip()
    if settings.get("post_process", "").strip():
        raise ValueError("Post-processing commands must be empty in the selected profile.")
    required = ("printer_technology", "bed_shape", "nozzle_diameter", "filament_type",
                "filament_diameter", "temperature", "bed_temperature", "layer_height")
    if any(not settings.get(key, "").strip() for key in required):
        raise ValueError("The configuration must specify the FFF printer, bed, nozzle, material, temperatures and layer height.")
    if settings["printer_technology"].upper() != "FFF":
        raise ValueError("Select an FFF printer configuration.")
    return "".join(f"{key} = {value}\n" for key, value in settings.items())


def slice_model(model, profile, output, executable, center=None):
    if model.suffix.lower() not in (".stl", ".3mf") or not model.is_file():
        raise ValueError("Choose a local STL or a geometry-only Courbure 3MF.")
    if output.suffix.lower() != ".gcode" or not output.parent.is_dir():
        raise ValueError("Select a .gcode file in an existing output directory.")
    if os.path.lexists(output):
        raise ValueError("Output already exists. Choose a new G-code file.")
    placement = []
    if center is not None:
        x, y = center
        if not (isfinite(x) and isfinite(y)):
            raise ValueError("The print center requires finite X and Y coordinates in millimetres.")
        placement = ["--center", f"{x},{y}"]
    config = read_profile(profile)
    slicer = shutil.which(executable)
    if not slicer:
        raise ValueError("PrusaSlicer CLI is unavailable. Install it or pass --slicer with its executable path.")
    slicer = str(Path(slicer).resolve())
    with tempfile.TemporaryDirectory(prefix="courbure-slice-", dir=output.parent) as directory:
        work = Path(directory).resolve()
        source = work / ("specimen" + model.suffix.lower())
        shutil.copyfile(model, source)
        if source.suffix == ".3mf":
            with ZipFile(source) as archive:
                # Slicer projects can carry their own machine config and post-processing
                # commands. Only the three parts written by the core exporter are needed.
                if sorted(archive.namelist()) != sorted(("[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model")):
                    raise ValueError("Use Courbure's geometry-only 3MF or export the source model as an STL.")
        ini = work / "selected.ini"
        ini.write_text(config, encoding="utf-8")
        target = work / "specimen.gcode"
        data_dir = work / "slicer-data"
        data_dir.mkdir()
        subprocess.run([slicer, "--datadir", str(data_dir), "--load", str(ini), *placement, "--export-gcode",
                        "--no-binary-gcode", "--output", str(target), str(source)], cwd=work,
                       stdin=subprocess.DEVNULL, check=True, timeout=300)
        if not target.is_file():
            raise ValueError("The slicer did not produce a G-code file.")
        # Make sure the slicer emitted tool motion and an extrusion instruction.
        # This establishes file creation, not path quality or machine safety.
        with target.open("rb") as stream:
            if not any(line.startswith((b"G1 ", b"G01 ")) and b" E" in line and
                       (b" X" in line or b" Y" in line) for line in stream):
                raise ValueError("The slicer output contains no printable extrusion moves.")
        # Reserve the name exclusively before atomically publishing the complete
        # file. This also supports FAT-formatted printer cards without hardlinks.
        with output.open("xb"):
            pass
        try:
            os.replace(target, output)
        except OSError:
            output.unlink(missing_ok=True)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--slicer", default="prusa-slicer", help="PrusaSlicer command or executable path")
    parser.add_argument("--center", nargs=2, type=float, metavar=("X", "Y"),
                        help="Place the model at this print-bed center in millimetres.")
    args = parser.parse_args()
    try:
        slice_model(args.model, args.profile, args.output, args.slicer, args.center)
    except (OSError, UnicodeError, ValueError, BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, f"Slicing failed: {error}\n")
    print(f"Saved {args.output}. Inspect the toolpaths against the selected printer and material profile.")


if __name__ == "__main__":
    main()
