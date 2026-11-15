# 2.17.0 — Qwen reference workspace

This release updates the existing Create Image workspace and retains the baseline H3/video paths. [Controls and limits](QWEN_REFERENCE_WORKSPACE.md) describes reference semantics, persistence, optional Turbo and upstream sources.

## Changes

- Ten distinct references with per-image roles and take/preserve/exclude instructions.
- Task workflows and a resolved native-token/reference connection preview.
- Alias and native-token identity retained through rename/reorder; deleted references fail explicitly.
- Negative conditioning with Auto CFG 1/2 and explicit rejection of ineffective CFG 1 + negative prompts.
- Native cache device/storage precision, persisted with image settings.
- Edit a generated image in Qwen or append it as a reference without generating automatically.
- Optional official Turbo INT8/BF16 checkpoints, shared encoder/VAE and eight-step Euler/manual-sigma graphs. Baseline steps survive profile switching and refresh.
- Existing launcher/downloader opt-in supports Turbo, with pinned revision, expected sizes and SHA-256. Baseline remains the default; no ControlNet download is required.

## Local verification (15 November 2026)

- Python: 628 tests, OK, two platform-specific skips on Windows.
- JavaScript: 344 tests passed.
- Full browser journeys include the new ten-reference/Turbo journey; inference is simulated.
- All four profile file sets matched pinned official remote size/SHA-256 metadata.
- Independent code review resolved guidance, launcher opt-in and baseline-step preservation findings.

## Verification boundaries

Python and JavaScript regressions, simulated-inference browser acceptance and immutable release packaging are checked separately from real model output. The new browser journey exercises ten distinct upload names/bytes, encoder connections, roles/workflow, cache/negative/guidance, persistence, rename/reorder/removal, output reuse and Turbo graph/step preference restoration.

All baseline and Turbo file metadata was compared against the immutable official HF API revision. The current rental's baseline INT8 file sizes were inspected read-only. Its separate setup chat was still preparing dependencies during development. This release does not claim a new GPU output, Turbo speed benchmark or director-approved image quality. Mask references remain semantic guides; Qwen has tab drafts and generated-image metadata rather than an H3-equivalent server scene editor. Prompt Enhancer integration remains outside this release.

Review and CI results should be read on the exact pull-request/merge commit. The standard verification workflow runs Python on Linux/Windows 3.12/3.13, JavaScript, release packaging and browser journeys. Never restart the production worker during an accepted render to install this release.
