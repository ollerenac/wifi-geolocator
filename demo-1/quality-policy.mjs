/** Exploratory collection gates. These are adjustable, not confidence claims. */
export function assessSeries(summary, limits) {
  // TODO: personalize these 5–10 lines to define a usable station capture.
  const issues = [];
  if (summary.sampleCount < limits.minSamples) issues.push(`Only ${summary.sampleCount} samples; need ${limits.minSamples}.`);
  if (summary.spanSeconds < limits.minSpanSeconds) issues.push(`Observed span ${summary.spanSeconds.toFixed(1)} s; need ${limits.minSpanSeconds} s.`);
  if (summary.timeBins < limits.minTimeBins) issues.push(`Only ${summary.timeBins} occupied time bins; need ${limits.minTimeBins}.`);
  if (summary.spreadDb > limits.maxMadDb) issues.push(`Signal MAD ${summary.spreadDb.toFixed(1)} dB exceeds the review threshold.`);
  return { usable: issues.length === 0, issues };
}
