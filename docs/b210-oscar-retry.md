# oscar-wifi retry, 2026-09-28

The B210 retry did not identify oscar-wifi. It covered channel 6 for 30 seconds,
every other 2.4 GHz channel from 1–13 for three seconds each, and all 25
supported 5 GHz channels for three seconds each. No SSID/BSSID filter was
applied, so all successfully decoded beacon identities were retained.

## Setup and observations

Unchanged setup: B210 KUDOS, USB 3, RF A RX2, telescopic antenna extended
approximately 12–15 cm, fixed gain 45 dB, AGC off, 20 MS/s, 20 MHz bandwidth,
isolated `/tmp/wifi-geolocator-tuned` VOLK profile. Receiver calibration remains
absent; `rssi_dbm` stays empty. No RF transmission or raw IQ/packet files.

The laptop's cached Wi-Fi list was read twice using `--rescan no`; both reads
listed only the connected UNI_LIBRE_H AP. A prior cache read had mapped
oscar-wifi to `EE:36:9A:25:9F:19`, channel 6 / 2437 MHz. That prior mapping is
not confirmation of its current band, address or broadcasting state. A band
clarification was requested during the retry but had no answer by completion.

| Recording | Completed channels | CRC-valid frames | Decoded beacons | UHD event messages |
| --- | --- | ---: | ---: | ---: |
| Channel-6 targeted, 30 s | 6 | 0 | 0 | 19 |
| Other 2.4 GHz, first process, 3 s each | 1–5, 7, 8 | 0 | 0 | 16 |
| Other 2.4 GHz, recovery process, 3 s each | 9–13 | 0 | 0 | 11 |
| Supported 5 GHz sweep, 3 s each | 25 configured channels | 345 | 115 | 29 |

All completed dwells reported zero near-full-scale samples. Channel 6 delivered
29.820 seconds of samples in 30.024 seconds elapsed and counted 1116 OFDM
SIGNAL headers. These headers did not produce a checksum-valid MAC frame;
their count is not an exposed CRC-failure count or an AP detection count.

The 5 GHz sweep saved these beacon groups:

| BSSID | Tuned frequency | Observed SSID | Beacons |
| --- | ---: | --- | ---: |
| C0:3F:DD:06:35:F0 | 5745 MHz | blank (`ssid_hex=00`) | 29 |
| C0:3F:DD:06:35:F1 | 5745 MHz | eduroam | 29 |
| C0:3F:DD:06:38:F0 | 5765 MHz | blank (`ssid_hex=00`) | 28 |
| C0:3F:DD:06:38:F1 | 5765 MHz | eduroam | 29 |

The first group is the independently mapped UNI_LIBRE_H AP. These receptions
confirm live beacon decoding still works at 5 GHz. They do not establish
the identities of every hidden-name AP. None of the saved rows advertised
oscar-wifi or matched its previously cached address.

## Native crash and recovery

The first remaining-channel 2.4 GHz process exited with code **139** after
printing the start of channel 9. Channels 1–5, 7 and 8 had finished; channel 9
was incomplete. Native termination bypassed Python's normal closure, leaving
the original manifest status `starting`. That status does not mean a job is
still running. The original partial CSV/manifest are preserved unchanged.

A fresh process successfully completed channels 9–13. The cause of the crash
has not been established. Recovery completed this retry's channel coverage;
native-process robustness remains unresolved alongside overflow events.
UHD messages can aggregate multiple overflows and are not lost-sample counts.

## Evidence and next controlled check

All four CSV/manifest pairs are preserved under
`captures/2026-09-28-oscar-retry/`, using the prefix
`wifi-geolocator-KUDOS-oscar-retry-` and suffixes `6-1`, `5-scan-1`,
`24-scan-1`, `24-scan-2`. The folder also contains `retry-summary.json`,
which records terminal exit codes separately from the original manifests.
Capture files are ignored by Git. No collector code or dependencies changed;
software tests were not rerun for these hardware-only recordings.

Nondetection does not prove the hotspot is off, out of range or using a
particular modulation. Three-second channel visits and sample-drop events
limit this discovery attempt. The existing decoder supports legacy OFDM;
some 2.4 GHz hotspots use incompatible DSSS/CCK beacon rates, as discussed in
[the collector procedure](b210-collector.md). That remains a possibility,
not an observed property of this phone.

For the next controlled attempt, establish current hotspot broadcasting state,
band and channel/BSSID. If the phone offers 5 GHz, a stationary 5 GHz trial is
useful given the verified receiver results there. Keep the hotspot alive during
the recording; obtain the name/address mapping again after any restart because
the configured MAC type is randomized. GPS and dBm calibration are still not
needed for the initial beacon-identification test.

## New retry after the operator selected 5 GHz

The operator subsequently reported changing oscar-wifi from 2.4 to 5 GHz.
Two receive-only, unfiltered discovery runs covered all 25 supported 5 GHz
channels for four seconds each, with the same gain45/20MS/s/RF A RX2 setup:

- First:36,40,44,48,149,153,157,161,165;344 CRC-valid frames,154 beacons,
  389 SIGNAL headers and14 UHD event messages.
- Second:52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,144;
  zero CRC-valid frames/beacons,10 SIGNAL headers and27 UHD event messages.

Both processes completed with exit0; no native crash occurred this time.
No near-full-scale samples were reported. Delivered sample spans ranged from
3.938 to4.008 seconds per scheduled four-second dwell. The154 beacons came
from the same four university AP/frequency groups on149/153; none advertised
oscar-wifi or matched its prior EE:36:9A:25:9F:19 address. No target-specific
signal power could be assigned. Overflow flags remain, and nondetection still
does not prove target absence.

The laptop's initial cached list contained only the connected UNI_LIBRE_H AP.
At the end, its cache again listed **oscar-wifi at2437MHz/channel6**, with BSSID
**EE:36:9A:25:9F:19**. Read-only D-Bus introspection of NetworkManager
`/org/freedesktop/NetworkManager/AccessPoint/114` confirmed Frequency2437 and
LastSeen26953. A corresponding CLOCK_BOOTTIME reading was26983.204 seconds,
making the observation approximately30.2 seconds old at that check.
[NetworkManager documents LastSeen](https://networkmanager.dev/docs/api/latest/gdbus-org.freedesktop.NetworkManager.AccessPoint.html)
as the last discovery timestamp in CLOCK_BOOTTIME seconds. No explicit laptop
rescan, association or connection change was requested by the agent.

This is recent cached scan evidence of the2.4GHz AP; it is not an SDR-decoded
beacon or proof of the phone's configuration state. A selected5GHz option may
not yet have been applied, but the reason is unverified. Save/apply the hotspot
configuration, restart the hotspot if required, then independently confirm its
actual band/channel. The user was also asked whether another device currently
sees the SSID and for phone-to-antenna distance; no answer had arrived when the
recordings finished. Do not ask again whether the user selected5GHz—they did.

Both CSV/manifest pairs and `discovery-summary.json` are preserved under
`captures/2026-09-28-oscar-5GHz-confirmed/`, using prefixes
`wifi-geolocator-KUDOS-oscar-5GHz-confirmed-discovery-1` and `...-2`.
The summary distinguishes the operator report, actual SDR observations and
the external cached identity/frequency/age. No collector code or dependencies
changed, and no radio jobs remain running.
