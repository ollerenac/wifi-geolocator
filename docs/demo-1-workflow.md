# Demo-1: multi-station, multi-AP survey

## Feasibility and architecture

The graphical/file workflow is feasible and implemented. The acquisition
pipeline is a distinct part of the experiment, not supplied by the existing
B210 receive-power probe. Demo-1 accepts per-frame AP metadata from a validated
collector and never treats aggregate SDR dBFS power as per-AP RSSI.

```text
GPS/manual station records ── station_id ──┐
                                        ├─ survey → AP coverage → quality checks
timestamped AP metadata ──── station_id ──┘                   ↓
                                          per-AP RSSI model → overlap plots
known AP GPS reference ─────────────────────────────────────→ evaluation only
```

`demo-0/` is an unchanged copy of the first single-AP demo. `demo/` remains
available at the original URL for compatibility. `demo-1/` is the new workflow
and reuses the frozen demo-0 geometry functions. No radio driver or UHD
environment was changed.

## Acquisition: the selected SDR path and current prototype

An SDR receives complex signal samples. Listing SSIDs/BSSIDs requires Wi-Fi
frame detection and decoding, and absolute antenna power in dBm needs measured
calibration. The original activity probe does neither; the separate collector
now decodes supported beacons and records AP-specific relative training power.

There is a possible SDR development route: the official
[gr-ieee802-11 repository](https://github.com/bastibl/gr-ieee802-11) documents
802.11a/g/p operation with B210 hardware. This establishes a research starting
point, not compatibility with every modulation, band or AP. A receive-only
pipeline, dependency compatibility, passive beacon decoding, gain calibration,
metadata timestamps, throughput and channel schedules must be validated before
connecting it to demo-1. Its default transceiver examples must not be assumed
to meet this project's receive-only requirements.

The alternative already proposed by the project is a monitor-mode Wi-Fi adapter
that exposes beacon identity and radiotap antenna signal in dBm:
[Radiotap antenna signal specification](https://www.radiotap.org/fields/Antenna%20signal.html).
The user has now selected the SDR decoder route. Environment inspection found
GNU Radio 3.10.12.0, UHD 4.8, `ieee802_11` and `foo` already installed in
Radioconda; actual imports succeeded. The `wifi_phy_hier.grc`,
`wifi_loopback.grc` and `wifi_rx.grc` examples are available under
`/home/researcher/radioconda/share/gnuradio/examples/ieee802_11/`.
Cloning/building the libraries is not required to begin. Decoder execution,
receive-only capture wiring, beacon compatibility and power calibration still
need validation; successful imports alone do not establish those capabilities.

Update: [the receive-only collector](b210-collector.md) is now implemented and
its generated-beacon integration checks pass, including identity, relative
power scaling, CRC rejection and frame/power association. KUDOS was independently
discovered over USB 3 and a short live sample-stream test completed with some
overflow events and zero decoded beacons. A later
[live UNI_LIBRE_H trial](b210-uni-libre-check.md) recorded287 target beacons in30s.
Its beacon name was hidden; the laptop's separate cache supplied the name/BSSID
mapping. RF power calibration and oscar-wifi identification remain unvalidated.
The collector records relative LTF power in
dBFS by default, leaves `rssi_dbm` empty, and therefore cannot yet feed demo-1's
dBm-only ranging contract. No dependency installation or driver change occurred.
For another laptop, use [the Windows10 setup guide](windows-10-setup.md);
Windows hardware acquisition still needs its own acceptance test.

No receiver inventory should claim **all nearby APs**. A limited-bandwidth
receiver cannot observe every Wi-Fi channel at once. A planned passive dwell
schedule can revisit selected channels at each station, but it may miss frames
or APs. Record the channel/frequency and receiver configuration; a nondetection
is not a known distance or proof of absence. A proper future collector should
also export dwell intervals, tuned frequencies, dropped-frame/sample counters
and receiver settings, not only the successfully decoded observations.

## Experiment in order

1. **Place the known AP.** Record its BSSID, intended frequency, latitude,
   longitude, coordinate accuracy, antenna height and transmit settings.
   Its SSID is a display name rather than the matching key.
2. **Calibrate separately.** Use known-distance measurements with consistent
   receiver/antenna settings to fit a model for that AP. Use independent
   validation readings to select the tolerated RSSI residual.
3. **Name each station.** At P1, P2, P3, etc., record latitude, longitude and
   horizontal accuracy. Remain stationary during the corresponding radio
   capture. A station ID means one physical position; a moved position requires
   a new ID even if it is visited minutes later.
4. **Record timestamped AP metadata.** At each station, follow the same passive
   frequency/dwell plan. Record BSSID, SSID when advertised, frequency, signal
   power in dBm and timestamps for repeated management-frame observations.
5. **Repeat at separated positions.** Three usable noncollinear positions are
   the initial geometry gate; a fourth adds redundancy. More observations at
   one position do not substitute for another location.
6. **Import GPS and captures.** Use the station ID inside each file, or assign
   a single-station capture explicitly in the UI. Conflicting associations,
   unknown station IDs and duplicate capture IDs are rejected.
7. **Review coverage per AP.** The table shows median RSSI and sample count for
   each station. A dash is missing data. A weak/brief series is retained for
   inspection but excluded by the current collection gates.
8. **Estimate and evaluate.** Inspect feasible AP plots individually or generate
   their gallery. Set separate models/references per BSSID and frequency.
   Record region area, nominal point error, reference containment, clipped
   regions and empty intersections. Repeat independent trials.

## Identity, frequency and missing detections

The grouping key is **BSSID + centre frequency**, not SSID. Identical SSID names
remain separate rows. Hidden SSIDs remain selectable by BSSID. Multiple SSID
names for one group are retained as metadata. Frames on different frequencies
are not silently pooled, even when the BSSID is the same; investigate channel
changes rather than averaging incompatible RF conditions.

Receiver/configuration IDs must describe the physical receiver and fixed
measurement settings, including antenna, polarization, orientation convention,
height, gain/AGC policy and calibration. Demo-1 will not estimate a group across
usable station series with differing IDs. The IDs are operator declarations;
the app cannot prove that hardware settings actually remained constant.

Samples heard at only one/two stations remain visible without a location fit.
A third detection may still be unusable if too brief, excluded by the operator,
from different receiver settings, or arranged in nearly collinear geometry.
Missing AP detections never become zero RSSI, infinite distance or exclusion
circles. Their cause could be propagation, scanning schedule or decoder failure.

## What the collection gates establish

The editable defaults are 30 samples per station/AP, at least 10 seconds of
observed sample span, at least 3 occupied 5-second bins, and MAD ≤ 6 dB.
These are **exploratory choices**, not statistically justified universal minima.
`demo-1/quality-policy.mjs` contains the small user-editable decision rule.

The app preserves raw RSSI metadata, computes median/MAD, and summarizes spans
within each capture. Time between separate station visits is excluded from
observed duration. Time-bin coverage is counted separately for each capture.
It does not infer actual listening duration, dwell exposure, effective sample
size, independence, RSSI median confidence intervals or decoder completeness.
One packet can be duplicated upstream without the UI knowing; collectors must
avoid duplicates and should eventually supply frame identifiers/dwell logs.

The geometry gate requires at least three distinct nominal coordinates and a
minor/major covariance eigenvalue ratio ≥ 0.01. This screens nearly collinear
layouts; it does not guarantee strong geometry relative to GPS uncertainty or
the AP's unknown position. Plot sides are limited to 3 km. GPS conversion uses
the same small-site approximation as demo-0.

## Unknown AP calibration and interpretation

RSSI ranging uses `RSSI(d) = A − 10 n log10(d / 1 m)`. A incorporates transmit
power, receiver response and antennas. Both A and n need evidence. A calibration
for the controlled AP does not automatically transfer to unrelated APs.

An uncalibrated AP can have an **exploratory conditional plot** under editable
assumed parameters, but it cannot be described as reliably localized. With
unknown transmit/reference power, position and propagation parameters, three
RSSI readings do not by themselves resolve all unknowns. Estimating nuisance
parameters from more stations would be an additional modelling project with
its own identifiability and validation requirements.

The plot shows model-compatible constraints and a sampled overlap, not a
validated high-probability or 95% confidence region. Greater frame counts do
not fix systematic calibration errors or correlated shadowing. A fitted model
must be validated on data independent of the samples used to fit it.

The coordinate origin is placed southwest of **station positions only** using
an adjustable margin; x is east and y is north. Known AP references are excluded
from frame arrangement as well as the estimator. If an AP/reference or region
extends outside the plot, increase the margin explicitly. Nominal error is
shown alongside AP coordinate accuracy, not presented as error to a perfectly
known point.

## GPS file contract

The UI accepts a UTF-8 CSV with these exact columns:

```csv
station_id,latitude,longitude,gps_accuracy_m,notes
P1,-12.04629,-77.04267,5,Open field; stationary observation
```

Station IDs must be unique, latitude/longitude must be WGS84 decimal degrees,
and accuracy is in metres. The UI updates an existing station with the same ID,
so a correction also changes the coordinate associated with its captures.
Do not use that operation to reuse an ID for a different observation position.

SW Maps can export coordinates as CSV/spreadsheets; see the
[official SW Maps manual](https://aviyaantech.com/SwMaps/assets/SW%20Maps%20Manual%20V3.0.pdf).
Its export headers/project attributes may differ. Do not mistake UTM easting/
northing columns for latitude/longitude. Rename the columns for UI import, or
use the Python helper's explicit mapping options below. Unknown accuracy is
not silently filled in; supply the recorded accuracy or a documented estimate.

## Raw AP capture file contract

One row is one received AP-specific signal observation, not a precomputed
station summary:

```csv
station_id,capture_id,receiver_id,config_id,timestamp_utc,bssid,ssid,frequency_mhz,rssi_dbm
P1,P1-run-001,receiver-1,omni-setup-A,2026-09-28T12:00:00Z,02:00:00:00:00:01,Test AP,2437,-70
```

- `station_id`: required unless assigned explicitly in the UI/helper. If both
  are present they must agree.
- `capture_id`: unique capture identifier, associated with one station and one
  receiver/configuration pair. If absent, the UI/helper uses the filename stem.
  A capture can contain multiple APs and frequencies.
- `receiver_id`, `config_id`: required, consistent measurement equipment/settings.
- `timestamp_utc`: required ISO timestamp with Z or explicit timezone offset.
- `bssid`: required MAC address identifying the observed AP.
- `ssid`: optional advertised name; empty for an unknown/hidden name.
- `frequency_mhz`: required centre frequency in integer MHz, not a channel
  number. The demo validates an input range of 2300–7200 MHz, not regulatory
  availability or whether the input actually came from Wi-Fi.
- `rssi_dbm`: required AP-specific antenna signal between −127 and 0 dBm.

CSV files are limited to 1 MB each, with 50,000 samples, 30 stations and 100
BSSID/frequency groups per survey. Files with mixed capture IDs are allowed
provided each capture remains associated with a single position/configuration.

## Offline Python preparation helper

`prepare_demo1_survey.py` joins existing files into a saved JSON survey. It uses
only the Python standard library. **It does not acquire RSSI, decode Wi-Fi or
access an SDR.**

```bash
python3 prepare_demo1_survey.py \
  --gps stations.csv \
  --capture P1=capture-P1.csv \
  --capture P2=capture-P2.csv \
  --capture P3=capture-P3.csv \
  --capture P4=capture-P4.csv \
  --output field-survey.json
```

For different GPS export column names, add explicit mappings, for example:

```text
--gps-id-column Name
--gps-latitude-column Latitude
--gps-longitude-column Longitude
--gps-accuracy-column HorizontalAccuracy
```

These are illustrative header names, not a claim about every SW Maps export.
The helper rejects overwriting an existing output file. It creates a field
survey with **no calibration or AP references**, which can be added in demo-1.
The browser performs the complete survey validation on JSON import, including
the final local plot extent; the helper performs input/unit/association checks.

## Save/export and next acquisition work

Browser edits remain in memory until saved. Survey JSON preserves all samples,
stations, criteria, per-AP models and references. Exported station/RSSI CSV can
be reimported. Results CSV reports estimation availability rather than inventing
coordinates for insufficient data. SVG contains a plot and model/frame metadata.
No raw IQ, packet payloads, external maps or cloud uploads are part of the app.

The example files under `demo-1/examples/` are **simulated**, including the
station GPS CSV and capture CSV files. Loading them via field import tests the
workflow, not radio acquisition. The live collector will use the selected SDR
decoder path and still awaits implementation and hardware validation.
