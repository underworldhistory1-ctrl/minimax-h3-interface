"""Report server-wide attention without exposing process arguments or secrets."""
import sys
import hashlib
import os


def runtime_attention(arguments=None, modules=None):
    arguments = sys.argv if arguments is None else arguments
    modules = sys.modules if modules is None else modules
    module = modules.get("comfy.ldm.modules.attention")
    implementation = getattr(getattr(module, "optimized_attention", None), "__name__", None)
    source = 'loaded_runtime' if implementation is not None else 'unknown'
    labels = {
        "attention_pytorch": "PyTorch dense",
        "attention_comfy_kitchen_int8": "Comfy Kitchen INT8",
        "attention_sage": "Sage attention",
        "attention_sage3": "Sage attention 3",
        "attention_xformers": "xFormers",
        "attention_sub_quad": "Sub-quadratic attention",
        "attention_split": "Split attention",
    }
    if implementation is None:
        flags = {"--use-pytorch-cross-attention": "attention_pytorch",
                 "--use-ck-attention": "attention_comfy_kitchen_int8",
                 "--use-sage-attention": "attention_sage"}
        implementation = next((name for flag, name in flags.items() if flag in arguments), "runtime_default")
        if implementation != 'runtime_default':
            source = 'launch_argument'
    return {"implementation": implementation, "source": source, "label": labels.get(implementation, "Runtime default / unknown"),
            "quantized": implementation in ("attention_comfy_kitchen_int8", "attention_sage", "attention_sage3"),
            "scope": "server_dense_default", "checkpoint_overrides_possible": True}


def runtime_acceleration(modules=None):
    """Describe the loaded worker, without importing packages or launching GPU work."""
    modules = sys.modules if modules is None else modules
    torch = modules.get('torch')
    cuda = getattr(getattr(torch, 'version', None), 'cuda', None)
    result = {'torch': str(getattr(torch, '__version__', 'unavailable')),
              'cuda_runtime': cuda, 'native_cuda_ready': False,
              'interpreter_id': hashlib.sha256(os.path.normcase(os.path.abspath(sys.executable)).encode('utf-8')).hexdigest()}
    try:
        version = tuple(int(part) for part in str(cuda).split('.')[:2])
        kitchen = modules.get('comfy_kitchen')
        backend = kitchen.list_backends().get('cuda', {})
        device = modules.get('comfy.model_management').get_torch_device()
        result['execution_device'] = getattr(device, 'type', str(device).split(':')[0])
        result['native_cuda_ready'] = bool(result['execution_device'] == 'cuda'
            and torch.cuda.is_available() and version >= (13, 0)
            and backend.get('available', False) and not backend.get('disabled', False))
    except (AttributeError, TypeError, ValueError, RuntimeError, OSError):
        pass
    return result


def runtime_root_identity(root):
    from pathlib import Path
    value = os.path.normcase(str(Path(root).resolve()))
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def runtime_memory(modules=None):
    """Read loaded settings and memory gauges; never export argv or run inference."""
    modules = sys.modules if modules is None else modules
    args = getattr(modules.get('comfy.cli_args'), 'args', None)
    result = {'source': 'loaded_runtime' if args is not None else 'unknown'}
    if args is not None:
        for key in ('disable_dynamic_vram', 'disable_async_offload', 'disable_pinned_memory',
                    'disable_smart_memory', 'fp16_intermediates', 'highvram', 'lowvram',
                    'novram', 'cpu', 'gpu_only', 'fast_disk', 'disable_fast_disk'):
            result[key] = bool(getattr(args, key, False))
        reserve = getattr(args, 'reserve_vram', None)
        result['reserve_vram_gb'] = reserve if isinstance(reserve, (int, float)) else None
    management = modules.get('comfy.model_management')
    loaded = getattr(management, 'current_loaded_models', None)
    if isinstance(loaded, (list, tuple)):
        result['loaded_models'] = len(loaded)
        try:
            result['loaded_dynamic_models'] = sum(bool(item.model.is_dynamic()) for item in loaded)
        except (AttributeError, RuntimeError, TypeError):
            result['loaded_dynamic_models'] = None
    psutil = modules.get('psutil')
    if psutil is not None:
        try:
            memory = psutil.virtual_memory()
            result.update(ram_total_bytes=memory.total, ram_available_bytes=memory.available,
                          process_rss_bytes=psutil.Process().memory_info().rss,
                          swap_percent=psutil.swap_memory().percent)
        except (OSError, RuntimeError, AttributeError, psutil.Error):
            pass
    return result
