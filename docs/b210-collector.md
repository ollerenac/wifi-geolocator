# Receive-only B210 collector

For a new Windows10 laptop, follow [the portable Windows setup](windows-10-setup.md),
including the pinned environment and USB/software/live acceptance stages.

## Prototype and validation

`b210_wifi_collector.py` uses the existing Radioconda GNU Radio 3.10.12 / UHD 4.8 /
gr-ieee802-11 installation. It creates only a UHD receive source, decodes frames
in memory, retains beacon metadata and discards other frames. It saves no raw
IQ, packet files or user-data payloads and creates no transmitter, active probes,
association, TAP interface or Wireshark connection. The original aggregate
probe `b210_wifi_activity.py` is unchanged.

Run the hardware-free test in Radioconda:

```bash
python3 b210_wifi_collector.py --self-test
```

It generates IQ in memory using the installed reference mapper and training
constants and exercises the actual receiver graph. No hardware is opened or RF
transmitted. Checks passed: correct SSID/BSSID; expected LTF power −18.964 dBFS;
half amplitude changes power by −6.021 dB; invalid FCS produces no observation;
consecutive APs retain their own powers after an intervening invalid frame.
In the agent sandbox only, the FFT cache was redirected using
`XDG_CACHE_HOME=/tmp/wifi-geolocator-cache`. Unit tests use system Python:
`/usr/bin/python3 -m pytest -q`.

The installed decoder supports **legacy OFDM 802.11a/g/p**, not every Wi-Fi
modulation. Some 2.4 GHz APs send beacons with DSSS/CCK 802.11b rates, which this
graph cannot decode even if the AP supports OFDM data. A modern Wi-Fi label does
not establish beacon compatibility. If the phone/antenna support it, 5 GHz
legacy-OFDM beacons are a useful next test. Sources:
[decoder](https://github.com/bastibl/gr-ieee802-11),
[AP beacon-rate settings](https://arubanetworking.hpe.com/techdocs/fedramp/webhelp/content/nms/access-points/cfg/networks/conf_wlan_ssid.htm).

## Live capture

Confirm antenna band and physical port. `--rx-channel 0 --antenna RX2` means
RF A RX2; channel 1 means RF B. Select `--antenna TX/RX` if that is the attached
receive input; the graph remains receive-only. Keep antenna, height, orientation,
polarization and gain consistent between stations and assign a setup identity.

The operator's target is the `oscar-wifi` phone hotspot: 2.4 GHz, automatic
channel, randomized MAC. Its screenshot does not prove it is broadcasting or
establish channel/BSSID/beacon modulation. Keep it running during a multi-station
trial; a restart may change its BSSID. Do not merge APs by SSID alone.

Example at one stationary point, scanning an automatic-channel hotspot:

```bash
mkdir -p captures
python3 b210_wifi_collector.py \
  --serial KUDOS --station P1 --output captures/P1-run-001.csv \
  --capture-id P1-run-001 --band 2.4 \
  --channels 1,2,3,4,5,6,7,8,9,10,11,12,13 \
  --seconds-per-channel 30 --rounds 1 \
  --rx-channel 0 --antenna RX2 --antenna-id field-omni-A
```

This schedules 6.5 minutes plus initialization. Choose frequencies appropriate
for the experiment. Defaults visit only 1/6/11 and are not exhaustive. Once the
target channel is found, prefer repeated measurements on that channel. Each
dwell rebuilds the graph so queued PDUs/synchronization state cannot leak into
another frequency. GPS is supplied separately using the same station ID.
Moving requires a new station ID. Omit `--ssid` to retain all decoded beacons;
`--ssid oscar-wifi` filters that exact display name (hidden names do not match).
Alternatively, `--bssid C0:3F:DD:06:35:F0` selects one AP even when its beacon
name is hidden. The two filters are mutually exclusive. BSSIDs accept six
colon-separated hexadecimal bytes and are normalized to lowercase; invalid,
zero or multicast addresses are rejected. Filtering never fills in a hidden name.
CTRL+C stops receiving and marks the capture interrupted; outputs cannot be
overwritten. CSV size/sample limits still apply to demo-1 imports.

To select an isolated processing profile, first create a local profile with
`volk_profile --path .radio-profile/volk`, then add
`--volk-config-root .radio-profile` to the collector. This changes only this
process's kernel choices, not the driver/library installation. The manifest
records the profile path/hash. A profile does not guarantee zero sample loss.

## Metadata, units and diagnostics

CSV contains station/capture/receiver/config IDs, host UTC decode receipt time,
BSSID, SSID, tuned frequency, relative `ltf_power_dbfs`, separate `snr_db`, beacon
sequence/TSF, lossless `ssid_hex`, power method and calibration ID. `rssi_dbm`
is **empty unless a matching measured calibration is supplied**. Host timestamps
include buffering/processing delay and are not hardware receive timestamps.

The `.csv.json` manifest records actual settings, channel dwells, sample counts,
near-full-scale samples, aggregate channel power, decoded-frame/beacon counts,
metadata errors, duplicates and UHD events. Channel power is not AP RSSI.
Fixed 2048-sample windows record minimum/maximum power (102.4 microseconds at
20 MS/s) without storing IQ or a trace. `ofdm_signal_headers` counts valid
OFDM SIGNAL metadata before MAC checksum validation. It is not a count of
SSIDs, beacons or CRC failures; an incomplete frame can have a valid header.
Bad CRC frames are dropped by the native decoder without an exposed count:
`crc_failures` remains unknown. Inspect UHD events and stderr for overflows.
`collector_quality.py` flags them even when sample counts look near 100%; its
90% sample-coverage and 0.01% near-full-scale thresholds are exploratory.
No detections cannot establish AP absence or a distance.

The last 4096 BSSID/frequency/TSF/sequence identities are deduplicated in memory;
older duplicates are not guaranteed excluded. Rows flush promptly; manifests
update at dwell boundaries and normal/error/CTRL+C termination. Abrupt process
termination may leave a partial manifest. No automatic resume/merge exists.

## Two calibrations

**Receiver calibration** converts this SDR estimator from dBFS to RF input dBm
under fixed frequency, gain, sample rate, bandwidth, port and antenna conditions.
The LS decoder exports 52 active tones of an unnormalized 64-point FFT. The
estimator is `10 log10(sum(abs(CSI)^2) / 64^2)`, Parseval power of the averaged
long-training estimate, rather than full-packet/channel-average RSSI. Noise,
interference, compression and receiver response may bias it. Software scaling
tests do not validate RF accuracy. See upstream
[LS estimator](https://github.com/bastibl/gr-ieee802-11/blob/maint-3.10/lib/equalizer/ls.cc),
[CSI output](https://github.com/bastibl/gr-ieee802-11/blob/maint-3.10/lib/equalizer/base.cc),
and [B210 calibration documentation](https://files.ettus.com/manual/page_usrp_b200.html).

`--calibration profile.json` accepts one measured offset/frequency, checks actual
settings before receiving, and records the profile plus SHA-256. Use independent
RF-reference validation across useful power levels; subtracting RX gain or
assigning an arbitrary offset does not establish dBm. Required profile shape
(the unknown `null` offset is deliberately rejected):

```json
{
  "schema_version": 1,
  "calibration_id": "your-measured-calibration-id",
  "device_serial": "KUDOS",
  "rx_channel": 0,
  "antenna": "RX2",
  "antenna_id": "field-omni-A",
  "frequency_hz": 2437000000,
  "sample_rate": 20000000,
  "bandwidth_hz": 20000000,
  "gain_db": 30,
  "power_method": "ltf_csi_parseval_v1",
  "offset_db": null,
  "evidence": "RF reference, date, procedure and independent validation"
}
```

**Distance-model calibration** relates observed power to distance for one AP
and propagation/antenna setup. It can use relative power and known distances
without absolute dBm calibration if units are explicit and settings stay fixed.
Validate with independent observations. One AP's model does not establish
unrelated AP transmit powers. Current demo-1 requires `rssi_dbm`, so relative
collector files are **not yet importable for ranging**. Supporting explicitly
relative models is a subsequent schema/UI change; do not relabel dBFS or guess
an offset to bypass validation.

## Hardware evidence and next checks

The [UNI_LIBRE_H live check](b210-uni-libre-check.md) verified **287 target beacons
in a 30-second channel-149 recording**. Its beacon SSID is hidden; the laptop's
cached Wi-Fi list supplied the separate BSSID/name mapping. Per-beacon relative
power is acquired, with unresolved overflow events and no dBm calibration.
Use BSSID filtering for this AP. These observations do not establish location accuracy.

See [the earlier oscar-wifi live check](b210-live-check.md) for the operator-confirmed
antenna/broadcasting setup, complete channel sweep, seven decoded non-beacon
Wi-Fi frames, burst diagnostics and still-unverified oscar-wifi identification.

Independent checks confirmed B210 `KUDOS`, USB 3, firmware 8.0, FPGA 16.0, and
both RX antenna options. Internal register checks passed; those are not RF
transmitter tests. Three-second receive-only dwells on 2.4 GHz channels 1/6/11
used RF A RX2, gain 30 dB and 20 MS/s, with antenna/hotspot state unconfirmed.
Delivered sample spans were 2.994/2.986/2.932 seconds, zero near-full-scale
samples, some overflow events, and **zero decoded beacons**. USB sampling works
with drop concerns; that earlier smoke test did not verify live beacons/per-AP RF power.
Temporary diagnostics: `/tmp/wifi-geolocator-KUDOS-smoke-1.csv` and `.csv.json`.

Next: resolve throughput flags; collect known-distance trials; integrate explicitly
calibrated or relative-power models with demo-1. GPS/calibration equipment is
not required to establish the first live decoded beacon.
