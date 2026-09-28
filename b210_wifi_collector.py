#!/usr/bin/env python3
"""Receive-only B210 OFDM beacon collector; uncalibrated power stays in dBFS."""

import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

from wifi_collector_core import (CaptureWriter, POWER_METHOD, calibration_offset,
                                 channel_frequency, identifier, load_calibration,
                                 normalize_bssid, utc_now)
from collector_quality import assess_dwell


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="Generated IQ test; no hardware or RF")
    parser.add_argument("--station", help="Station ID associated with this stationary capture")
    parser.add_argument("--output", type=Path, help="New metadata CSV; will not overwrite")
    parser.add_argument("--capture-id")
    parser.add_argument("--serial", default="KUDOS")
    parser.add_argument("--band", choices=["2.4", "5"], default="2.4")
    parser.add_argument("--channels", default="1,6,11", help="Comma-separated channels, in visit order")
    parser.add_argument("--seconds-per-channel", type=float, default=30)
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--gain", type=float, default=30)
    parser.add_argument("--antenna", choices=["RX2", "TX/RX"], default="RX2")
    parser.add_argument("--rx-channel", choices=[0, 1], type=int, default=0)
    parser.add_argument("--antenna-id", default="unspecified", help="Antenna/setup identity; keep consistent")
    filters = parser.add_mutually_exclusive_group()
    filters.add_argument("--ssid", help="Optional exact display-name filter; hidden names do not match")
    filters.add_argument("--bssid", help="Optional AP MAC-address filter, including hidden SSIDs")
    parser.add_argument("--calibration", type=Path, help="Measured calibration profile, matched to actual settings")
    parser.add_argument("--volk-config-root", type=Path,
                        help="Optional isolated VOLK profile root, containing volk/volk_config")
    args = parser.parse_args(argv)
    if args.self_test:
        return args
    if not args.station or not args.output:
        parser.error("Live capture requires --station and --output")
    try:
        if args.bssid is not None:
            args.bssid = normalize_bssid(args.bssid)
        identifier(args.station, "station")
        identifier(args.serial, "serial")
        identifier(args.antenna_id, "antenna-id")
        if args.capture_id:
            identifier(args.capture_id, "capture-id")
        args.channels = [int(value.strip()) for value in args.channels.split(",")]
        if len(set(args.channels)) != len(args.channels) or len(args.channels) > 25:
            raise ValueError("Channels must be distinct; at most 25 per round")
        for channel in args.channels:
            channel_frequency(args.band, channel)
        if not math.isfinite(args.seconds_per_channel) or not 1 <= args.seconds_per_channel <= 600:
            raise ValueError("seconds-per-channel must be between 1 and 600")
        if not 1 <= args.rounds <= 20:
            raise ValueError("rounds must be between 1 and 20")
        if not math.isfinite(args.gain) or not 0 <= args.gain <= 76:
            raise ValueError("gain must be between 0 and 76 dB")
        if args.calibration and len(args.channels) != 1:
            raise ValueError("This initial calibration profile supports one frequency; choose one channel")
    except ValueError as error:
        parser.error(str(error))
    return args


def make_source(args, frequency_hz):
    from gnuradio import uhd
    # No UHD TX sink, TX stream, probes or associations are created anywhere.
    source = uhd.usrp_source(f"type=b200,serial={args.serial}",
                             uhd.stream_args(cpu_format="fc32", otw_format="sc16",
                                             channels=[args.rx_channel]))
    source.set_samp_rate(20e6)
    source.set_center_freq(frequency_hz, 0)
    source.set_antenna(args.antenna, 0)
    source.set_gain(args.gain, 0)
    source.set_rx_agc(False, 0)
    source.set_bandwidth(20e6, 0)
    actual_rate = source.get_samp_rate()
    actual_frequency = source.get_center_freq(0)
    if abs(actual_rate - 20e6) > 1 or abs(actual_frequency - frequency_hz) > 1:
        raise ValueError("Receiver did not accept the OFDM sample rate or requested centre frequency")
    info = source.get_usrp_info(0)
    settings = {"device_serial": info.get("mboard_serial", args.serial),
                "rx_channel": args.rx_channel, "antenna": source.get_antenna(0),
                "antenna_id": args.antenna_id, "frequency_hz": actual_frequency,
                "sample_rate": actual_rate, "bandwidth_hz": source.get_bandwidth(0),
                "gain_db": source.get_gain(0), "agc": False,
                "power_method": POWER_METHOD}
    return source, settings


def collect(args):
    from gnuradio import gr, uhd
    from wifi_collector_radio import DeviceEvents, Receiver, new_dwell

    profile, profile_hash = load_calibration(args.calibration) if args.calibration else (None, None)
    manifest = {"schema_version": 1, "source": "field", "status": "starting",
                "receive_only": True, "decoder": "gr-ieee802-11 legacy OFDM / LS",
                "gnuradio_version": gr.version(), "uhd_version": uhd.get_version_string(),
                "calibration": profile, "calibration_sha256": profile_hash,
                "power_units_compatible_with_demo1": profile is not None,
                "schedule": {"band": args.band, "channels": args.channels,
                             "seconds_per_channel": args.seconds_per_channel, "rounds": args.rounds},
                "filter_ssid": args.ssid, "filter_bssid": args.bssid, "dwells": [],
                "volk_profile": ({"root": str(args.volk_config_root.resolve()),
                                  "sha256": hashlib.sha256((args.volk_config_root / "volk/volk_config").read_bytes()).hexdigest()}
                                 if args.volk_config_root else None),
                "limitations": ["Only supported OFDM beacons can be identified.",
                                "Host receipt timestamps include decoding/buffering delay.",
                                "No detections are not evidence of AP absence.",
                                "CSI power is a noisy LTF estimate; RF calibration is not established by software tests."]}
    capture_id = args.capture_id or f"{args.station}-{time.time_ns()}"
    writer = CaptureWriter(args.output, args.station, capture_id, f"b210-{args.serial}", manifest)
    status = "complete"
    print("RECEIVE ONLY: OFDM beacons; raw IQ and raw frames are not saved.", flush=True)
    if profile is None:
        print("Uncalibrated: ltf_power_dbfs recorded; rssi_dbm remains empty (demo-1 cannot import yet).")
    try:
        for round_index in range(args.rounds):
            for channel in args.channels:
                frequency_hz = channel_frequency(args.band, channel)
                dwell = new_dwell(channel, frequency_hz)
                dwell["round"] = round_index + 1
                manifest["dwells"].append(dwell)
                graph = gr.top_block("receive_only_B210_beacons", catch_exceptions=True)
                source, settings = make_source(args, frequency_hz)
                settings["calibration_sha256"] = profile_hash
                calibration_offset(profile, settings)  # Reject mismatches before receiving.
                dwell["receiver_settings"] = settings
                callback = lambda beacon, metadata: writer.append(beacon, metadata, settings, dwell, profile)
                receiver = Receiver(frequency_hz, settings["sample_rate"], callback, dwell,
                                    args.ssid, args.bssid)
                graph.connect(source, receiver)
                events = DeviceEvents(dwell)
                import pmt
                if "async_msgs" in pmt.to_python(source.message_ports_out()):
                    graph.msg_connect(source, "async_msgs", events, "in")
                dwell["started_utc"] = utc_now()
                writer.write_manifest()
                print(f"Channel {channel} / {frequency_hz / 1e6:.0f} MHz / {args.seconds_per_channel:g}s", flush=True)
                start = time.monotonic()
                try:
                    graph.start()
                    while time.monotonic() - start < args.seconds_per_channel:
                        if receiver.sink.failed.wait(0.05):
                            raise receiver.sink.error
                        if sum(item["saved_beacons"] for item in manifest["dwells"]) >= 50_000:
                            raise RuntimeError("Reached the 50,000-row demo-1 survey limit; start a new survey")
                finally:
                    graph.stop()
                    graph.wait()
                    receiver.stats.finish()
                    dwell["finished_utc"] = utc_now()
                    dwell["elapsed_seconds"] = round(time.monotonic() - start, 3)
                    dwell["received_sample_seconds"] = dwell["received_samples"] / settings["sample_rate"]
                    dwell["quality_flags"] = assess_dwell(dwell, args.seconds_per_channel, settings["sample_rate"])
                    writer.write_manifest()
                if receiver.sink.error:
                    raise receiver.sink.error
                if not dwell["received_samples"]:
                    raise RuntimeError("Receiver delivered no samples")
                print(f"  {dwell['beacons_decoded']} decoded beacons; {dwell['saved_beacons']} rows saved", flush=True)
                if dwell["quality_flags"]:
                    print(f"  Collection flags: {', '.join(dwell['quality_flags'])}", flush=True)
                # Rebuild the graph each dwell. Native synchronization state and
                # queued PDUs from a previous channel cannot leak into a new one.
                del receiver, graph, source
    except KeyboardInterrupt:
        status = "interrupted"
    except Exception as error:
        status = "failed"
        manifest["error"] = str(error)
        raise
    finally:
        writer.close(status)
    print(f"Saved {args.output} and {writer.manifest_path}")
    print(json.dumps(writer.ap_counts, ensure_ascii=True))
    return 130 if status == "interrupted" else 0


def main(argv=None):
    args = parse_args(argv)
    try:
        if args.volk_config_root:
            if not (args.volk_config_root / "volk/volk_config").is_file():
                raise ValueError("VOLK root must contain an existing volk/volk_config file")
            # Set before importing GNU Radio/VOLK; scope is this process only.
            os.environ["VOLK_CONFIGPATH"] = str(args.volk_config_root.resolve())
        if args.self_test:
            from validate_wifi_collector import validate
            validate()
            return 0
        return collect(args)
    except (ImportError, RuntimeError, ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
