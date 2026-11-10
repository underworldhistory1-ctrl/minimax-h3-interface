# 2.16.0 - Release completion and queue safety

Released 10 November 2026. Runtime and model pins are unchanged.

## Completed behavior

- Preserve delayed reference-audio timelines and declared LoRA execution order. Retain installed Pika variants, Singularity v2 choices, supported refinement and secondary physics/consistency adapters from the preceding corrections.
- Keep shared-GPU admission opt-in. The native exclusive lease arbitrates pending work, so two pending workers cannot block each other. Running peers and malformed or unknown queue responses prevent admission; idle peer cache handoff retains RAM caches.
- Remove hardcoded LTX Studio status and lock probes from capability reporting. Temporary activity cannot leave Generate disabled in a cached response. Jobs wait in the cancellable native queue instead. Both workers must use the matching guard and the same lease path; unrelated external workers are not covered.
- Omit the unfinished FaceRefine panel and its handlers. Capability reporting stays false and unsupported requests remain rejected. FaceRefine is not an available release feature.
- Keep grouped-reference reorder buttons accessible beside the drag grip when a card is expanded.
- Make concurrent API admission tests tolerate initial Windows storage discovery and clean up outstanding requests before deleting fixture storage.
- Run browser acceptance in CI alongside Windows/Linux Python 3.12/3.13, JavaScript, shell and immutable archive checks. The reference workflow in deploy/ci matches the active workflow.

## Verification

The local Windows source audit covers 623 Python tests (two platform skips), 340 JavaScript tests, the 528-case supported and 2,096-case expanded connected-graph matrices, shell syntax, and independent Python/JavaScript reviews. Platform-specific Linux lease behavior is exercised by Linux CI. Consult [exact-commit CI](https://github.com/underworldhistory1-ctrl/minimax-h3-interface/actions/workflows/verify.yml) for current cross-platform results.

Eleven real-browser journeys use actual local project, asset, preparation and job APIs with simulated inference: core creation/recovery/cancellation, Qwen images, imported continuation, reference handling, resolution, spatial storyboards, grouped views and folds, layout customization, soundtrack selection, named project settings/storage, and connected controls/shared queue. The connected journey performs actual CPU Canny extraction. No model weights or provider inference are used in these browser fixtures.

The release builder produces a committed-source archive, source provenance, a per-file SHA-256 manifest and verified inner/outer ZIP files. Weights, credentials, generated user projects and machine-specific state are excluded.

## Rendering acceptance

On 10 November 2026, the repository owner stated that they rendered and tested their workflows and everything worked correctly. This is owner-reported acceptance. The audit does not invent new GPU logs, model-output measurements or an exhaustive setting matrix from that statement. Earlier captured GPU evidence remains in [the historical report](PRODUCTION_READINESS_2026_10_15.md); its dates and scope are unchanged.

Supported release features have no known blocking issue in the completed checks. Optional experimental routes retain their documented limits. No finite test suite establishes that every prompt, hardware environment or third-party model combination is error-free.
