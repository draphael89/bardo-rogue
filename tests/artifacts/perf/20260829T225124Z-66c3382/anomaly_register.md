# Final anomaly register

- Unrelated Google Chrome rendering, a virtual machine, Claude/Codex windows, and other repositories' tests materially contended CPU/GPU throughout final capture. No unrelated process was stopped. Final latency claims use alternating same-host control/optimized batches only.
- One optimized replay p95 batch was 61.93 ms and one control batch 63.41 ms; paired median statistics limit these shared spikes.
- The product-loop p95 delta was +0.08%, inside noise, despite a -4.96% paired mean. No product-tail improvement is claimed.
- Warden/dense RAF intervals were hundreds of milliseconds under system contention and SwiftShader. They are retained raw but rejected as device-frame evidence.
- The full test command hit the unchanged art CLI test's 5-second timeout. The other 62 files/828 tests passed, and the exact failed file passed 12/12 in isolation; no timeout was increased.
- The pass-10 worker quoted the default seed-2 product hash. The main-agent canonical seed-1 rerun matched the frozen hash `407338761`; the incorrect seed-2 value is excluded.
