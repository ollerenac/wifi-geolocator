"""Metadata-only beacon records and explicit power units; no radio dependencies."""

import csv
import hashlib
import json
import math
import re
import struct
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

POWER_METHOD = "ltf_csi_parseval_v1"
FIELDS = (
    "station_id", "capture_id", "receiver_id", "config_id", "timestamp_utc",
    "bssid", "ssid", "frequency_mhz", "rssi_dbm", "ltf_power_dbfs", "snr_db",
    "sequence_number", "beacon_tsf_us", "advertised_channel", "ssid_hex",
    "power_method", "calibration_id", "timestamp_basis",
)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def channel_frequency(band, channel):
    if band == "2.4" and 1 <= channel <= 13:
        return 2_412_000_000 + (channel - 1) * 5_000_000
    # Initial 5 GHz support deliberately accepts a small explicit channel set.
    if band == "5" and channel in (36, 40, 44, 48, 52, 56, 60, 64,
                                   100, 104, 108, 112, 116, 120, 124, 128,
                                   132, 136, 140, 144, 149, 153, 157, 161, 165):
        return 5_000_000_000 + channel * 5_000_000
    raise ValueError(f"Unsupported channel {channel} in band {band}")


def normalize_bssid(value):
    """Accept a colon-separated unicast AP address and normalize its case."""
    if not re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", value):
        raise ValueError("BSSID must contain six colon-separated hexadecimal bytes")
    address = bytes.fromhex(value.replace(":", ""))
    if address[0] & 1 or address == b"\0" * 6:
        raise ValueError("BSSID must be a nonzero unicast address")
    return value.lower()


def matches_beacon(beacon, target_ssid=None, target_bssid=None):
    """Match observed identity without inferring a hidden beacon's SSID."""
    return ((target_ssid is None or beacon["ssid"] == target_ssid)
            and (target_bssid is None or beacon["bssid"] == target_bssid))


def parse_beacon(frame):
    """Parse a CRC-validated decoder PDU (FCS already removed), or return None.

    User-data and other management frames are discarded. Only identity, beacon
    time/sequence and channel metadata leave this function.
    """
    if len(frame) < 2:
        raise ValueError("Truncated frame control")
    control = int.from_bytes(frame[:2], "little")
    if control & 0xFF != 0x80:  # version 0, management type, beacon subtype
        return None
    if control & 0xC300 or len(frame) < 36:  # DS/protected/order not supported
        raise ValueError("Unsupported or truncated beacon header")
    address = frame[16:22]
    if address[0] & 1 or address in (b"\0" * 6, b"\xff" * 6):
        raise ValueError("Invalid beacon BSSID")
    if frame[10:16] != address:
        raise ValueError("Beacon transmitter differs from BSSID")
    sequence_control = int.from_bytes(frame[22:24], "little")
    if sequence_control & 15:
        raise ValueError("Fragmented beacon is not supported")
    ssid = None
    advertised_channel = ""
    position = 36
    while position < len(frame):
        if position + 2 > len(frame):
            raise ValueError("Truncated information-element header")
        element, length = frame[position:position + 2]
        end = position + 2 + length
        if end > len(frame):
            raise ValueError("Truncated information element")
        value = frame[position + 2:end]
        if element == 0:
            if ssid is not None or length > 32:
                raise ValueError("Invalid or duplicate SSID element")
            ssid = value
        elif element == 3 and length == 1:
            advertised_channel = value[0]
        position = end
    if ssid is None:
        raise ValueError("Beacon lacks SSID element")
    # SSIDs are byte strings, not guaranteed UTF-8; preserve their hex identity.
    name = ssid.decode("utf-8", errors="replace") if any(ssid) else ""
    name = "".join(c if c.isprintable() else "\ufffd" for c in name)
    return {
        "bssid": ":".join(f"{part:02x}" for part in address),
        "ssid": name, "ssid_hex": ssid.hex(),
        "sequence_number": sequence_control >> 4,
        "beacon_tsf_us": struct.unpack_from("<Q", frame, 24)[0],
        "advertised_channel": advertised_channel,
    }


def ltf_power_dbfs(csi):
    """Parseval power of the averaged LTF estimate from the LS equalizer.

    The decoder exports 52 active tones from an unnormalized 64-point FFT.
    Sum squared tone magnitudes / 64**2 gives complex time-domain mean power.
    This is a training-symbol estimate, not full-packet/channel-average RSSI.
    """
    if len(csi) != 52:
        raise ValueError("Expected 52 LS channel-estimate tones")
    energy = sum(abs(complex(value)) ** 2 for value in csi)
    if not math.isfinite(energy) or energy <= 0:
        raise ValueError("Nonfinite or zero channel-estimate power")
    return 10 * math.log10(energy / (64 * 64))


def finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return value


def load_calibration(path):
    """Load one explicit measurement calibration; never invent a default offset."""
    raw = Path(path).read_bytes()
    profile = json.loads(raw)
    if not isinstance(profile, dict):
        raise ValueError("Calibration must be a JSON object")
    if profile.get("schema_version") != 1 or profile.get("power_method") != POWER_METHOD:
        raise ValueError("Unsupported calibration schema or power method")
    for key in ("calibration_id", "device_serial", "antenna", "antenna_id", "evidence"):
        if not isinstance(profile.get(key), str) or not profile[key].strip():
            raise ValueError(f"Calibration needs {key}")
    for key in ("rx_channel", "frequency_hz", "sample_rate", "bandwidth_hz", "gain_db", "offset_db"):
        finite_number(profile.get(key), key)
    return profile, hashlib.sha256(raw).hexdigest()


def calibration_offset(profile, settings):
    if profile is None:
        return None
    for key in ("device_serial", "rx_channel", "antenna", "antenna_id", "frequency_hz",
                "sample_rate", "bandwidth_hz", "gain_db"):
        # The B210's reported LO can differ from a nominal frequency by millihertz.
        tolerance = 1.0 if key in ("frequency_hz", "sample_rate", "bandwidth_hz") else 0.001
        matches = (abs(profile[key] - settings[key]) <= tolerance
                   if isinstance(profile[key], (int, float)) else profile[key] == settings[key])
        if not matches:
            raise ValueError(f"Calibration does not match actual receiver {key}")
    return profile["offset_db"]


def config_id(settings):
    encoded = json.dumps(settings, sort_keys=True, separators=(",", ":")).encode()
    return "b210-" + hashlib.sha256(encoded).hexdigest()[:16]


def identifier(value, name):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value):
        raise ValueError(f"{name} must be 1–80 letters, digits, dots, underscores or hyphens")
    return value


class CaptureWriter:
    """Append metadata, preserve diagnostics, refuse overwriting prior runs."""

    def __init__(self, output, station_id, capture_id, receiver_id, manifest):
        self.output = Path(output)
        self.manifest_path = self.output.with_suffix(self.output.suffix + ".json")
        if self.manifest_path.exists():
            raise FileExistsError(f"Already exists: {self.manifest_path}")
        self.manifest = manifest
        self.manifest.update({"station_id": station_id, "capture_id": capture_id,
                              "receiver_id": receiver_id, "started_utc": utc_now(),
                              "power_method": POWER_METHOD,
                              "timestamp_basis": "host_decode_receipt_utc",
                              "raw_iq_saved": False, "raw_frames_saved": False})
        self.file = self.output.open("x", encoding="utf-8", newline="")
        try:
            self.sidecar = self.manifest_path.open("x", encoding="utf-8")
        except Exception:
            self.file.close()
            raise
        self.csv = csv.DictWriter(self.file, fieldnames=FIELDS)
        self.csv.writeheader()
        self.file.flush()
        self.seen = OrderedDict()
        self.ap_counts = {}
        self.write_manifest()

    def append(self, beacon, metadata, settings, dwell, profile=None):
        key = (beacon["bssid"], settings["frequency_hz"], beacon["beacon_tsf_us"],
               beacon["sequence_number"])
        if key in self.seen:
            dwell["duplicate_beacons"] += 1
            return False
        power = ltf_power_dbfs(metadata["csi"])
        offset = calibration_offset(profile, settings)
        calibrated = "" if offset is None else power + offset
        if calibrated != "" and not -127 <= calibrated <= 0:
            raise ValueError("Calibrated power outside demo-1 range [-127, 0] dBm")
        snr = metadata.get("snr")
        snr = float(snr) if snr is not None else math.nan
        row = {**beacon,
               "station_id": self.manifest["station_id"],
               "capture_id": self.manifest["capture_id"],
               "receiver_id": self.manifest["receiver_id"],
               "config_id": config_id({k: v for k, v in settings.items() if k != "frequency_hz"}),
               "timestamp_utc": utc_now(),
               "frequency_mhz": round(settings["frequency_hz"] / 1e6),
               "rssi_dbm": "" if calibrated == "" else f"{calibrated:.3f}",
               "ltf_power_dbfs": f"{power:.3f}",
               "snr_db": f"{snr:.3f}" if math.isfinite(snr) else "",
               "power_method": POWER_METHOD,
               "calibration_id": profile["calibration_id"] if profile else "",
               "timestamp_basis": self.manifest["timestamp_basis"]}
        self.csv.writerow(row)
        self.file.flush()
        self.seen[key] = None
        if len(self.seen) > 4096:
            self.seen.popitem(last=False)
        dwell["saved_beacons"] += 1
        group = f"{beacon['bssid']}@{row['frequency_mhz']}"
        entry = self.ap_counts.setdefault(group, {"bssid": beacon["bssid"],
                                                 "ssid": beacon["ssid"], "count": 0})
        entry["count"] += 1
        return True

    def write_manifest(self):
        self.manifest["ap_summary"] = list(self.ap_counts.values())
        self.sidecar.seek(0)
        json.dump(self.manifest, self.sidecar, indent=2, allow_nan=False)
        self.sidecar.write("\n")
        self.sidecar.truncate()
        self.sidecar.flush()

    def close(self, status):
        self.manifest.update({"finished_utc": utc_now(), "status": status})
        self.write_manifest()
        self.sidecar.close()
        self.file.close()
