/**
 * Exploratory test criteria, not operational approval or statistical confidence.
 * report: { stations, areaM2, errorM, truthCompatible, clipped, calibrated }
 * limits: { maxAreaM2, maxErrorM }
 */
export function assessTrial(report, limits) {
  // TODO: personalize these 5–10 lines after deciding what makes a useful field result.
  if (report.stations < 3) return 'Collect at least three distinct station positions.';
  if (!report.calibrated) return 'Calibrate the RSSI model before assessing a field trial.';
  if (report.clipped) return 'Expand the plot; the region reaches its boundary.';
  if (report.areaM2 === 0) return 'No sampled overlap. Check measurements, tolerance, and grid resolution.';
  if (report.errorM === null) return 'Enter an independent known AP position to evaluate this trial.';
  if (!report.truthCompatible) return 'The known AP is outside the model-compatible region.';
  if (report.areaM2 > limits.maxAreaM2 || report.errorM > limits.maxErrorM) return 'This trial exceeds the selected area or position-error limit.';
  return 'Exploratory trial criteria met. Repeat with independent measurements.';
}
