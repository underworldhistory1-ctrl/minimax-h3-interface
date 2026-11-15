# Investigating slow H3 sampling

Keep **native Comfy Kitchen INT8 attention** selected. The optional memory-loading test below does not change attention, checkpoint precision, sampling steps, canvas or quality settings. Neither test is an automatic speed fix.

## What the 15 November report establishes

[The reported regression](https://github.com/underworldhistory1-ctrl/minimax-h3-interface/discussions/1#discussioncomment-19635222) describes an RTX 5090/64 GB machine going from 12–14 minutes for a 15-second generation to 30 minutes at step 10/20. A reported memory-clock change from 17000 to 16801 MHz is approximately 1.17%; that clock difference alone does not account for a fourfold increase if all other work and hardware behavior are equal. P1 by itself is not a diagnosis: inspect power/thermal clock-event reasons and utilization during sampling. Do not force P0, change power limits or increase overclocking as a speculative repair.

The source audit includes earlier integration work, not just the Qwen patch:

- `d7f86f1` (2.7) changed the ComfyUI pin from `3b4c0b0` to `426f5ee` (0.43.0) and made CK INT8 attention the launcher default. The older recorded GPU benchmark does not establish speed on the newer core.
- `07d844a` corrected reference audio, optional integration and shared-GPU handling. `67e7d4b` changed Singularity selection transitions. These can affect selected workload or admission, and should be compared with the saved actual graph; they do not establish a cause for slow sampler steps.
- `b94a597` and `1d942a7` (2.17/2.17.1) did not change the video graph builder, worker memory flags or ComfyUI pin. Extra Qwen profiles are downloaded only when selected and are not loaded merely by starting the interface.

The report contains no actual canvas, checkpoint, full graph, launch log or memory trace from the affected machine. Its root cause and restored generation time remain unverified. A blocked shared-GPU admission occurs before sampler execution and cannot by itself explain slow progress at step 10.

## Capture a report during the slow run

From the repository, using any Python 3 interpreter:

```powershell
python deploy/performance_report.py --url http://127.0.0.1:8188 --output h3-performance.json
```

The same command works on Linux. Proxy prefixes are supported. For authenticated providers, set `H3_ACCESS_TOKEN` or `H3_INSTANCE_PASSWORD` in the environment. The report reads readiness, system stats, the active queue and the last two history entries. It never submits, cancels or restarts a generation. Missing endpoints are listed explicitly and cause a nonzero exit code while retaining partial evidence.

The JSON contains loaded attention, Torch/CUDA versions, memory flags, current VRAM/RAM gauges, and a reduced graph showing canvas/frame count/steps, checkpoint and adapter names, sampler and optional pass node types. It omits prompts, media filenames, job IDs, history messages, argv and authentication fields. Custom checkpoint/adapter basenames are included for comparison; inspect them before sharing. Older workers report memory settings as unknown until updated and restarted when idle.

On the **GPU server itself**, capture the following separately while sampling. A client connecting to a remote API must not mistake its own GPU readings for the server's:

```powershell
nvidia-smi --query-gpu=timestamp,name,pstate,memory.used,memory.total,utilization.gpu,clocks.sm,clocks.mem,power.draw,power.limit,temperature.gpu --format=csv -l 2
nvidia-smi -q -d PERFORMANCE,POWER,TEMPERATURE,CLOCK,MEMORY
```

Stop the repeating query with Ctrl+C after about a minute. On Windows also inspect Task Manager's dedicated/shared GPU memory, available RAM, committed memory and disk activity. Shared-memory spill or paging is a hypothesis until these traces show it. A single swap-percent snapshot does not measure paging rate. Native CK readiness proves availability of the server's default backend, not that every model-specific override uses it.

## Compare the actual workload first

Match the saved graph and inputs: mode, INT8 versus BF16 model, width/height, frame count, number/duration of references, LoRAs, temporal guides, ControlNet, refinement and audio enhancement. Fifteen seconds alone does not define the same workload. Larger canvases and extra passes can increase memory and work substantially. Compare actual sampler seconds/step after the first step; distinguish loading, text encoding, sampling, decode and save. KSampler cache reuse is not a faster fresh generation.

Check the report's loaded attention is `attention_comfy_kitchen_int8`, source `loaded_runtime`, and native CUDA readiness is true. If it differs, relaunch through the normal launcher after work is idle; CK INT8 remains the default. Do not switch to PyTorch as a performance repair for this report.

## Optional matched memory-loading test

The pinned upstream core enables dynamic VRAM by default and offers estimate-based loading through `--disable-dynamic-vram`. If a matched workload shows memory-pressure/offload symptoms, test this one variable with the **same CK INT8 attention**:

```powershell
.\launcher.ps1 -ComfyRoot C:\ComfyUI_windows_portable\ComfyUI -DisableDynamicVram -NoUpdate -SkipSmoke
```

```bash
bash launcher.sh --comfy-root /path/to/ComfyUI --disable-dynamic-vram --no-update --skip-smoke
```

Keep the same interpreter, model-storage and other arguments normally used for this installation. Windows and other externally started workers must be stopped manually **when idle** if the launcher cannot prove ownership; the launcher will not kill an unknown worker. Verify `memory.source=loaded_runtime`, `memory.disable_dynamic_vram=true` and the unchanged CK attention in the new report before comparing. The Linux supervisor retains this option across worker restarts. To restore the default, stop the test worker when idle and rerun without the option. The launcher refuses to reuse a worker whose reported selection differs.

Do not combine this test with changes to reserve VRAM, async offload, pinned memory, high-VRAM mode, driver version or clock settings. Estimate loading may help, hurt or exhaust memory on different workloads; retain it only after measurement. No matched GPU benchmark on the reporter's machine has been run for this release.

## Primary references

- [Pinned ComfyUI loading and attention arguments](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/comfy/cli_args.py)
- [Pinned memory management](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/comfy/model_management.py)
- [NVIDIA performance state and clock event reasons](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
