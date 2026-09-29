# Wi-Fi Geolocator

A local 2D experiment notebook for plotting Wi-Fi observation stations and
model-compatible AP location regions. Example data is explicitly simulated.
A receive-only B210 prototype now records decoded OFDM beacon metadata and
relative power. A live UNI_LIBRE_H AP yielded 287 beacons in a 30-second test;
its hidden beacon name required BSSID identification. See
[the live results](docs/b210-uni-libre-check.md). RF calibration and ranging
remain unvalidated, and sample-overflow events require further work.

## Run the demo

Clone the [private GitHub repository](https://github.com/ollerenac/wifi-geolocator)
using a GitHub account with access:

```bash
git clone https://github.com/ollerenac/wifi-geolocator.git
cd wifi-geolocator
```

For acquisition on another laptop, start with the
[Windows 10 installation and first-capture guide](docs/windows-10-setup.md).
It provides a pinned Radioconda Windows environment, USB setup, software
checks and a B210 capture command. Live RF is verified on Linux; Windows10
hardware acceptance remains to be performed on the destination laptop.

From this folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://127.0.0.1:8765/demo-1/** for the multi-AP survey, or
**http://127.0.0.1:8765/demo-0/** for the preserved original single-AP demo.
The original `/demo/` URL still works. No packages, external maps, internet
connection, accounts or build step are required. Use HTTP rather than opening
the HTML file directly, because the application uses JavaScript modules.

## Demo-1: stations and multi-AP captures

- Enter station GPS positions manually or import station CSV.
- Import repeated, timestamped BSSID-specific RSSI samples for each station.
- See an AP × station coverage table, including missing/brief detections.
- Assess count, observed time span, occupied bins, spread and station geometry.
- Keep identical SSIDs separate by BSSID/frequency and apply separate AP models.
- Automatically arrange local coordinates from station positions.
- Plot feasible APs individually or as a gallery; retain insufficient data reasons.
- Add independent known AP GPS references and export survey/results/plots.

Read [the demo-1 workflow and file contracts](docs/demo-1-workflow.md).
The offline `prepare_demo1_survey.py` helper joins GPS exports and existing
capture metadata; it does not collect live radio measurements. Read the
[B210 collector procedure and validation limits](docs/b210-collector.md) for
acquisition. Uncalibrated dBFS captures cannot yet enter demo-1's dBm-only
ranging workflow.

## Demo-0: the original single-AP experiment

- Select/deselect stations to compare one, two, three and four observations.
- Compare RSSI rings, directional bearings and the intersection of both.
- Edit station coordinates, GPS accuracy, AP-specific RSSI and optional bearings.
- Fit a simple RSSI model using separate known-distance calibration measurements.
- Start a field session and manually enter or import measurements.
- Save/reload JSON sessions; export CSV metadata or an SVG plot.

Changes stay in browser memory until you save a session. Save before resetting,
starting a new session or refreshing the page. Imported data stays local.

Read [the test methodology and CSV contract](docs/demo-methodology.md) before
using field data. [demo/examples/simulated-session.json](demo/examples/simulated-session.json)
is a complete synthetic example. [demo/examples/simulated-observations.csv](demo/examples/simulated-observations.csv)
illustrates the observation format; importing CSV classifies it as field input,
so these example rows must still be treated as simulated.

## Verify

```bash
node tests/test_demo_geometry.mjs
node tests/test_demo1_survey.mjs
/usr/bin/python3 -m pytest -q
```

The JavaScript tests verify coordinate conversion, calibration, uncertainty
geometry, multi-AP coverage, time-coverage gates, capture associations, import
validation and separation of AP references from estimates. Python tests cover
the B210 probe, offline survey preparation, beacon parsing, relative power,
calibration guards and collector CSV contracts. Run the decoder's hardware-free
integration check separately with `python3 b210_wifi_collector.py --self-test`.
These software tests do not validate RF calibration or field performance.
The existing pytest installation uses system Python; Radioconda remains the
environment for B210 hardware checks.

Before using an acquisition environment, run `python check_setup.py` in its
activated prompt, followed by `python b210_wifi_collector.py --self-test`.
The first checks imports/APIs and portable reference-file lookup without
opening hardware; the second runs generated-IQ decoding. Neither verifies USB
or replaces a live beacon test.

## Existing B210 probe

`b210_wifi_activity.py` receives aggregate signal samples on a selected 2.4 GHz
channel and prints mean power in **dBFS**. It does not identify BSSIDs, produce
AP-specific RSSI in dBm, or calculate a location. Run hardware tests using the
existing Radioconda/UHD environment described in [brainstorm.md](brainstorm.md).

The field design remains passive and metadata-only. See [project.md](project.md)
for the overall scope.
