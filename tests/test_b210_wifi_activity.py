import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "b210_wifi_activity.py"


def load_detector_module():
    spec = importlib.util.spec_from_file_location("b210_wifi_activity", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_2_4_ghz_channel_6_has_its_standard_centre_frequency():
    detector = load_detector_module()

    assert detector.wifi_channel_to_hz("2.4", 6) == 2_437_000_000


def test_script_exposes_uhd_availability_flag():
    detector = load_detector_module()

    assert isinstance(detector.UHD_AVAILABLE, bool)
