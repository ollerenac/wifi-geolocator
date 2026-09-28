# Local demo verification — 2026-09-28

This verifies software behavior with simulated observations, not field accuracy
or radio hardware. No live signal measurements were collected.

## Automated checks

- `node tests/test_demo_geometry.mjs`: 12 checks passed.
- `/usr/bin/python3 -m pytest -q`: both existing B210 checks passed.
- `node --check demo/app.mjs`: syntax check passed.

The active `python3` points to Radioconda, which does not have pytest installed;
the existing system Python test environment was used without changing either
environment or installing another UHD stack.

## Browser checks

Verified with the local server and a browser:

- One/two/three/four selected stations update the region and diagnostics.
- Bearing and combined modes render and estimate successfully.
- New stations are disabled drafts until explicitly included.
- Missing bearings produce a diagnostic, not a silent fabricated observation.
- Changing the known AP changes evaluation without changing the estimate.
- RSSI median/MAD summary ignores a trailing separator and tolerates an outlier.
- Calibration fitting reports residuals and requires a separate validation flag.
- Manual field entry works and remains labelled uncalibrated until confirmed.
- JSON sessions download and restore; CSV import clears calibration/reference.
- SVG plot download works.
- Changing the origin preserves existing station GPS coordinates.
- A 390 px phone viewport has no horizontal page overflow; controls work.
- Final page load produces no browser console errors.

## Synthetic example results

The AP reference is (64, 46) m. These values are illustrative model results.

| Mode | Sampled region area | Best nominal fit (m) | Boundary clipped |
| --- | ---: | --- | --- |
| RSSI | 1,044 m² | (65.75, 45.75) | No |
| Bearings | 279.75 m² | (64.25, 46.75) | No |
| Combined | 279.75 m² | (64.75, 46.75) | No |

The reference satisfies the constraints in all three modes. RSSI nominal
position error is approximately 1.8 m despite its broad overlap. This difference
illustrates why point error alone does not describe uncertainty. No statistical
coverage claim follows from this synthetic trial.

Field acquisition, receiver calibration, GPS reference validation and repeated
trials in representative terrain remain required.
