"""Headless receive-only OFDM graph using the installed gr-ieee802-11 blocks."""

import math
import threading

import numpy as np
import pmt
import ieee802_11
from gnuradio import blocks, fft, gr

from wifi_collector_core import matches_beacon, parse_beacon


class BeaconSink(gr.basic_block):
    def __init__(self, callback, dwell, target_ssid=None, target_bssid=None):
        gr.basic_block.__init__(self, "metadata_only_beacons", in_sig=None, out_sig=None)
        self.callback = callback
        self.dwell = dwell
        self.target_ssid = target_ssid
        self.target_bssid = target_bssid
        self.failed = threading.Event()
        self.error = None
        self.message_port_register_in(pmt.intern("in"))
        self.set_msg_handler(pmt.intern("in"), self.handle)

    def handle(self, message):
        self.dwell["crc_valid_frames"] += 1
        try:
            frame = bytes(pmt.u8vector_elements(pmt.cdr(message)))
            beacon = parse_beacon(frame)
            if beacon is None:
                self.dwell["other_frames_discarded"] += 1
                return
            self.dwell["beacons_decoded"] += 1
            if not matches_beacon(beacon, self.target_ssid, self.target_bssid):
                self.dwell["filtered_beacons"] += 1
                return
            raw = pmt.car(message)
            csi = pmt.dict_ref(raw, pmt.intern("csi"), pmt.PMT_NIL)
            if not pmt.is_c32vector(csi):
                raise ValueError("Decoder PDU lacks LS channel estimate")
            snr = pmt.dict_ref(raw, pmt.intern("snr"), pmt.PMT_NIL)
            metadata = {"csi": pmt.c32vector_elements(csi),
                        "snr": pmt.to_double(snr) if pmt.is_real(snr) else None}
        except (ValueError, TypeError, RuntimeError) as error:
            self.dwell["invalid_metadata"] += 1
            self.dwell["last_metadata_error"] = str(error)
            return
        try:
            self.callback(beacon, metadata)
        except Exception as error:
            # Disk/calibration failures must reach the main thread, not silently
            # kill a GNU Radio message handler while the receiver continues.
            self.error = error
            self.failed.set()


class SampleStats(gr.sync_block):
    def __init__(self, dwell):
        gr.sync_block.__init__(self, "receive_diagnostics", in_sig=[np.complex64], out_sig=None)
        self.dwell = dwell
        self.sum_power = 0.0
        self.window_samples = 2048
        self.pending_power = np.empty(0, dtype=np.float32)
        self.minimum_window_power = math.inf
        self.maximum_window_power = 0.0
        self.window_count = 0

    def work(self, input_items, output_items):
        data = input_items[0]
        self.dwell["received_samples"] += len(data)
        self.dwell["near_full_scale_samples"] += int(np.count_nonzero(
            (np.abs(data.real) >= 0.999) | (np.abs(data.imag) >= 0.999)))
        squared = data.real * data.real + data.imag * data.imag
        self.sum_power += float(np.sum(squared, dtype=np.float64))
        # Fixed-size windows are independent of GNU Radio's scheduler chunk
        # boundaries. Keep only the unfinished window, never a raw IQ recording.
        joined = np.concatenate((self.pending_power, squared)) if len(self.pending_power) else squared
        count = len(joined) // self.window_samples
        if count:
            means = joined[:count * self.window_samples].reshape(count, self.window_samples).mean(axis=1)
            self.minimum_window_power = min(self.minimum_window_power, float(means.min()))
            self.maximum_window_power = max(self.maximum_window_power, float(means.max()))
            self.window_count += count
        self.pending_power = joined[count * self.window_samples:].copy()
        return len(data)

    def finish(self):
        count = self.dwell["received_samples"]
        mean = self.sum_power / count if count else 0
        self.dwell["channel_mean_power_dbfs"] = 10 * math.log10(mean) if mean > 0 else None
        self.dwell["power_window_samples"] = self.window_samples
        self.dwell["power_window_count"] = self.window_count
        self.dwell["power_window_min_dbfs"] = (10 * math.log10(self.minimum_window_power)
                                                if 0 < self.minimum_window_power < math.inf else None)
        self.dwell["power_window_max_dbfs"] = (10 * math.log10(self.maximum_window_power)
                                                if self.maximum_window_power > 0 else None)


class Receiver(gr.hier_block2):
    """Only the RX portion of wifi_rx.grc; no transmitter, TAP or packet sink."""

    def __init__(self, frequency_hz, sample_rate, callback, dwell, target_ssid=None, target_bssid=None):
        gr.hier_block2.__init__(self, "ofdm_beacon_receiver",
                               gr.io_signature(1, 1, gr.sizeof_gr_complex),
                               gr.io_signature(0, 0, 0))
        window_size, sync_length = 48, 320
        self.stats = SampleStats(dwell)
        self.sink = BeaconSink(callback, dwell, target_ssid, target_bssid)
        self.delay_short = blocks.delay(gr.sizeof_gr_complex, 16)
        self.conjugate = blocks.conjugate_cc()
        self.multiply = blocks.multiply_cc()
        self.average_correlation = blocks.moving_average_cc(window_size, 1, 4000)
        self.magnitude = blocks.complex_to_mag(1)
        self.power = blocks.complex_to_mag_squared(1)
        self.average_power = blocks.moving_average_ff(window_size + 16, 1, 4000)
        self.divide = blocks.divide_ff(1)
        self.short = ieee802_11.sync_short(0.56, 2, False, False)
        self.delay_long = blocks.delay(gr.sizeof_gr_complex, sync_length)
        self.long = ieee802_11.sync_long(sync_length, False, False)
        self.vector = blocks.stream_to_vector(gr.sizeof_gr_complex, 64)
        self.fft = fft.fft_vcc(64, True, [1.0] * 64, True, 1)
        self.equalizer = ieee802_11.frame_equalizer(ieee802_11.LS, frequency_hz,
                                                   sample_rate, False, False)
        self.decoder = ieee802_11.decode_mac(False, False)
        self.signal_diagnostics = SignalDiagnostics(dwell)
        self.connect(self, self.stats)
        self.connect(self, self.delay_short, self.conjugate, (self.multiply, 1))
        self.connect(self, (self.multiply, 0))
        self.connect(self.multiply, self.average_correlation, self.magnitude, (self.divide, 0))
        self.connect(self.average_correlation, (self.short, 1))
        self.connect(self, self.power, self.average_power, (self.divide, 1))
        self.connect(self.divide, (self.short, 2))
        self.connect(self.delay_short, (self.short, 0))
        self.connect(self.short, (self.long, 0))
        self.connect(self.short, self.delay_long, (self.long, 1))
        self.connect(self.long, self.vector, self.fft, self.equalizer, self.signal_diagnostics, self.decoder)
        self.msg_connect(self.decoder, "out", self.sink, "in")


def new_dwell(channel, frequency_hz):
    return {"channel": channel, "frequency_hz": frequency_hz,
            "received_samples": 0, "near_full_scale_samples": 0,
            "ofdm_signal_headers": 0, "crc_valid_frames": 0, "beacons_decoded": 0,
            "other_frames_discarded": 0, "filtered_beacons": 0,
            "invalid_metadata": 0, "duplicate_beacons": 0, "saved_beacons": 0,
            "uhd_async_events": [], "crc_failures": None,
            "note": "Native decoder drops bad CRC frames without an exposed count."}


class SignalDiagnostics(gr.sync_block):
    """Count valid OFDM SIGNAL metadata even when subsequent MAC decoding fails."""

    def __init__(self, dwell):
        gr.sync_block.__init__(self, "ofdm_header_diagnostics",
                               in_sig=[(np.uint8, 48)], out_sig=[(np.uint8, 48)])
        self.dwell = dwell

    def work(self, input_items, output_items):
        data = input_items[0]
        output_items[0][:len(data)] = data
        tags = self.get_tags_in_window(0, 0, len(data), pmt.intern("frame bytes"))
        self.dwell["ofdm_signal_headers"] += len(tags)
        return len(data)


class DeviceEvents(gr.basic_block):
    def __init__(self, dwell):
        gr.basic_block.__init__(self, "device_event_metadata", in_sig=None, out_sig=None)
        self.dwell = dwell
        self.message_port_register_in(pmt.intern("in"))
        self.set_msg_handler(pmt.intern("in"), self.handle)

    def handle(self, message):
        # These are UHD device events, not Wi-Fi frames or payloads.
        text = pmt.write_string(message)[:500]
        events = self.dwell["uhd_async_events"]
        if len(events) < 100:
            events.append(text)
        self.dwell["uhd_async_event_count"] = self.dwell.get("uhd_async_event_count", 0) + 1
