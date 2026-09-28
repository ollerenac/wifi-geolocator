#!/usr/bin/env python3
"""Receive-only Wi-Fi-channel activity measurement with an Ettus USRP B210.

This feasibility script measures received power over a selected Wi-Fi channel.
It does not decode frames, identify BSSIDs, transmit, or save IQ/payload data.
Use only for authorized laboratory and field measurements.
"""

import argparse
import sys
import time

import numpy as np

try:
    import uhd
except ModuleNotFoundError:
    uhd = None


UHD_AVAILABLE = uhd is not None


def wifi_channel_to_hz(band: str, channel: int) -> int:
    """Return the centre frequency of an allowed 2.4 GHz Wi-Fi channel."""
    if band != "2.4":
        raise ValueError("This lab spike supports only the 2.4 GHz band.")
    if not 1 <= channel <= 13:
        raise ValueError("2.4 GHz channel must be between 1 and 13.")
    return 2_412_000_000 + (channel - 1) * 5_000_000


def power_dbfs(samples: np.ndarray) -> float:
    """Return mean complex-sample power in dBFS, with a finite noise floor."""
    mean_power = float(np.mean(np.abs(samples) ** 2))
    return 10.0 * np.log10(max(mean_power, 1e-15))


def measure_activity(args: argparse.Namespace) -> None:
    if not UHD_AVAILABLE:
        raise RuntimeError(
            "UHD Python bindings are not available in this Python environment. "
            "Activate the existing Radioconda base environment before running "
            "this probe; do not install a parallel system UHD stack."
        )

    centre_hz = wifi_channel_to_hz(args.band, args.channel)
    usrp = uhd.usrp.MultiUSRP(args.device_args)
    usrp.set_rx_rate(args.sample_rate, 0)
    usrp.set_rx_freq(uhd.types.TuneRequest(centre_hz), 0)
    usrp.set_rx_gain(args.gain, 0)
    usrp.set_rx_antenna(args.antenna, 0)

    stream_args = uhd.usrp.StreamArgs("fc32", "sc16")
    stream_args.channels = [0]
    streamer = usrp.get_rx_stream(stream_args)
    metadata = uhd.types.RXMetadata()
    buffer = np.zeros((1, streamer.get_max_num_samps()), dtype=np.complex64)

    command = uhd.types.StreamCMD(uhd.types.StreamMode.start_cont)
    command.stream_now = True
    streamer.issue_stream_cmd(command)

    print(
        f"Receiving only: channel {args.channel} ({centre_hz / 1e9:.3f} GHz), "
        f"rate {args.sample_rate / 1e6:.1f} MS/s, gain {args.gain:.1f} dB"
    )
    print("timestamp_utc,mean_power_dbfs,samples")

    deadline = time.monotonic() + args.seconds
    try:
        while time.monotonic() < deadline:
            received = streamer.recv(buffer, metadata, timeout=1.0)
            if metadata.error_code != uhd.types.RXMetadataErrorCode.none:
                print(f"receiver_warning,{metadata.strerror()},0", file=sys.stderr)
                continue
            if received:
                print(f"{time.time():.3f},{power_dbfs(buffer[0, :received]):.2f},{received}")
    finally:
        stop = uhd.types.StreamCMD(uhd.types.StreamMode.stop_cont)
        streamer.issue_stream_cmd(stop)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--band", choices=["2.4"], default="2.4")
    parser.add_argument("--channel", type=int, required=True)
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--sample-rate", type=float, default=25e6)
    parser.add_argument("--gain", type=float, default=30.0)
    parser.add_argument("--antenna", default="RX2")
    parser.add_argument("--device-args", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        wifi_channel_to_hz(args.band, args.channel)
        if args.seconds <= 0:
            raise ValueError("--seconds must be greater than zero.")
        measure_activity(args)
    except (RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
