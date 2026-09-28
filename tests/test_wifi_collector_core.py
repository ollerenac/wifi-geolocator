import csv
import json
import math
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import wifi_collector_core as core
import b210_wifi_collector as cli
import prepare_demo1_survey as survey


def beacon(ssid=b"Lab", address="020000000001", sequence=1, tsf=100):
    mac = bytes.fromhex(address)
    return (b"\x80\x00\x00\x00" + b"\xff" * 6 + mac + mac
            + struct.pack("<H", sequence << 4) + struct.pack("<QHH", tsf, 100, 1)
            + bytes([0, len(ssid)]) + ssid + b"\x03\x01\x06")


def settings():
    return {"device_serial": "KUDOS", "rx_channel": 0, "antenna": "RX2",
            "antenna_id": "test-omni", "frequency_hz": 2437e6,
            "sample_rate": 20e6, "bandwidth_hz": 20e6, "gain_db": 30,
            "power_method": core.POWER_METHOD}


def calibration():
    return {**settings(), "schema_version": 1, "calibration_id": "TEST-ONLY",
            "offset_db": -50, "evidence": "Synthetic test fixture; not a measured calibration"}


def dwell():
    return {"duplicate_beacons": 0, "saved_beacons": 0}


def test_only_beacons_are_parsed_and_hidden_or_binary_names_are_preserved():
    assert core.parse_beacon(b"\x08\x00" + b"user data") is None
    hidden = core.parse_beacon(beacon(b""))
    assert hidden["ssid"] == "" and hidden["bssid"] == "02:00:00:00:00:01"
    binary = core.parse_beacon(beacon(b"\xff\x00X"))
    assert binary["ssid_hex"] == "ff0058"
    assert "\x00" not in binary["ssid"]


@pytest.mark.parametrize("frame", [beacon()[:-1], beacon() + b"\x01",
                                        beacon() + b"\x00\x00", beacon(address="010000000001")])
def test_malformed_beacons_cannot_become_observations(frame):
    with pytest.raises(ValueError):
        core.parse_beacon(frame)


def test_bssid_filter_selects_hidden_beacons_without_inventing_a_name():
    hidden = core.parse_beacon(beacon(b"\x00"))
    address = core.normalize_bssid("02:AB:CD:EF:00:01")
    assert address == "02:ab:cd:ef:00:01"
    assert core.matches_beacon(hidden, target_bssid=hidden["bssid"])
    assert not core.matches_beacon(hidden, target_bssid=address)
    assert not core.matches_beacon(hidden, target_ssid="Lab")
    assert core.matches_beacon(hidden)
    assert hidden["ssid"] == "" and hidden["ssid_hex"] == "00"
    args = cli.parse_args(["--station", "P1", "--output", "new.csv", "--bssid", address.upper()])
    assert args.bssid == address
    with pytest.raises(SystemExit):
        cli.parse_args(["--station", "P1", "--output", "new.csv", "--bssid", address, "--ssid", "Lab"])


@pytest.mark.parametrize("address", ["UNI_LIBRE_H", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff",
                                      "01:00:00:00:00:01", "02:00:00:00:00:GG"])
def test_invalid_bssid_filters_rejected(address):
    with pytest.raises(ValueError):
        core.normalize_bssid(address)


def test_csi_power_has_parseval_normalization_and_amplitude_scaling():
    expected = 10 * math.log10(52 / 64 ** 2)
    assert core.ltf_power_dbfs([1] * 52) == pytest.approx(expected)
    assert core.ltf_power_dbfs([0.5] * 52) == pytest.approx(expected - 6.020599913)
    for csi in ([1] * 64, [0] * 52, [float("nan")] * 52):
        with pytest.raises(ValueError):
            core.ltf_power_dbfs(csi)


def test_uncalibrated_output_is_not_silently_importable_as_dbm(tmp_path):
    path = tmp_path / "capture.csv"
    writer = core.CaptureWriter(path, "P1", "run-1", "b210-KUDOS", {})
    try:
        writer.append(core.parse_beacon(beacon()), {"csi": [1] * 52, "snr": 20}, settings(), dwell())
    finally:
        writer.close("complete")
    row = next(csv.DictReader(path.open()))
    assert row["rssi_dbm"] == "" and float(row["ltf_power_dbfs"]) < 0
    assert row["snr_db"] == "20.000"
    with pytest.raises(ValueError, match="rssi_dbm"):
        survey.load_capture(path, "P1", {"P1"})
    manifest = json.loads(writer.manifest_path.read_text())
    assert not manifest["raw_iq_saved"] and not manifest["raw_frames_saved"]


def test_calibrated_metadata_contract_duplicates_and_bssid_identity(tmp_path):
    path = tmp_path / "capture.csv"
    writer = core.CaptureWriter(path, "P1", "run-1", "b210-KUDOS", {})
    counters = dwell()
    meta = {"csi": [1] * 52}
    first = core.parse_beacon(beacon())
    try:
        assert writer.append(first, meta, settings(), counters, calibration())
        assert not writer.append(first, meta, settings(), counters, calibration())
        second = core.parse_beacon(beacon(address="020000000002"))
        assert writer.append(second, meta, settings(), counters, calibration())
    finally:
        writer.close("complete")
    samples = survey.load_capture(path, "P1", {"P1"})
    assert len(samples) == 2
    assert len({row["bssid"] for row in samples}) == 2
    assert counters == {"duplicate_beacons": 1, "saved_beacons": 2}
    assert len(writer.ap_counts) == 2
    with pytest.raises(FileExistsError):
        core.CaptureWriter(path, "P1", "run-2", "b210-KUDOS", {})


@pytest.mark.parametrize("key,new", [("device_serial", "OTHER"), ("rx_channel", 1),
    ("antenna", "TX/RX"), ("antenna_id", "other-antenna"), ("frequency_hz", 2412e6),
    ("sample_rate", 25e6), ("bandwidth_hz", 10e6), ("gain_db", 40)])
def test_calibration_cannot_be_used_with_changed_receiver_settings(key, new):
    changed = {**settings(), key: new}
    with pytest.raises(ValueError, match=key):
        core.calibration_offset(calibration(), changed)


def test_placeholder_calibration_and_impossible_cli_settings_rejected(tmp_path):
    path = tmp_path / "calibration.json"
    profile = calibration()
    profile["offset_db"] = None
    path.write_text(json.dumps(profile))
    with pytest.raises(ValueError, match="offset_db"):
        core.load_calibration(path)
    for option in (["--gain", "nan"], ["--seconds-per-channel", "-1"],
                   ["--channels", "1,1"], ["--channels", "0"], ["--rounds", "0"]):
        with pytest.raises(SystemExit):
            cli.parse_args(["--station", "P1", "--output", str(path), *option])


def test_tiny_driver_frequency_rounding_does_not_invalidate_calibration():
    actual = {**settings(), "frequency_hz": 2437e6 + 0.00186}
    assert core.calibration_offset(calibration(), actual) == -50


def test_overflows_are_flagged_even_when_sample_coverage_looks_good():
    from collector_quality import assess_dwell
    measured = {"received_samples": 60_000_000, "near_full_scale_samples": 0,
                "saved_beacons": 30, "uhd_async_event_count": 1}
    assert assess_dwell(measured, 3, 20e6) == ["uhd_reported_events_inspect_for_overflow"]


def test_channel_and_configuration_id_do_not_mix_rf_settings():
    assert core.channel_frequency("2.4", 6) == 2437e6
    assert core.channel_frequency("5", 36) == 5180e6
    original = settings()
    assert core.config_id(original) != core.config_id({**original, "gain_db": 40})
