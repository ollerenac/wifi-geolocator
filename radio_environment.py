"""Portable lookup of the installed decoder's reference PHY example."""

import sys
from pathlib import Path


PHY_EXAMPLE_LOCATIONS = (
    "share/gnuradio/examples/ieee802_11/wifi_phy_hier.grc",
    "Library/share/gnuradio/examples/ieee802_11/wifi_phy_hier.grc",
    "share/gr-ieee802_11/examples/wifi_phy_hier.grc",
    "Library/share/gr-ieee802_11/examples/wifi_phy_hier.grc",
)


def find_phy_example(prefix=None):
    """Find constants in the active Python environment, on Linux or Windows."""
    root = Path(sys.prefix if prefix is None else prefix)
    candidates = [root / relative for relative in PHY_EXAMPLE_LOCATIONS]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(
        "The active environment lacks wifi_phy_hier.grc. Open the Radioconda "
        f"Prompt or activate the project radio environment. Searched: {searched}"
    )
