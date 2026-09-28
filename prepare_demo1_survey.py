#!/usr/bin/env python3
"""Join GPS CSV and existing AP RSSI metadata into a demo-1 survey.

This is an offline file preparation tool, not an SDR decoder or live collector.
It uses only Python's standard library and never opens a radio or transmits.
"""

import argparse
import csv
import json
import math
import re
from datetime import datetime
from pathlib import Path

BSSID = re.compile(r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}", re.IGNORECASE)
DEFAULT_LIMITS = {"minSamples": 30, "minSpanSeconds": 10, "minTimeBins": 3, "binSeconds": 5, "maxMadDb": 6}


def read_rows(path):
    """Read bounded UTF-8 CSV files without guessing field names or units."""
    path = Path(path)
    if path.stat().st_size > 1_000_000:
        raise ValueError(f"{path}: split CSV files into batches smaller than 1 MB.")
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError(f"{path}: CSV needs unique column names.")
        rows = list(reader)
    if not rows or any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError(f"{path}: CSV is empty or has inconsistent columns.")
    return rows


def number(row, column, minimum, maximum):
    try:
        value = float(row[column])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Missing or invalid {column}.") from error
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{column} must be between {minimum} and {maximum}.")
    return value


def text(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        raise ValueError(f"{name} must be nonempty text up to 100 characters.")
    return value.strip()


def load_stations(path, columns=None):
    """Map explicit GPS export headers to the application's station schema."""
    columns = columns or {"id": "station_id", "latitude": "latitude", "longitude": "longitude", "accuracy": "gps_accuracy_m"}
    stations = []
    seen = set()
    for row in read_rows(path):
        station_id = text(row.get(columns["id"]), "station ID")
        if station_id in seen:
            raise ValueError(f"Duplicate station ID: {station_id}.")
        seen.add(station_id)
        notes = row.get("notes", "")
        if len(notes) > 2000:
            raise ValueError("Station notes must be at most 2,000 characters.")
        stations.append({
            "id": station_id,
            "latitude": number(row, columns["latitude"], -85, 85),
            "longitude": number(row, columns["longitude"], -180, 180),
            "accuracyM": number(row, columns["accuracy"], 0, 500),
            "enabled": True, "notes": notes,
        })
    if len(stations) > 30:
        raise ValueError("Use at most 30 stations per survey.")
    # Conservative small-site check; the browser computes the final local frame.
    anchor = stations[0]
    for station in stations:
        dlat = math.radians(station["latitude"] - anchor["latitude"])
        dlon = math.radians((station["longitude"] - anchor["longitude"] + 180) % 360 - 180)
        distance = 6_371_008.8 * math.hypot(dlat, dlon * math.cos(math.radians(anchor["latitude"])))
        if distance > 5000:
            raise ValueError("Station positions exceed the 5 km local-coordinate limit.")
    return stations


def load_capture(path, station_id, known_stations):
    """Associate each validated AP metadata row with an explicitly named station."""
    if station_id not in known_stations:
        raise ValueError(f"Unknown station {station_id}.")
    samples = []
    for row in read_rows(path):
        if row.get("station_id", "").strip() not in ("", station_id):
            raise ValueError(f"Capture station_id conflicts with selected station {station_id}.")
        bssid = row.get("bssid", "").strip().lower()
        if not BSSID.fullmatch(bssid):
            raise ValueError("Each AP sample needs a valid bssid.")
        timestamp = row.get("timestamp_utc", "").strip()
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Use ISO timestamp_utc with a timezone.") from error
        if parsed.tzinfo is None or not re.match(r"^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$", timestamp):
            raise ValueError("Use ISO timestamp_utc with a timezone.")
        frequency = number(row, "frequency_mhz", 2300, 7200)
        if not frequency.is_integer():
            raise ValueError("frequency_mhz must be an integer.")
        ssid = row.get("ssid", "")
        if len(ssid) > 100:
            raise ValueError("SSID must be at most 100 characters.")
        samples.append({
            "stationId": station_id,
            "captureId": text(row.get("capture_id") or Path(path).stem, "capture ID"),
            "receiverId": text(row.get("receiver_id"), "receiver ID"),
            "configId": text(row.get("config_id"), "configuration ID"),
            "timestamp": timestamp, "bssid": bssid, "ssid": ssid,
            "frequencyMhz": int(frequency),
            "rssiDbm": number(row, "rssi_dbm", -127, 0),
        })
    return samples


def prepare_survey(gps_path, captures, columns=None, name="Imported field survey"):
    """Return a field survey; no AP locations or calibration are inferred."""
    stations = load_stations(gps_path, columns)
    known = {station["id"] for station in stations}
    samples = []
    capture_bindings = {}
    for station_id, path in captures:
        imported = load_capture(path, station_id, known)
        incoming_ids = {sample["captureId"] for sample in imported}
        if incoming_ids & capture_bindings.keys():
            raise ValueError("A capture ID was imported more than once. Use unique capture IDs.")
        for sample in imported:
            binding = (sample["stationId"], sample["receiverId"], sample["configId"])
            if sample["captureId"] in capture_bindings and capture_bindings[sample["captureId"]] != binding:
                raise ValueError("One capture ID has different receiver settings.")
            capture_bindings[sample["captureId"]] = binding
        samples.extend(imported)
    if len(samples) > 50_000:
        raise ValueError("Use at most 50,000 AP samples per survey.")
    if len({(sample["bssid"], sample["frequencyMhz"]) for sample in samples}) > 100:
        raise ValueError("Use at most 100 BSSID/frequency groups.")
    return {"version": 2, "source": "field", "name": text(name, "survey name"),
            "stations": stations, "samples": samples, "models": {}, "references": {},
            "limits": dict(DEFAULT_LIMITS), "paddingM": 25}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gps", type=Path, required=True)
    parser.add_argument("--capture", metavar="STATION_ID=CSV_PATH", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--name", default="Imported field survey")
    parser.add_argument("--gps-id-column", default="station_id")
    parser.add_argument("--gps-latitude-column", default="latitude")
    parser.add_argument("--gps-longitude-column", default="longitude")
    parser.add_argument("--gps-accuracy-column", default="gps_accuracy_m")
    args = parser.parse_args()
    try:
        captures = []
        for capture in args.capture:
            station_id, separator, path = capture.partition("=")
            if not separator or not station_id or not path:
                raise ValueError("Use --capture STATION_ID=CSV_PATH.")
            captures.append((station_id, Path(path)))
        columns = {"id": args.gps_id_column, "latitude": args.gps_latitude_column,
                   "longitude": args.gps_longitude_column, "accuracy": args.gps_accuracy_column}
        survey = prepare_survey(args.gps, captures, columns, args.name)
        # Refuse accidental replacement of an existing survey.
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(survey, stream, indent=2, allow_nan=False)
            stream.write("\n")
    except (OSError, ValueError) as error:
        parser.exit(2, f"error: {error}\n")
    print(f"Prepared {len(survey['stations'])} stations and {len(survey['samples'])} AP samples: {args.output}")


if __name__ == "__main__":
    main()
