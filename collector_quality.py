"""Exploratory collection flags; these are not statistical confidence gates."""


def assess_dwell(dwell, scheduled_seconds, sample_rate):
    """Return readable concerns about one dwell; preserve observations either way.

    Optional user contribution (about 5–10 lines): refine the allowable sample
    loss/clipping policy for repeatable field trials. The defaults work now.
    """
    flags = []
    count = dwell["received_samples"]
    if count < 0.9 * scheduled_seconds * sample_rate:
        flags.append("received_sample_coverage_below_90_percent")
    if count and dwell["near_full_scale_samples"] / count > 0.0001:
        flags.append("near_full_scale_fraction_above_0.01_percent")
    if dwell.get("uhd_async_event_count", 0):
        flags.append("uhd_reported_events_inspect_for_overflow")
    if not dwell["saved_beacons"]:
        flags.append("no_saved_beacons")
    return flags
