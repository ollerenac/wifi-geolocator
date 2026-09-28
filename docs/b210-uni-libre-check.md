# Live B210 check: UNI_LIBRE_H, 2026-09-28

The receive-only B210 collector identified the target AP by BSSID and recorded
287 of its beacons during a 30-second channel-149 observation. Its beacon SSID
element is one zero byte (`ssid_hex=00`), so the advertised name is blank.
The laptop's cached NetworkManager Wi-Fi list supplies the separate name mapping;
the collector did not decode the text `UNI_LIBRE_H` from these beacons.

## Identity and setup

`nmcli -t -f SSID,BSSID,CHAN,FREQ device wifi list --rescan no` returned:

| Cached network name | AP BSSID | Channel | Frequency |
| --- | --- | ---: | ---: |
| UNI_LIBRE_H | C0:3F:DD:06:35:F0 | 149 | 5745 MHz |
| UNI_LIBRE_H | C0:3F:DD:06:35:E0 | 13 | 2472 MHz |

This read did not request a Wi-Fi scan or change the network connection.
The screenshot's Hardware Address field is the laptop adapter address and was
not used as the target AP address. The channel-13 AP has not been verified by
the B210; sharing a network name does not establish a shared physical location.

SDR setup: B210 KUDOS, USB 3, RF A RX2, operator-confirmed telescopic antenna
extended approximately 12–15 cm, 20 MS/s, 20 MHz bandwidth, fixed 45 dB gain,
AGC disabled. Antenna response is uncalibrated. The isolated VOLK profile was
`/tmp/wifi-geolocator-tuned`; its hash and actual radio settings are in the manifest.

## Discovery and target acquisition

A four-second-per-channel 2.4 GHz scan of channels 1–13 decoded four
checksum-valid non-beacon frames and no beacons. A corresponding 25-channel
5 GHz scan decoded 78 beacons on channel 149 and 78 on channel 153. All were
excluded by the exact `--ssid UNI_LIBRE_H` filter. These counts do not identify
the filtered APs and do not prove absence of the target.

A subsequent 30-second recording on channel 149 omitted the name filter:

| Measurement | Observed value |
| --- | ---: |
| Scheduled / elapsed observation | 30 / 30.032 s |
| Delivered sample span | 29.598 s |
| OFDM SIGNAL header count | 2318 |
| Checksum-valid decoded frames | 2029 |
| Saved beacons, all APs | 574 |
| Target C0:3F:DD:06:35:F0 beacons | 287 |
| Other AP C0:3F:DD:06:35:F1 (`eduroam`) beacons | 287 |
| Target median LTF power | −30.560 dBFS |
| Target median absolute deviation | 0.184 dB |
| Target minimum / maximum LTF power | −31.617 / −29.870 dBFS |
| Target median decoder SNR | 28.413 dB |
| Near-full-scale samples | 0 |
| Metadata errors / duplicate beacons | 0 / 0 |
| UHD event messages | 15 |

The event messages contain overflow reports, sometimes multiple per message;
they are neither lost-sample counts nor a guarantee that missing samples are
random. The sample-span ratio is not an independently measured loss rate.
MAD describes these collected readings, not a confidence interval or position
accuracy. SNR and per-beacon LTF power are distinct quantities.

## Saved data and repeat command

The original CSV/manifest pairs are preserved under
`captures/2026-09-28-UNI_LIBRE_H/` with prefixes
`wifi-geolocator-KUDOS-UNI_LIBRE_H-24-scan-1`, `...-5-scan-1`, and
`...-149-target-1`. The last CSV contains both APs; target rows have
`bssid=c0:3f:dd:06:35:f0`, blank `ssid`, and `ssid_hex=00`.
The capture files are ignored by Git. No raw IQ, packet files or user-data
payloads were retained, and the collector emitted no RF.

The collector now supports direct BSSID selection. For a new stationary trial,
use a fresh output/capture ID and the corresponding GPS station ID:

```bash
python3 b210_wifi_collector.py \
  --serial KUDOS --station P1 \
  --output captures/P1-UNI_LIBRE_H-001.csv --capture-id P1-UNI_LIBRE_H-001 \
  --band 5 --channels 149 --seconds-per-channel 30 --gain 45 \
  --rx-channel 0 --antenna RX2 --antenna-id telescopic-12to15cm-RFA-RX2 \
  --bssid C0:3F:DD:06:35:F0 --volk-config-root /tmp/wifi-geolocator-tuned
```

Verify channel/BSSID again before a later experiment. Keep receiver settings,
antenna orientation and height fixed between stations. BSSID filtering preserves
the hidden name as observed; externally known names belong in an explicit
reference mapping. The CLI rejects simultaneous SSID/BSSID filters.

A ten-second live follow-up using the new `--bssid` option decoded 196 beacons,
saved 98 matching target rows and filtered 98 others. The CSV/manifest are
`149-bssid-check.csv` and `.csv.json` in the same capture directory. All saved
rows retain the blank SSID and zero-byte hex identity. Overflow events remain
flagged. The filter's hidden-name selection, wrong-address rejection, address
normalization and CLI validation are covered by unit checks; **33 Python checks
pass**, along with the existing generated-IQ receiver integration checks.

`rssi_dbm` remains empty because no matching measured calibration was supplied.
Current demo-1 therefore cannot import these relative-power rows for ranging.
The next integration requires explicit relative-power model support or validated
RF calibration, plus an AP-specific distance model and GPS-linked trials.
The university AP's coordinates/transmit settings are unknown; use a controlled
AP with known truth to evaluate location accuracy. Throughput concerns remain.
