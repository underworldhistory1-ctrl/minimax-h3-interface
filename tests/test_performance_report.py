import types
import unittest
from pathlib import Path
from unittest.mock import Mock

from deploy import launcher
from h3_lab.runtime_attention import runtime_memory


class PerformanceReportTests(unittest.TestCase):
    def test_memory_report_uses_loaded_settings_without_process_arguments(self):
        args = types.SimpleNamespace(disable_dynamic_vram=True, disable_async_offload=False,
            disable_pinned_memory=False, disable_smart_memory=False, reserve_vram=3.0,
            fp16_intermediates=False, cache_ram=[], secret_token='do-not-export')
        model = types.SimpleNamespace(model=types.SimpleNamespace(is_dynamic=lambda: False))
        result = runtime_memory({'comfy.cli_args': types.SimpleNamespace(args=args),
            'comfy.model_management': types.SimpleNamespace(current_loaded_models=[model])})
        self.assertEqual(result['source'], 'loaded_runtime')
        self.assertTrue(result['disable_dynamic_vram'])
        self.assertEqual(result['loaded_dynamic_models'], 0)
        self.assertNotIn('do-not-export', str(result))

    def test_missing_runtime_is_unknown_instead_of_guessing_a_memory_mode(self):
        self.assertEqual(runtime_memory({})['source'], 'unknown')

    def test_memory_option_reaches_native_and_supervised_workers(self):
        args = launcher.parser().parse_args(['--disable-dynamic-vram'])
        for platform in ('nt', 'posix'):
            command = launcher.server_command(Path('/comfy'), Path('/python'), args, platform=platform)
            self.assertIn('--disable-dynamic-vram', command)
            if platform == 'nt':
                self.assertIn('--use-ck-attention', command)
                self.assertNotIn('--use-pytorch-cross-attention', command)
        from tests.test_decode_durability import load_supervisor
        command = load_supervisor().worker_command(Path('/python'),
            types.SimpleNamespace(**vars(args), reserve_vram=3.0))
        self.assertIn('--disable-dynamic-vram', command)
        self.assertIn('--use-ck-attention', command)
        self.assertFalse(launcher.memory_ready({'memory': {'source': 'loaded_runtime',
            'disable_dynamic_vram': False}}, args))
        self.assertFalse(launcher.memory_ready({}, args))
        self.assertTrue(launcher.memory_ready({'memory': {'source': 'loaded_runtime',
            'disable_dynamic_vram': True}}, args))

    def test_default_does_not_add_memory_flags_or_reuse_explicit_estimate_worker(self):
        args = launcher.parser().parse_args([])
        self.assertNotIn('--disable-dynamic-vram', launcher.server_command(
            Path('/comfy'), Path('/python'), args, platform='nt'))
        self.assertFalse(launcher.memory_ready({'memory': {'source': 'loaded_runtime',
            'disable_dynamic_vram': True}}, args))

    def test_report_excludes_prompts_media_names_urls_and_credentials(self):
        from deploy.performance_report import collect_report
        prompt = {'1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'h3.safetensors'}},
            '6': {'class_type': 'MiniMaxH3ImageToVideo', 'inputs': {
                'width': 1280, 'height': 704, 'length': 362, 'prompt': 'PRIVATE PROMPT'}},
            '8': {'class_type': 'KSampler', 'inputs': {'steps': 20, 'cfg': 1, 'seed': 42}},
            '20': {'class_type': 'LoadImage', 'inputs': {'image': 'PRIVATE.png'}}}
        data = {'/queue': {'queue_running': [[0, 'private-id', prompt, {'token': 'PRIVATE TOKEN'}]], 'queue_pending': []},
            '/system_stats': {'system': {'pytorch_version': '2.11', 'argv': ['PRIVATE TOKEN']},
                'devices': [{'name': 'RTX 5090', 'vram_total': 32 * 1024**3}]},
            '/history?max_items=2': {}, '/h3_studio/readiness': {'attention': {}, 'memory': {}}}
        api = Mock()
        api.request.side_effect = data.__getitem__
        result = collect_report(api)
        self.assertEqual(result['queue']['running'][0]['nodes'][1]['settings']['width'], 1280)
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('private-id', str(result))
        self.assertEqual(result['system']['pytorch_version'], '2.11')
        self.assertTrue(all(call.args[0].startswith('/') and len(call.args) == 1 for call in api.request.call_args_list))

    def test_partial_failure_is_explicit_and_does_not_export_exception_secrets(self):
        from deploy.performance_report import collect_report
        api = Mock()
        api.request.side_effect = RuntimeError('https://secret:password@host/?arg=PRIVATE')
        report = collect_report(api)
        self.assertEqual(len(report['unavailable']), 4)
        self.assertNotIn('PRIVATE', str(report))
        self.assertNotIn('password', str(report))

    def test_nonfinite_and_oversized_numbers_do_not_destroy_partial_evidence(self):
        import json
        from deploy.performance_report import collect_report, graph_summary
        api = Mock()
        api.request.side_effect = [{}, {'system': {'ram_free': float('nan')},
            'devices': [{'vram_free': float('inf'), 'name': 'RTX 5090'}]}, {}, {}]
        report = collect_report(api)
        self.assertNotIn('ram_free', report['system'])
        self.assertEqual(report['devices'], [{'name': 'RTX 5090'}])
        json.dumps(report, allow_nan=False)
        graph = {'1': {'class_type': 'KSampler', 'inputs': {'steps': 10**400,
            'cfg': float('inf'), 'seed': 2**64-1}}}
        self.assertEqual(graph_summary(graph)[0]['settings'], {'seed': 2**64-1})

    def test_memory_mismatch_cannot_silently_reuse_an_existing_worker(self):
        from unittest.mock import patch
        from deploy.worker_lifecycle import interpreter_identity
        args = launcher.parser().parse_args(['--disable-dynamic-vram'])
        api = Mock()
        api.queue.return_value = {'queue_running': [], 'queue_pending': []}
        api.wait_idle.return_value = True
        api.request.return_value = {'runtime_instance': 'old', 'runtime_fingerprint': 'same',
            'attention': {'source': 'loaded_runtime', 'implementation': 'attention_comfy_kitchen_int8'},
            'acceleration': {'native_cuda_ready': True, 'interpreter_id': interpreter_identity('/python')},
            'memory': {'source': 'loaded_runtime', 'disable_dynamic_vram': False}}
        with patch.object(launcher, 'loaded_source_fingerprint', return_value='same'), patch(
                'deploy.worker_lifecycle.stop_owned_supervisor', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'memory arguments'):
                launcher.start_server(api, Path('/comfy'), Path('/python'), args, Mock(), {}, Mock())
