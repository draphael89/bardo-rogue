# Anomaly register

- Early replay/product batches used only five warmups and showed first-batch drift. They are retained as `*-baseline-*.json` but excluded from the stable headline. Stable batches use 50 warmups.
- One browser capture failed because its development server exited before attachment. It produced no baseline artifact and was repeated with server lifetime scoped to the capture command.
- Warden RAF-interval batches vary materially and all miss 18 ms under headless SwiftShader, while measured Presenter+Pixi work is stable and within budget. Treat interval data as an environment limitation, not a physical-GPU regression.
- Node sampled allocations include `tsx` compilation and module startup. Function-level allocation evidence is used qualitatively unless the same browser/harness profile repeats it.
- The dense scene is intentionally beyond normal authored population. It is used to expose scaling laws, never to assert ordinary gameplay frame time.
- After profiling, the default parallel full-suite run twice pushed the existing 5-second `collision invariants` test past its timeout (and once did the same to an art CLI subprocess). Both files passed alone, and the complete suite passed 827/827 with `--maxWorkers=1`. No timeout or test-policy change was made.
