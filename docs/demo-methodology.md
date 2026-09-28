# 2D positioning demo and first test methodology

## Ordered design

The four sketches translate into these independent parts:

1. **Test site:** a rectangle with east/north axes in metres. The rectangle is
   a plotting/search boundary, not an RF coverage boundary or a guaranteed
   enclosure of the AP.
2. **Stations:** measured observer coordinates, position accuracy, timestamps,
   target BSSID/channel and repeated signal observations.
3. **Measurement constraints:** distance bands inferred from a calibrated RSSI
   model, independently measured bearing wedges, or both.
4. **Estimate:** the sampled overlap and a best nominal fit within it. An empty
   overlap is retained as a diagnostic result.
5. **Evaluation:** a separately recorded known AP position, its reported
   accuracy, overlap containment, area, and position error. The estimator never
   receives that position.

RSSI-derived distances are **trilateration**; measured angles are
**triangulation**. Four separated stations provide redundancy. Four samples at
one station do not provide four independent spatial constraints.

The existing bearing-first field direction stays intact. The RSSI mode is an
experimental baseline for comparing the distance-ring design in the sketches.
It is not evidence that RSSI distances will perform well in remote terrain.

## What to measure

Use an authorized, fixed AP with an independently known coordinate. Identify
it by **BSSID**, since SSIDs need not be unique. Restrict observations to the
same BSSID and channel, using passive management-frame metadata from a
compatible Wi-Fi receiver. Antenna signal in radiotap is specified in dBm:
[Radiotap antenna signal](https://www.radiotap.org/fields/Antenna%20signal.html).

`b210_wifi_activity.py` measures aggregate channel-band power in dBFS. That is
neither AP-specific nor calibrated antenna power in dBm. Do not import it into
the RSSI field. A separate single-AP B210 power experiment could be designed,
but it requires its own units, gain calibration and signal-isolation model.

For RSSI ranging, prefer consistent receiver/antenna orientation and hardware
settings. If bearings are measured with a directional antenna, record those
sweeps separately; do not mix peak directional power with an omnidirectional
RSSI calibration. A combined result should use appropriately calibrated RSSI
and an independently measured true bearing.

Collect a short stationary series at each station; 30 or more observations is
a starting experimental convention, not a validated requirement. Keep the
same antenna height, polarization, channel, receiver configuration and AP
transmit settings. Save median RSSI, sample count, median absolute deviation
(MAD), timestamp and setup/environment notes. In this demo the entered raw
samples are used to calculate a summary and are not retained in saved sessions.
More samples can describe variation, but do not remove systematic model error.

## Coordinates and GPS uncertainty

SW Maps or another coordinate logger can provide latitude, longitude and
reported horizontal accuracy. The application accepts manually entered GPS
coordinates or CSV columns and transforms them into a small local plane:

```text
x = R × (longitude − origin_longitude) × cos(origin_latitude)
y = R × (latitude − origin_latitude)
```

Angles are in radians internally; R = 6,371,008.8 m. x points east and y points
north. Choose a southwest origin so all station coordinates are nonnegative.
The app limits plot sides to 3 km, individual GPS conversions to 5 km from the
origin and latitude to ±85°. This spherical approximation is intended for a
small demonstration site, not surveying. Use a proper projected CRS such as
the appropriate WGS84/UTM zone for larger sites or survey-grade requirements.

The AP GPS position is a reference measurement, not perfect ground truth.
The displayed error is the distance to its nominal coordinate, with its
reported accuracy shown separately. GPS error remains under open sky:
[GPS.gov accuracy](https://www.gps.gov/gps-accuracy). Reported accuracy is
treated as a positional expansion radius for exploring uncertainty. It is not
a guaranteed bound, and correlated GPS bias is not modelled here.

For a small first site, independently measured local coordinates can be useful
alongside GPS so positioning noise does not dominate the RF experiment.

## RSSI model and rings

The demo uses a log-distance model with an effective reference level A:

```text
RSSI(d) = A − 10 n log10(d / 1 m), for d ≥ 1 m
nominal distance = 10^((A − measured_RSSI) / (10 n)) m
```

The implementation saturates the predicted RSSI at A below 1 m; do not use the
demo to make near-field claims. A incorporates AP power, antennas and receiver
response. n describes the fitted rate of loss with distance. The free-space
case motivates n = 2, but an outdoor site is not automatically free space:
[ITU-R P.525](https://www.itu.int/rec/r-rec-p.525) describes free-space loss.
The example n = 2.2 and A = −38 dBm are synthetic scenario choices, not field
measurements, universal Wi-Fi constants, or recommended calibration values.

Fit A and n from at least three meaningfully separated **known distances** and
their median RSSIs. Prefer a broader calibration series with repeated readings
at each distance. Do not fit using the localization stations and then report
those same stations as independent validation. The UI fits an ordinary linear
regression of RSSI against log10(distance).

Choose an allowed absolute RSSI residual T in dB using separate validation
data. Fit RMS and sample MAD are diagnostics, not a complete choice of T.
Keep all calibration observations and receiver settings in a separate notebook;
this prototype saves the fitted parameters and calibration flag, not the raw
calibration series. Field CSV import clears that flag to avoid transferring
calibration silently to another receiver or target.

For each observation:

```text
minimum range = 10^((A − (RSSI + T)) / (10 n))
maximum range = 10^((A − (RSSI − T)) / (10 n))
```

Where RSSI + T ≥ A, the minimum becomes zero under the saturating model.
If RSSI − T > A there is no compatible range. Expand the interval by the
station position radius G: minimum = max(0, minimum − G), maximum += G.
These rings are conditional on the model parameters and chosen tolerance.
For example, with n = 2, a ±6 dB allowance changes the range by roughly a factor
of two in either direction before adding GPS uncertainty.

## Bearings and overlap

Bearing angles are true azimuths: north 0°, east 90°, south 180°, west 270°.
Account for compass calibration, magnetic declination, mounting alignment,
beam width, repeatability and multipath when selecting angular tolerance.
The software correctly compares angles around the 0°/360° boundary.

The bearing estimator conservatively widens the angular allowance by
arcsin(G / distance) for positional uncertainty; a candidate within the station
accuracy disk is admitted by its bearing constraint. Dashed plot boundaries
show nominal wedges; the final overlap includes the positional widening.

The estimator samples the rectangle on a grid with 240 cells along its longest
dimension. It accepts a cell centre only when it satisfies **every selected
constraint**. It preserves disjoint overlaps rather than filling their convex
hull. Area is the sum of accepted cell areas and is approximate. A region
touching the plot boundary may extend outside it. No sampled overlap can also
mean that the sampling grid missed a narrow continuous intersection; reduce
the site extent or increase the solver resolution when investigating that.

The best nominal fit minimizes normalized squared RSSI and/or angle residuals
among accepted cell centres. It is a useful reference marker, not a probability
maximum or proof that the AP lies there. GPS uncertainty broadens compatibility
but is not a probabilistic weighting of that point estimate. RSSI and bearing
errors may be correlated; combining them does not imply independent evidence.

## First field test

1. Establish AP and station coordinates independently. Record AP coordinate
   accuracy, antenna heights, AP settings, receiver details and environment.
2. Build an independent calibration dataset at known distances with fixed
   equipment settings. Fit A and n; use additional readings to explore T.
3. Choose four well-separated observation positions surrounding the AP where
   practicable. Keep geometry useful rather than choosing four collinear points.
4. At each position, collect repeated AP-specific RSSI metadata, timestamp and
   GPS accuracy; optionally perform repeated directional sweeps for bearings.
5. Save/import the measurements. Review each station before including it.
6. Estimate using three stations, then the fourth. Record area, reference
   containment and nominal point error for RSSI, bearings and combined modes.
7. Change T and the calibration parameters within plausible ranges to assess
   sensitivity. A seemingly precise result that disappears under small changes
   should not be considered robust.
8. Repeat with independent observation sets and then different AP placements.
   Retain no-overlap, clipped-region and reference-miss cases as failures.
9. Summarize repeated-trial containment rate, median and upper-tail position
   error, compatible-region area and failure rate. A single successful plot
   does not establish a confidence percentage.

The editable 600 m² / 10 m thresholds are placeholders for discussion.
`demo/trial-policy.mjs` contains the short exploratory acceptance rule. Define
useful size, acceptable error and required repeated-trial performance before
turning this experiment into an operational claim.

## CSV contract

Import a UTF-8 comma-separated CSV with the following names. Quoted commas,
double quotes and line breaks are supported. Each file must contain one BSSID
and one channel. It replaces the observation list, clears the known AP, clears
calibration and marks the session as field input.

| Column | Requirement / meaning |
| --- | --- |
| `id` | Optional unique station ID; defaults to M1, M2, … |
| `bssid` | Required MAC address, such as `02:00:00:00:00:01` |
| `ssid` | Optional advertised SSID |
| `channel` | Required integer channel, consistent throughout the file |
| `latitude`, `longitude` | Both required if GPS coordinates are supplied |
| `x_m`, `y_m` | Required if GPS coordinates are absent; east/north metres |
| `gps_accuracy_m` | Required nonnegative reported horizontal accuracy |
| `rssi_dbm` | Required median AP-specific antenna signal, −127 to 0 dBm |
| `bearing_deg` | Optional true azimuth, 0 ≤ angle < 360 |
| `bearing_tolerance_deg` | Required with bearing; positive half-angle ≤ 90° |
| `timestamp_utc` | Required ISO timestamp with Z or explicit timezone offset |
| `sample_count` | Required positive integer |
| `spread_db` | Required nonnegative MAD (zero is valid for one sample) |
| `enabled` | Optional `true` or `false`; default true |
| `notes` | Optional equipment/environment notes |

If both coordinate forms are present, GPS coordinates take precedence. Set
the origin and bounds before importing; points outside the rectangle produce
an error rather than disappearing from the plot. This is a documented minimal
CSV format, not an automatic importer for arbitrary SW Maps exports.

Save a **JSON session** to preserve the origin, bounds, model parameters, target,
observations and optional AP reference. Mode, plot-display toggles, exploratory
thresholds and unsaved form edits are not session data. SVG exports contain
the displayed plot plus session metadata, including the AP reference when set.

## Prototype scope

The app runs locally with no backend or dependencies. It does not access the
radio, GPS, network traffic, external maps or cloud storage. Coordinate logging
and passive BSSID-specific radio acquisition remain separate field tasks.
Browser changes must be saved manually before closing, resetting or refreshing.
