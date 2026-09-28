import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from radio_environment import PHY_EXAMPLE_LOCATIONS, find_phy_example


@pytest.mark.parametrize("relative", PHY_EXAMPLE_LOCATIONS)
def test_phy_reference_lookup_supports_linux_and_windows_install_layouts(tmp_path, relative):
    expected = tmp_path / relative
    expected.parent.mkdir(parents=True)
    expected.write_text("Installed PHY reference", encoding="utf-8")
    assert find_phy_example(tmp_path) == expected


def test_missing_phy_reference_reports_active_environment_remedy(tmp_path):
    with pytest.raises(FileNotFoundError, match="Radioconda Prompt"):
        find_phy_example(tmp_path)
