# Demo-1 verification — 2026-09-28

## Completed checks

- Original single-AP demo preserved: all 8 files in `demo-0/` match `demo/`
  byte for byte, including examples and preview.
- `node tests/test_demo_geometry.mjs`: 12 original geometry checks passed.
- `node tests/test_demo1_survey.mjs`: 14 new survey checks passed.
- `/usr/bin/python3 -m pytest -q`: 7 checks passed (2 B210 checks, 5 offline
  survey preparation checks).
- `node --check demo-1/app.mjs`: syntax check passed.
- Python CLI joined 4 station GPS records and 544 synthetic AP samples from
  4 independent capture CSV files into a field-format survey.
- JavaScript validated that Python output and recovered all 5 AP groups.
- Demo-1 page loaded and rendered in the browser without console errors.
  A desktop screenshot is saved as `demo-1/preview.png`.

## Meaningful behaviors covered by automated checks

Different BSSIDs with the same SSID remain separate. One BSSID at different
frequencies remains separate. Missing station detections do not produce
invented distances. Too-short series and same-timestamp bursts fail the time
coverage gates. Travel gaps between separate captures do not count as listening
span. Differing receiver settings block a cross-station estimate. Collinear or
repeated station coordinates fail the geometry gate. Duplicate and conflicting
capture imports are rejected. AP references cannot affect the auto-arranged
frame or the estimate. The noise-free known-model fixture estimates within one
grid-cell diagonal.

## Synthetic example

The 4 stations receive 544 samples spanning 5 BSSID/frequency groups. Each full
station/AP series has 45 samples over 22 seconds and 5 occupied 5-second bins.

| AP | Observed stations | Usable stations | Result |
| --- | ---: | ---: | --- |
| Field lab, BSSID ending 01 | 4 | 4 | Approx. 1,045 m² overlap; 1.6 m nominal error |
| Ridge station, ending 02 | 3 | 3 | Approx. 1,538 m² overlap; 6.2 m nominal error |
| Sparse signal, ending 03 | 2 | 2 | No location estimate |
| Brief capture, ending 04 | 3 | 2 | No estimate; P3 has only 4 samples |
| Field lab, ending 05 | 1 | 1 | Separate AP despite matching SSID; no estimate |

The reference satisfies the constraints for both estimated APs. These figures
are synthetic scenario results, not hardware accuracy claims or confidence
percentages. A three-station nominal fit can have appreciable error despite
containing the reference in its broader overlap.

## Browser verification limitation

The browser connector disconnected with `Transport closed` before the full
interaction test could run. The alternate computer-use connection had no
available browser. Consequently, interactive form/import/download flows and
the mobile rendering of **demo-1** have not been verified end to end in this
session. Demo-0's earlier browser checks do not establish demo-1 behavior.
The data/import logic, Python/JavaScript interoperability, page initialization
and desktop rendering were verified as listed above. No new browser-testing
dependencies were installed to work around the connector outage.

Live SDR/Wi-Fi acquisition, actual listening completeness, per-frame power
calibration, GPS reference accuracy and field positioning remain unverified.
