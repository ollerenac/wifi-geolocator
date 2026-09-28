#!/usr/bin/env python3
"""Generated OFDM beacon tests. No UHD device, radio transmission or IQ files."""

import ast
import math
import struct
import time
import zlib

import ieee802_11
import numpy as np
import pmt
import yaml
from gnuradio import blocks, gr

from wifi_collector_core import ltf_power_dbfs
from wifi_collector_radio import Receiver, SampleStats, new_dwell
from radio_environment import find_phy_example


def beacon_frame(ssid=b"software-test", sequence=1, tsf=100000, address="020000000001"):
    address = bytes.fromhex(address)
    header = (b"\x80\x00\x00\x00" + b"\xff" * 6 + address + address
              + struct.pack("<H", sequence << 4))
    fixed = struct.pack("<QHH", tsf, 100, 0x0001)
    return header + fixed + bytes([0, len(ssid)]) + ssid + b"\x01\x01\x0c\x03\x01\x06"


def encode_signal(length):
    # Rate 6 Mb/s, reserved=0, 12-bit PSDU length, parity, six tail bits.
    bits = [1, 1, 0, 1, 0] + [(length >> i) & 1 for i in range(12)]
    bits += [sum(bits) & 1] + [0] * 6
    state, encoded = 0, []
    for bit in bits:
        state = ((state << 1) | bit) & 127
        encoded.extend([(state & 0o155).bit_count() & 1,
                        (state & 0o117).bit_count() & 1])
    interleaved = np.empty(48, dtype=np.uint8)
    for k, bit in enumerate(encoded):
        interleaved[3 * (k % 16) + k // 16] = bit
    return interleaved


def encoded_data(psdu):
    """Use the installed reference mapper, with a finite head to bound the test."""
    count = math.ceil((16 + len(psdu) * 8 + 6) / 24) * 48
    graph = gr.top_block("software_only_encoder", catch_exceptions=True)
    mapper = ieee802_11.mapper(ieee802_11.BPSK_1_2, False)
    head = blocks.head(gr.sizeof_char, count)
    sink = blocks.vector_sink_b()
    graph.connect(mapper, head, sink)
    graph.start()
    try:
        mapper.to_basic_block()._post(pmt.intern("in"),
            pmt.cons(pmt.make_dict(), pmt.init_u8vector(len(psdu), list(psdu))))
        deadline = time.monotonic() + 3
        while len(sink.data()) < count and time.monotonic() < deadline:
            time.sleep(0.01)
        if len(sink.data()) != count:
            raise RuntimeError("Software mapper did not produce the expected symbol count")
        return np.asarray(sink.data(), dtype=np.uint8).reshape(-1, 48)
    finally:
        graph.stop()
        graph.wait()


def training_constants():
    # Reuse the installed example's standards constants, without generating its
    # combined transmitter hierarchy or changing ~/.grc_gnuradio.
    example = find_phy_example()
    graph = yaml.safe_load(example.read_text())
    allocator = next(block for block in graph["blocks"]
                     if block["id"] == "digital_ofdm_carrier_allocator_cvc")
    parameters = allocator["parameters"]
    words = ast.literal_eval(parameters["sync_words"])
    pilots = ast.literal_eval(parameters["pilot_symbols"])
    return np.asarray(words[0], dtype=complex), np.asarray(words[3], dtype=complex), pilots


def generated_iq(frame, corrupt_fcs=False, amplitude=1.0):
    psdu = frame + struct.pack("<I", zlib.crc32(frame))
    if corrupt_fcs:
        psdu = psdu[:-1] + bytes([psdu[-1] ^ 1])
    short, long, pilots = training_constants()
    short_time = np.fft.ifft(np.fft.ifftshift(short))
    long_time = np.fft.ifft(np.fft.ifftshift(long))
    preamble = np.concatenate([np.tile(short_time[:16], 10), long_time[-32:], long_time, long_time])
    occupied = [k for k in range(-26, 27) if k not in (-21, -7, 0, 7, 21)]
    symbols = [encode_signal(len(psdu)), *encoded_data(psdu)]
    waveform = [np.zeros(1000), preamble]
    for index, bits in enumerate(symbols):
        bins = np.zeros(64, dtype=complex)
        bins[np.asarray(occupied) + 32] = bits.astype(float) * 2 - 1
        bins[np.asarray([-21, -7, 7, 21]) + 32] = pilots[index % len(pilots)]
        symbol = np.fft.ifft(np.fft.ifftshift(bins))
        waveform.extend([symbol[-16:], symbol])
    waveform.append(np.zeros(3000))
    return np.asarray(np.concatenate(waveform) * amplitude, dtype=np.complex64)


def decode_generated(iq):
    received = []
    dwell = new_dwell(6, 2437e6)
    graph = gr.top_block("software_only_receiver", catch_exceptions=True)
    receiver = Receiver(2437e6, 20e6, lambda beacon, meta: received.append((beacon, meta)), dwell)
    source = blocks.vector_source_c(iq.tolist(), False)
    graph.connect(source, receiver)
    graph.start()
    try:
        deadline = time.monotonic() + 3
        while receiver.stats.dwell["received_samples"] < len(iq) and time.monotonic() < deadline:
            time.sleep(0.01)
        # Message handling is asynchronous after the last stream samples.
        time.sleep(0.15)
    finally:
        graph.stop()
        graph.wait()
    if receiver.sink.error:
        raise receiver.sink.error
    return received, dwell


def validate():
    # Deliberately split windows across scheduler calls: diagnostics must not
    # depend on chunk sizes and must preserve a short burst in a longer mean.
    stats_dwell = new_dwell(6, 2437e6)
    stats = SampleStats(stats_dwell)
    levels = np.concatenate([np.full(2048, 0.01), np.full(2048, 0.1)]).astype(np.complex64)
    for part in (levels[:1000], levels[1000:3000], levels[3000:]):
        stats.work([part], [])
    stats.finish()
    assert stats_dwell["power_window_count"] == 2
    assert abs(stats_dwell["power_window_min_dbfs"] + 40) < 0.001
    assert abs(stats_dwell["power_window_max_dbfs"] + 20) < 0.001
    assert stats_dwell["received_samples"] == 4096
    frame = beacon_frame()
    iq = generated_iq(frame)
    received, dwell = decode_generated(iq)
    if len(received) != 1:
        raise RuntimeError(f"Expected one decoded generated beacon, got {len(received)}; {dwell}")
    beacon, metadata = received[0]
    assert beacon["ssid"] == "software-test" and beacon["bssid"] == "02:00:00:00:00:01"
    power = ltf_power_dbfs(metadata["csi"])
    expected = 10 * math.log10(52 / 64 ** 2)
    assert abs(power - expected) < 0.05, (power, expected)
    weaker, _ = decode_generated(iq * 0.5)
    assert len(weaker) == 1
    difference = ltf_power_dbfs(weaker[0][1]["csi"]) - power
    assert abs(difference + 6.0206) < 0.05, difference
    bad, bad_dwell = decode_generated(generated_iq(frame, corrupt_fcs=True))
    assert not bad, "CRC-invalid frame reached the metadata collector"
    assert bad_dwell["ofdm_signal_headers"] == 1, "PHY diagnostic failed to count the bad-FCS frame's valid SIGNAL"
    second_frame = beacon_frame(address="020000000002", sequence=2, tsf=200000)
    combined = np.concatenate([iq, generated_iq(frame, corrupt_fcs=True),
                               generated_iq(second_frame, amplitude=0.5)])
    consecutive, _ = decode_generated(combined)
    assert [item[0]["bssid"] for item in consecutive] == ["02:00:00:00:00:01", "02:00:00:00:00:02"]
    assert abs(ltf_power_dbfs(consecutive[1][1]["csi"]) - power + 6.0206) < 0.05
    # Deterministic impairments exercise synchronization beyond a perfect wire.
    rng = np.random.default_rng(20260928)
    noise_sigma = math.sqrt((52 / 64 ** 2) * 0.5 ** 2 / (10 ** (18 / 10)) / 2)
    impaired = iq * 0.5 * np.exp(2j * np.pi * 75_000 * np.arange(len(iq)) / 20e6)
    impaired += noise_sigma * (rng.standard_normal(len(iq)) + 1j * rng.standard_normal(len(iq)))
    noisy, _ = decode_generated(impaired.astype(np.complex64))
    assert len(noisy) == 1 and noisy[0][0]["ssid"] == "software-test", "Noisy/frequency-offset beacon failed"
    print(f"PASS: generated beacon decoded, identity correct, LTF power {power:.3f} dBFS")
    print(f"PASS: half-amplitude signal changes measured power by {difference:.3f} dB")
    print("PASS: invalid CRC dropped; no hardware opened or RF transmitted")
    print("PASS: consecutive APs retain their own power despite an intervening invalid frame")
    print("PASS: short-window power preserves bursts across scheduler chunk boundaries")
    print("PASS: generated beacon decodes with 18 dB fixture SNR and 75 kHz frequency offset")


if __name__ == "__main__":
    validate()
