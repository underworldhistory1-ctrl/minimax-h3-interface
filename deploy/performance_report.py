#!/usr/bin/env python3
"""Read-only H3 performance snapshot. No inference, cancellation or restart."""
import argparse
import datetime as dt
import json
import math
from pathlib import Path
import re


def select(data, fields):
    if not isinstance(data, dict):
        return {}
    return {key: data[key] for key in fields if key in data and
            (data[key] is None or isinstance(data[key], (str, int, float, bool))) and
            (not isinstance(data[key], float) or math.isfinite(data[key]))}


def graph_summary(graph):
    """Export workload controls, never prompt text, media paths or job metadata."""
    if not isinstance(graph, dict):
        return []
    numeric = {'width', 'height', 'length', 'steps', 'cfg', 'denoise', 'shift_video',
               'shift_audio', 'strength_model', 'strength', 'frame_rate', 'fps', 'seed'}
    names = {'unet_name', 'lora_name', 'sampler_name', 'scheduler', 'weight_dtype'}
    result = []
    for node in list(graph.values())[:512]:
        if not isinstance(node, dict):
            continue
        kind, inputs = node.get('class_type'), node.get('inputs', {})
        if not isinstance(kind, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,120}', kind) or not isinstance(inputs, dict):
            continue
        settings = {}
        for key, value in inputs.items():
            if key in numeric and ((type(value) is int and abs(value) <= 2**64 - 1) or
                                   (type(value) is float and math.isfinite(value))):
                settings[key] = value
            elif key in names and isinstance(value, str):
                settings[key] = value.replace('\\', '/').rsplit('/', 1)[-1][:160]
        result.append({'type': kind, 'settings': settings})
    return result


def collect_report(api):
    report = {'schema_version': 1, 'captured_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'read_only': True, 'unavailable': []}
    def read(path):
        try:
            result = api.request(path)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (RuntimeError, OSError, ValueError):
            report['unavailable'].append(path)  # Never include response/error text.
            return {}
    ready = read('/h3_studio/readiness')
    report['attention'] = select(ready.get('attention'), ('source', 'implementation', 'quantized', 'scope', 'checkpoint_overrides_possible'))
    report['acceleration'] = select(ready.get('acceleration'), ('torch', 'cuda_runtime', 'native_cuda_ready', 'execution_device'))
    report['memory'] = select(ready.get('memory'), ('source', 'disable_dynamic_vram', 'disable_async_offload',
        'disable_pinned_memory', 'disable_smart_memory', 'fp16_intermediates', 'highvram', 'lowvram',
        'novram', 'cpu', 'gpu_only', 'fast_disk', 'disable_fast_disk', 'reserve_vram_gb',
        'loaded_models', 'loaded_dynamic_models', 'ram_total_bytes', 'ram_available_bytes', 'process_rss_bytes', 'swap_percent'))
    report['runtime_fingerprint'] = ready.get('runtime_fingerprint') if re.fullmatch(
        r'[a-f0-9]{64}', str(ready.get('runtime_fingerprint'))) else None
    stats = read('/system_stats')
    report['system'] = select(stats.get('system'), ('os', 'comfyui_version', 'pytorch_version', 'python_version', 'ram_total', 'ram_free'))
    devices = stats.get('devices', [])
    report['devices'] = [select(device, ('name', 'type', 'index', 'vram_total', 'vram_free',
        'torch_vram_total', 'torch_vram_free')) for device in devices[:16]] if isinstance(devices, list) else []
    queue = read('/queue')
    report['queue'] = {}
    for key, label in (('queue_running', 'running'), ('queue_pending', 'pending')):
        items = queue.get(key)
        report['queue'][label + '_count'] = len(items) if isinstance(items, list) else None
        report['queue'][label] = [{'nodes': graph_summary(item[2])} for item in items[:2]
            if isinstance(item, (list, tuple)) and len(item) >= 3] if isinstance(items, list) else []
    history = read('/history?max_items=2')
    report['recent'] = []
    for item in list(history.values())[-2:]:
        if not isinstance(item, dict):
            continue
        prompt = item.get('prompt', [])
        report['recent'].append({'status': select(item.get('status'), ('status_str', 'completed')),
            'nodes': graph_summary(prompt[2] if isinstance(prompt, (list, tuple)) and len(prompt) >= 3 else {})})
    report['notes'] = [
        'Snapshot only: no root cause or GPU speed guarantee follows from readiness.',
        'Compare canvas, frame count, model, adapters, passes and attention before comparing durations.',
        'Capture GPU power/clocks/throttle reasons on the server itself; this client does not assume its local GPU is the server GPU.',
    ]
    if report['memory'].get('source') != 'loaded_runtime':
        report['notes'].append('Memory policy is unknown on this worker; update/restart only when idle to load memory reporting.')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='ComfyUI HTTP(S) base URL; credentials via H3_ACCESS_TOKEN/H3_INSTANCE_PASSWORD')
    parser.add_argument('--output', type=Path, help='Optional JSON report path')
    args = parser.parse_args()
    try:
        from .launcher_smoke import ComfyAPI
    except ImportError:
        from launcher_smoke import ComfyAPI
    try:
        result = collect_report(ComfyAPI(args.url))
    except RuntimeError:
        parser.exit(2, 'Cannot initialize the server connection; use an HTTP(S) URL without embedded credentials.\n')
    content = json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False)
    if args.output:
        args.output.write_text(content + '\n', encoding='utf-8')
    else:
        print(content)
    return 1 if result['unavailable'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
