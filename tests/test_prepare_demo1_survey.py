import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("prepare_demo1_survey", ROOT / "prepare_demo1_survey.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_prepare_four_capture_files_with_explicit_station_join():
    examples = ROOT / "demo-1" / "examples"
    survey = MODULE.prepare_survey(examples / "stations.csv", [(f"P{i}", examples / f"capture-P{i}.csv") for i in range(1, 5)])
    assert len(survey["stations"]) == 4
    assert len(survey["samples"]) == 544
    assert survey["source"] == "field"
    assert survey["models"] == {}
    assert survey["references"] == {}
    assert {sample["stationId"] for sample in survey["samples"]} == {"P1", "P2", "P3", "P4"}


def test_duplicate_capture_and_station_conflicts_are_rejected():
    examples = ROOT / "demo-1" / "examples"
    with pytest.raises(ValueError, match="more than once"):
        MODULE.prepare_survey(examples / "stations.csv", [("P1", examples / "capture-P1.csv")] * 2)
    with pytest.raises(ValueError, match="conflicts"):
        MODULE.prepare_survey(examples / "stations.csv", [("P2", examples / "capture-P1.csv")])


def test_gps_export_headers_can_be_mapped_without_guessing(tmp_path):
    gps_file = tmp_path / "gps-export.csv"
    gps_file.write_text("Name,Lat,Lon,Accuracy\nP1,-12.04,-77.04,4.5\n")
    stations = MODULE.load_stations(gps_file, {"id": "Name", "latitude": "Lat", "longitude": "Lon", "accuracy": "Accuracy"})
    assert stations[0]["id"] == "P1"
    assert stations[0]["accuracyM"] == 4.5


def test_dbfs_probe_output_is_not_accepted_as_ap_rssi(tmp_path):
    capture = tmp_path / "probe.csv"
    capture.write_text("timestamp_utc,mean_power_dbfs,samples\n2026-09-28T12:00:00Z,-25,4096\n")
    with pytest.raises(ValueError, match="bssid"):
        MODULE.load_capture(capture, "P1", {"P1"})


def test_unknown_accuracy_and_timezone_are_not_silently_invented(tmp_path):
    gps_file = tmp_path / "gps.csv"
    gps_file.write_text("station_id,latitude,longitude\nP1,-12.04,-77.04\n")
    with pytest.raises(ValueError, match="gps_accuracy_m"):
        MODULE.load_stations(gps_file)
    capture = tmp_path / "capture.csv"
    capture.write_text("timestamp_utc,bssid,ssid,frequency_mhz,rssi_dbm,receiver_id,config_id\n2026-09-28T12:00:00,02:00:00:00:00:01,Lab,2437,-70,r1,c1\n")
    with pytest.raises(ValueError, match="timezone"):
        MODULE.load_capture(capture, "P1", {"P1"})
