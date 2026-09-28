# Wi-Fi Geolocator — Brainstorm

## Purpose

Develop a lawful, passive field system that helps an authorized team estimate
the location of a Wi-Fi access point in remote Peruvian terrain. The initial
field procedure uses several fixed observation points rather than continuous
tracking from a vehicle or aircraft.

The first version answers one narrow question: **where is the radio emitting
the selected Wi-Fi BSSID likely located?** It does not establish that the
network uses Starlink, that its users are present at the AP, or that it is
connected to illegal mining. Those are separate evidence and authorization
questions.

## Agreed MVP: hybrid receiver approach

Use a monitor-mode Wi-Fi adapter for dependable Wi-Fi discovery and BSSID /
channel identification. Use a directional Wi-Fi antenna to make bearing
measurements. Keep the USRP B210 available for spectrum validation and later
research, rather than making SDR decoding a prerequisite for the MVP.

| Component | Initial responsibility |
| --- | --- |
| Monitor-mode Wi-Fi adapter | Passively list BSSIDs, SSIDs when advertised, channels, and received-signal observations |
| Directional Wi-Fi antenna | Establish the direction of strongest repeatable reception |
| Laptop / field application | Bind radio observations to position, azimuth, time, and operator notes |
| Cellphone GPS | Supply latitude, longitude, time, and reported horizontal accuracy |
| Compass or calibrated IMU | Measure the *antenna's* true azimuth; do not rely solely on the phone compass |
| USRP B210 | Later: spectrum validation, controlled measurement experiments, and potential multi-antenna work |
| HackRF | Optional spectrum survey; not a precision direction-finding receiver for this MVP |

## Why not RSSI circles?

RSSI is not a dependable distance measurement in this environment. It varies
with AP transmit power, AP and receive-antenna orientation, foliage, terrain,
obstacles, reflections, weather, and receiver calibration. It is useful as a
supporting signal-quality measurement, but not as the radius of a circle.

Instead, each observation yields a **bearing wedge**:

```text
known observation position + antenna azimuth + angular uncertainty
    = likely direction from that observation point
```

The overlap of three or more wedges becomes a likelihood area. The result must
be reported as an uncertainty region, never a false-precision point.

## Field procedure

1. Select observation point A and record its GPS coordinate and reported
   horizontal accuracy.
2. Passively scan Wi-Fi management traffic. Do not capture communications
   payloads.
3. Select the candidate AP using its BSSID. SSID alone is insufficient because
   names are non-unique and can be changed.
4. Record supporting attributes: channel/frequency, SSID if broadcast,
   capabilities, vendor/OUI where available, and time.
5. Tune or select the target channel, attach/aim the directional antenna, and
   conduct a slow 360-degree sweep at least two or three times.
6. Record the strongest repeatable azimuth and an uncertainty angle derived
   from the antenna beam width, repeatability, and evident multipath.
7. Move to observation points B and C that give meaningfully different
   geometry while preserving the ability to detect the target BSSID.
8. Re-identify the same target BSSID/channel and repeat the measurement.
9. Combine the observations into a map of observation points, bearing wedges,
   their intersection, and a confidence assessment.
10. Flag rather than force a conclusion when the wedges do not intersect
    plausibly, the BSSID cannot be reproduced, or reflections dominate.

## Minimum observation record

```text
case / mission ID
operator ID
timestamp (UTC)
BSSID
SSID (optional / if advertised)
channel and centre frequency
GPS latitude, longitude, and reported horizontal accuracy
antenna azimuth (true north) and estimated angular uncertainty
peak and repeatable RSSI observations
antenna type / gain / polarization
environment notes: vegetation, terrain, weather, nearby metal or vehicle
```

## Wi-Fi and satellite context

Current Starlink routers can use IEEE 802.11a/b/g/n/ac/ax, principally in the
2.4 GHz and 5 GHz Wi-Fi bands. A B210 covers those bands, while it does not
directly receive the primary Starlink user link.

Starlink user-terminal links are commonly authorized in Ku-band, including
about 10.7–12.7 GHz downlink and 14.0–14.5 GHz uplink. Wider Starlink system
authorizations also use Ka-band and higher bands. Detecting such links is a
separate later research stream requiring appropriate microwave hardware,
high-gain antennas, regulatory authorization, and a specific safety/legal
review.

## Validation sequence

1. **Bench / open-area test:** Place an authorized AP at a known coordinate;
   compare estimated and true bearing at several ranges.
2. **Mapping MVP:** Store observations and render their bearing wedges and
   uncertainty intersection.
3. **Representative terrain trial:** Repeat under vegetation, obstructions,
   ridges, and realistic observer spacing; quantify error and failure modes.
4. **Decision gate:** Only add B210-driven capabilities if field data shows
   that the adapter-and-antenna method cannot meet the accuracy target.
5. **Operationalization:** Define mandate, target-selection criteria, data
   minimization, retention/deletion, access control, audit log, and confidence
   thresholds before any use against real targets.

## B210 receive-only activity spike

The repository includes `b210_wifi_activity.py`, a deliberately limited lab
probe. It tunes a B210 to one selected 2.4 GHz Wi-Fi channel and prints rolling
received-power estimates. It does not transmit, decode frames, identify BSSIDs,
or store IQ samples or communications payloads.

This is a feasibility tool only. A rise in power is not proof of Wi-Fi and is
not evidence of a particular AP. BSSID discovery remains the responsibility of
the monitor-mode Wi-Fi adapter in the hybrid MVP.

The system Python lacks UHD Python bindings, but the existing Radioconda base
environment supplies a complete UHD 4.8 stack, including the B210 FPGA image.
Run the probe from that environment rather than installing a second, older
system UHD stack. The Codex sandbox cannot access USB/libusb, so an authorized
hardware test must be run from the operator's normal terminal.

## Non-goals for Version 1

- Decoding or retaining user traffic/content.
- Active probing, deauthentication, interference, or any transmission.
- Claiming Starlink attribution from Wi-Fi observations alone.
- Claiming illegal-mining attribution from RF observations alone.
- Satellite-link reception or tracking.

## Decisions still needed

- Required location-area size and confidence threshold for a useful result.
- Antenna type(s), gain, polarization, and a repeatable calibration process.
- Expected observer-point spacing and typical terrain/vegetation.
- Whether 2.4 GHz, 5 GHz, or both are required for the MVP.
- Operating-system and monitor-mode adapter choice.
- Required legal authority and data-governance rules for the pilot.

## September 28: 2D experiment demo

The first graphical proof of concept is available in `demo/`. It implements
the coordinate rectangle, editable measurement stations, RSSI distance bands,
optional bearing wedges, and their model-compatible overlap. The known AP
coordinate is isolated from the estimator and used only for evaluation.

RSSI ranging is included as a calibrated experimental comparison, while the
bearing-first hybrid direction remains the field baseline. The B210 power
probe does not supply BSSID-specific RSSI for this demo. Live acquisition and
field validation remain unfinished. See `docs/demo-methodology.md` for the
measurement procedure, limitations, uncertainty treatment and CSV format.

## September 28: demo-1 survey workflow

The original demo is saved unchanged as `demo-0/`. `demo-1/` adds named GPS
stations, separate timestamped AP metadata captures, explicit station-ID joins,
BSSID/frequency coverage tables, collection-quality and geometry gates,
automatic coordinate arrangement, and per-AP plots/results. Unknown calibration
stays visibly exploratory; missing detections are not distance observations.

`prepare_demo1_survey.py` joins existing GPS/RSSI CSV files without accessing
radio hardware. Live acquisition remains a separate decision: using a B210
requires a Wi-Fi decoder and calibrated per-frame power extraction. The existing
channel-power script cannot list AP SSIDs/BSSIDs. The monitor-mode adapter path
remains available, pending the user's hardware choice. See
`docs/demo-1-workflow.md` and `docs/demo-1-verification.md`.

## Sources to verify during requirements work

- [Starlink router specifications](https://starlink.com/ao/support/article/7069f4ce-4bcd-56d0-fc0b-577736a2b259)
- [FCC Gen2 Starlink authorization](https://docs.fcc.gov/public/attachments/FCC-22-91A1.pdf)
- [FCC spectrum authorization record](https://www.govinfo.gov/content/pkg/GPO-FCC-Rcd-V39No14/pdf/GPO-FCC-Rcd-V39No14.pdf)
