#!/usr/bin/env node
/**
 * Offline week replay. Prints metrics JSON. Exits 1 when side effects drift.
 * Usage: node isolate/jev-line-classify/replay.mjs
 */
import { runWeek } from './metrics.mjs';

const report = runWeek();
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.behaviorMatch || report.sideEffectDelta.total !== 0 || report.externalApiCalls !== 0 || report.wiredToProduction !== false) {
  process.exitCode = 1;
}
