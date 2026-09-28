# Live B210 check: oscar-wifi, 2026-09-28

For the subsequent retry across both bands, including a recovered native
process crash, see [oscar-wifi retry results](b210-oscar-retry.md).

## Confirmed setup

Operator confirmed a broadcasting phone hotspot named `oscar-wifi`, 2.4 GHz,
and an omnidirectional telescopic antenna extended approximately 12–15 cm,
connected to RF A RX2. B210 serial is KUDOS, operating over USB 3. Antenna
frequency matching, phone distance/channel/beacon format remain unknown.
Nothing in these checks establishes a calibrated antenna response.

All SDR runs were receive-only, with fixed gain/AGC disabled and 20 MS/s.
No raw IQ, packet files or user-data payloads were saved. The target SSID filter
retained only matching beacon rows; diagnostic counts also include other frames.

## Complete channel sweep

Channels 1–13 each had three seconds of scheduled observation, gain 30 dB,
RF A RX2. There were **zero checksum-valid decoded frames and zero beacon rows**.
Delivered sample spans ranged from 2.893 to 3.005 seconds. Overflow messages
were reported at several channels. A short CPU kernel benchmark ran during
part of the sweep, so those overflow rates are not a clean throughput baseline.

Average channel power was highest at channel 7 (−56.53 dBFS) and channel 6
(−56.78 dBFS). This is aggregate channel energy, not AP RSSI and not evidence
that oscar-wifi occupies either channel.

Temporary files:
`/tmp/wifi-geolocator-KUDOS-oscar-scan-1.csv` and its `.csv.json` manifest.
CSV has only its header because no matching beacons were identified.

## Longer diagnostic readings

Ten seconds each on channels 6/7 used gain 45 dB, the same port/antenna, and an
isolated benchmark-generated VOLK profile at `/tmp/wifi-geolocator-tuned`.
The CPU benchmark had finished before these readings. No system profile,
package, driver or GNU Radio installation was changed.

| Diagnostic | Channel 6 | Channel 7 |
| --- | ---: | ---: |
| Delivered sample span | 9.963 s | 9.849 s |
| Valid OFDM SIGNAL header metadata | 592 | 546 |
| Checksum-valid decoded frames | 3 | 4 |
| Decoded beacons | 0 | 0 |
| oscar-wifi rows | 0 | 0 |
| Mean channel power | −43.99 dBFS | −45.02 dBFS |
| Minimum 2048-sample window power | −57.27 dBFS | −57.23 dBFS |
| Maximum 2048-sample window power | −19.53 dBFS | −23.89 dBFS |
| Near-full-scale samples | 0 | 0 |
| UHD event messages | 7 | 8 |

An event message can summarize multiple overflows; the last row is not a count
of lost samples. Header counts include frames that never yielded a valid MAC
frame, such as unsupported payload formats or incomplete receptions. Their
remainder cannot be labeled a CRC failure count. The seven checksum-valid
frames were discarded as non-beacons, with zero metadata-parser errors.

Temporary files:
`/tmp/wifi-geolocator-KUDOS-oscar-diagnostic-1.csv` and its `.csv.json` manifest.

This establishes live OFDM decoding and received bursts with the current
antenna. **It does not identify oscar-wifi, its BSSID, channel or per-AP RSSI.**
The processing profile did not eliminate sample-drop events. Because gain and
processing settings both changed, this is not a controlled attribution of any
improvement to either change.

## Software changes and verification

- Fixed 2048-sample windows (102.4 microseconds at 20 MS/s) record minimum and
  maximum channel power independent of processing chunk boundaries. Only an
  unfinished window of squared magnitudes is held in memory; no IQ trace saved.
- Transparent diagnostics count equalizer SIGNAL metadata before MAC checksum
  validation. Full decoded frame contents are not retained.
- `--volk-config-root ROOT` selects `ROOT/volk/volk_config` through VOLK_CONFIGPATH
  for this process only, before loading GNU Radio. Manifest records root/hash.
  This follows [VOLK's configuration lookup](https://github.com/gnuradio/volk/blob/main/lib/volk_prefs.c).
- Integration test preserves short power bursts across chunk boundaries and
  counts the valid SIGNAL header of an intentionally bad-FCS frame.
- A generated beacon also decodes with deterministic 18 dB fixture SNR and a
  75 kHz frequency offset. This is a software fixture, not measured RF SNR.
- Existing generated-beacon identity, scaling, checksum rejection and consecutive
  frame/power association checks still pass; 27 system-Python checks pass.

## Interpretation and next check

The [installed decoder](https://github.com/bastibl/gr-ieee802-11) supports legacy
OFDM a/g/p. Some 2.4 GHz APs broadcast beacons at DSSS/CCK 802.11b rates;
the [AP configuration documentation](https://arubanetworking.hpe.com/techdocs/fedramp/webhelp/content/nms/access-points/cfg/networks/conf_wlan_ssid.htm)
provides one example of a 1 Mb/s beacon default at 2.4 GHz and 6 Mb/s at 5 GHz.
These defaults do not establish this phone's actual beacon format.

A modulation mismatch is plausible, alongside reception/throughput concerns.
Do not describe it as proven by nondetection. Ask the operator for phone-to-
antenna distance and whether Band offers 5 GHz/fixed channel. A stationary
2–3 metre clear-path bench arrangement can be used for the next controlled
check. If available, use a controlled 5 GHz legacy-OFDM beacon or an AP with a
known configurable OFDM beacon rate, then repeat beacon acquisition.
Keep the hotspot alive within a trial: randomized BSSID may change after a
restart. Receiver/calibration IDs and sample units remain explicit. Current
demo-1 still requires dBm; no uncalibrated values were relabeled for import.
