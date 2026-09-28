# Wi-Fi Geolocator

## Project state

Discovery / feasibility. A local browser demo now plots manually entered or
imported observations and their uncertainty constraints. It starts with
simulated data and has not been field-validated. A receive-only OFDM beacon
collector prototype now exists: software decoding checks and B210 USB sampling
pass, and live UNI_LIBRE_H beacons have been decoded by BSSID. RF calibration
and field geolocation remain unvalidated; sample-overflow concerns remain.

Portability preparation now includes a pinned Radioconda Windows x64 release,
a software-environment check and portable PHY-reference lookup. Follow
[the Windows 10 setup](docs/windows-10-setup.md). The official Windows package
layout was inspected; software checks pass on Linux. Live acquisition on the
destination Windows10 laptop still requires its own acceptance test.

## Objective

Create a passive, field-testable system that estimates the location of a
selected Wi-Fi access point from directional measurements at three or more
known observation points.

## First deliverable

A validated prototype that records BSSID-specific bearing observations and
renders an uncertainty region from their intersection. It must be tested only
against authorized, known access points before operational consideration.

## Chosen direction

The current selected acquisition path is the B210 SDR with gr-ieee802-11 for
receive-only OFDM beacon decoding and per-frame relative power experiments.
A monitor-mode Wi-Fi adapter remains an alternative for discovery and reference
measurements. Directional bearings remain available in the original demo.

## Current B210 spike

`b210_wifi_activity.py` measures receive power on a selected 2.4 GHz channel.
It never transmits, decodes frames, identifies BSSIDs, or writes IQ samples.
Use the existing Radioconda UHD 4.8 environment for an authorized test with an
attached B210; do not install a parallel system UHD stack merely for this
project.

## 2D demonstration platform

See [README.md](README.md) to run the offline browser demo and
[docs/demo-methodology.md](docs/demo-methodology.md) for the first experiment.
It supports four editable stations, RSSI-derived distance bands as an
experimental baseline, directional bearing wedges, their sampled overlap,
CSV/JSON records, and comparison with an independent known AP coordinate.
RSSI mode requires calibration for meaningful field evaluation. Neither
shading nor the best-fit marker establishes a confidence percentage.

The first demo is preserved unchanged in `demo-0/`. The new `demo-1/` extends
the file workflow to multiple APs, explicit GPS/capture association, per-AP
coverage and collection-quality gates, automatic local coordinates, and plots
only for APs with sufficient usable geometry. See
[docs/demo-1-workflow.md](docs/demo-1-workflow.md). An SDR pipeline that decodes
Wi-Fi identities and relative per-frame training power is implemented and
software-tested and live-verified for UNI_LIBRE_H on channel 149. Its advertised
SSID is hidden; the laptop's cached Wi-Fi list supplied the name/BSSID mapping.
Calibrated dBm and oscar-wifi hotspot decoding remain unvalidated.
See [the collector procedure](docs/b210-collector.md).

The SDR decoder path has now been selected. The existing Radioconda environment
already provides GNU Radio 3.10.12, gr-ieee802-11, gr-foo and UHD 4.8; their
Python imports were verified. No source clone or additional installation was
needed for dependency readiness. The generated-beacon receiver checks pass.
KUDOS was independently verified on USB 3 and delivered samples at 20 MS/s;
a short 1/6/11 scan reported overflows and no decoded beacons. A later 30-second
channel-149 trial recorded 287 UNI_LIBRE_H target beacons with median relative
LTF power −30.56 dBFS; a BSSID-filtered follow-up retained only the target AP.
See [the live check](docs/b210-uni-libre-check.md). Throughput, RF/distance-model
calibration and multi-station location validation remain next.

## Boundaries

Version 1 is passive and metadata-only. It does not collect payload content,
transmit, interfere, identify Starlink service from Wi-Fi alone, or attribute
illegal activity.

## Primary planning reference

See [brainstorm.md](brainstorm.md) for the agreed field procedure, hardware
roles, validation sequence, risks, and unresolved decisions.
