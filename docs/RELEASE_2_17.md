# 2.17.2 — Qwen reference workspace and runtime diagnostics

This release updates the existing Create Image workspace and retains the baseline H3/video paths. [Controls and limits](QWEN_REFERENCE_WORKSPACE.md) describes reference semantics, persistence, optional Turbo and upstream sources.

## 2.17.2 performance follow-up

Native CK INT8 attention remains the default. The [performance guide](PERFORMANCE_DIAGNOSIS.md) records the 5090 report, relevant earlier source changes and remaining evidence gaps. Read-only reports now expose loaded memory flags and selected workload controls. An opt-in estimate-loading comparison propagates through Windows and Linux workers and cannot silently reuse a mismatched worker. This supplies diagnosis and a controlled test, not proof of the reporter's root cause or restored speed. Canonical 2.17.1 runtime hashes retain safe official upgrades.

Verification includes eight new CPU regressions for report privacy/partial failures/numeric handling, worker propagation and loaded-policy mismatch; Windows/Linux full-suite CI, JavaScript and browser acceptance remain release gates. A real local fixture API produced a complete report; an offline endpoint produced an explicitly incomplete report. No new GPU inference was run for this follow-up.

## Changes

- Ten distinct references with per-image roles and take/preserve/exclude instructions.
- Task workflows and a resolved native-token/reference connection preview.
- Alias and native-token identity retained through rename/reorder; deleted references fail explicitly.
- Negative conditioning with Auto CFG 1/2 and explicit rejection of ineffective CFG 1 + negative prompts.
- Native cache device/storage precision, persisted with image settings.
- Edit a generated image in Qwen or append it as a reference without generating automatically.
- Optional official Turbo INT8/BF16 checkpoints, shared encoder/VAE and eight-step Euler/manual-sigma graphs. Baseline steps survive profile switching and refresh.
- Existing launcher/downloader opt-in supports Turbo, with pinned revision, expected sizes and SHA-256. Baseline remains the default; no ControlNet download is required.

## 2.17.0/2.17.1 local verification (15 November 2026)

- Python: 629 tests, OK, two platform-specific skips on Windows.
- JavaScript: 344 tests passed.
- Full browser journeys include the new ten-reference/Turbo journey; inference is simulated.
- Additional browser audits passed six viewport widths, three video modes, five workspace views, image proxy/workspace flows and video/image tab persistence.
- A local staged upgrade from official 2.16.0 to the new runtime passed and preserved an output sentinel.
- All four profile file sets matched pinned official remote size/SHA-256 metadata.
- Independent code review resolved guidance, launcher opt-in and baseline-step preservation findings.

## Verification boundaries

Python and JavaScript regressions, simulated-inference browser acceptance and immutable release packaging are checked separately from real model output. The new browser journey exercises ten distinct upload names/bytes, encoder connections, roles/workflow, cache/negative/guidance, persistence, rename/reorder/removal, output reuse and Turbo graph/step preference restoration.

All baseline and Turbo file metadata was compared against the immutable official HF API revision. The current rental's baseline INT8 file sizes were inspected read-only. The initial storage observation preceded worker startup. A later ten-reference Turbo GPU smoke is recorded below; this release does not claim a Turbo speed benchmark or director-approved image quality. Mask references remain semantic guides; Qwen has tab drafts and generated-image metadata rather than an H3-equivalent server scene editor. Prompt Enhancer integration remains outside this release.

Review and CI results should be read on the exact pull-request/merge commit. The standard verification workflow runs Python on Linux/Windows 3.12/3.13, JavaScript, release packaging and browser journeys. Never restart the production worker during an accepted render to install this release.

## 2.17.1 follow-up: real upgrade and GPU evidence

The first real staged update exposed missing canonical hashes for the installed 2.16.0 release. Stage one correctly verified the original source; after source advancement, stage two rejected unchanged older runtime files. The follow-up adds only Git blob hashes from the exact official commits `ff891071a11ee9f660370dbe98fa101db8ab40df` and `b94a5975e965bc78352fcd121e40d44ca9271293`. No installed files or custom content are used to populate the allowlist. Custom edit checks remain unchanged and a new regression verifies that distinction.

Before the rental disconnected, an eight-step native Turbo INT8 graph with ten uploaded synthetic references completed in approximately 31 seconds including its initial loading/execution window, and the resulting 512×512 PNG fully decoded. This is a single wiring smoke, not a speed benchmark or visual-quality acceptance. The full Turbo file passed SHA-256 verification. Private runtime receipts and the retained output live under `/output/qwen-upgrade-audit/` and `/output/qwen-turbo-preparation-receipt.json`; no credentials are included in this repository.

The final repository audit also blocks mention/seed/reuse mutations while an image job is busy, updates older browser fixtures to advertise the required LoadImage capability, and checks source syntax, JSON and referenced frontend assets. Live-server deployment is not rechecked after disconnection.
