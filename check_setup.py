#!/usr/bin/env python3
"""Check the active radio software environment without opening a USB device."""

import argparse
import importlib
import json
import platform
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

from radio_environment import find_phy_example


MODULES = {
    "numpy": (),
    "yaml": ("safe_load",),
    "pmt": ("intern", "init_u8vector", "c32vector_elements"),
    "gnuradio.gr": ("top_block", "hier_block2", "sync_block"),
    "gnuradio.blocks": ("vector_source_c", "moving_average_cc"),
    "gnuradio.fft": ("fft_vcc",),
    "gnuradio.uhd": ("usrp_source", "stream_args", "get_version_string"),
    "ieee802_11": ("LS", "BPSK_1_2", "mapper", "sync_short", "sync_long",
                   "frame_equalizer", "decode_mac"),
}


def inspect_environment():
    report = {
        "schema_version": 1,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "platform": platform.platform(), "architecture_bits": struct.calcsize("P") * 8,
        "python_version": platform.python_version(), "python_executable": sys.executable,
        "environment_prefix": sys.prefix, "checks": [], "warnings": [],
        "hardware_opened": False, "generated_iq_test_run": False,
    }
    checks = report["checks"]
    checks.append({"name": "python", "ok": sys.version_info >= (3, 10),
                   "detail": "Python 3.10 or newer is required"})
    checks.append({"name": "architecture", "ok": report["architecture_bits"] == 64,
                   "detail": "The documented radio distribution requires 64-bit Python"})
    loaded = {}
    for name, attributes in MODULES.items():
        try:
            module = importlib.import_module(name)
            missing = [attribute for attribute in attributes if not hasattr(module, attribute)]
            if missing:
                raise ImportError("Missing required APIs: " + ", ".join(missing))
            loaded[name] = module
            checks.append({"name": name, "ok": True, "detail": "Import and required APIs available"})
        except Exception as error:
            checks.append({"name": name, "ok": False,
                           "detail": f"{type(error).__name__}: {error}"})
    try:
        report["phy_example"] = str(find_phy_example())
        checks.append({"name": "phy_example", "ok": True, "detail": report["phy_example"]})
    except OSError as error:
        checks.append({"name": "phy_example", "ok": False, "detail": str(error)})
    versions = {}
    if "gnuradio.gr" in loaded:
        versions["gnuradio"] = loaded["gnuradio.gr"].version()
    if "gnuradio.uhd" in loaded:
        versions["uhd"] = loaded["gnuradio.uhd"].get_version_string()
    report["versions"] = versions
    for name, expected in (("gnuradio", "3.10.12"), ("uhd", "4.8.0")):
        if name in versions and not versions[name].startswith(expected):
            report["warnings"].append(f"{name} differs from the Linux baseline {expected}: {versions[name]}")
    report["ok"] = all(check["ok"] for check in checks)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Optional new JSON report; refuses overwriting")
    args = parser.parse_args(argv)
    report = inspect_environment()
    payload = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    print(payload, end="")
    if args.output:
        try:
            with args.output.open("x", encoding="utf-8") as stream:
                stream.write(payload)
        except OSError as error:
            print(f"Cannot save setup report: {error}", file=sys.stderr)
            return 2
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
