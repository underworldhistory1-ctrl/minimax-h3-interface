import copy
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from h3_lab.capabilities import check_capabilities
from h3_lab.configuration import validate_configuration


class SparseAttentionTests(unittest.TestCase):
    def build_spec(self, resolved=None, **updates):
        spec = {
            'model_profile': 'original',
            'mode': 'text',
            'sparse_attention': {'enabled': True},
            **updates,
        }
        caps = {
            'sparse_attention_ready': True,
            'refine_ready': True,
            'audio_refine_ready': True,
            'sampling_options': {'samplers': ['res_multistep', 'euler'], 'schedulers': ['simple'], 'weight_dtypes': ['default']},
        }
        script = (
            'const s=' + json.dumps(spec) + ';'
            's.workflow=require("./web/h3/graph-builder").buildGraph(s,' + json.dumps(resolved or {}) + ',' + json.dumps(caps) + ');'
            'console.log(JSON.stringify(s));'
        )
        raw = subprocess.check_output(['node', '-e', script], cwd=Path(__file__).resolve().parents[1], text=True)
        return json.loads(raw)

    def test_capabilities_reflect_node_and_sol_attn_kernel(self):
        fake_nodes = types.SimpleNamespace(NODE_CLASS_MAPPINGS={'BlockSparseAttention': object()})
        self.assertTrue(check_capabilities(nodes_module=fake_nodes)['sparse_attention_ready'])
        self.assertFalse(check_capabilities(nodes_module=types.SimpleNamespace(NODE_CLASS_MAPPINGS={}))['sparse_attention_ready'])

        fake_ck = types.ModuleType('comfy_kitchen')
        fake_ck.sol_attn_is_available = lambda _dev: False
        fake_mm = types.ModuleType('comfy.model_management')
        fake_mm.get_torch_device = lambda: 'cuda:0'
        with patch.dict(sys.modules, {'comfy_kitchen': fake_ck, 'comfy.model_management': fake_mm}):
            self.assertFalse(check_capabilities(nodes_module=fake_nodes)['sparse_attention_ready'])
        fake_ck.sol_attn_is_available = lambda _dev: True
        with patch.dict(sys.modules, {'comfy_kitchen': fake_ck, 'comfy.model_management': fake_mm}):
            self.assertTrue(check_capabilities(nodes_module=fake_nodes)['sparse_attention_ready'])

    def test_valid_graphs_pass_admission(self):
        caps = {'sparse_attention_ready': True, 'refine_ready': True, 'audio_refine_ready': True}
        pika_1080 = self.build_spec(
            resolved={'hero': 'hero.png'},
            mode='refs',
            width=1920,
            height=1080,
            steps=8,
            loras=[{'name': 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors', 'enabled': True, 'strength': 1}],
            sampling={'sampler_name': 'euler', 'scheduler': 'simple', 'cfg': 1, 'denoise': 1, 'shift_video': 12, 'shift_audio': 3, 'weight_dtype': 'default'},
            references=[{'alias': 'hero', 'kind': 'image', 'filename': 'hero.png'}],
        )
        validate_configuration(pika_1080, caps)

        refined = self.build_spec(
            render_method='spectrum',
            enable_refine=True,
            loras=[{'name': 'Motion_Repair_V2.safetensors', 'enabled': True, 'strength': 1}],
            sparse_attention={'enabled': True, 'tau': 1.5, 'start_percent': 0.15, 'end_percent': 0.95, 'extra_tokens': 128, 'sink_conditioning': 'exact_kv'},
        )
        validate_configuration(refined, caps)

        with_audio = self.build_spec(audio_refinement={'enabled': True})
        validate_configuration(with_audio, caps)

    def test_tampered_or_unavailable_sparse_attention_rejected(self):
        caps = {'sparse_attention_ready': True}
        spec = self.build_spec()

        with self.assertRaisesRegex(ValueError, 'unavailable'):
            validate_configuration(copy.deepcopy(spec), {'sparse_attention_ready': False})

        bad_tau = copy.deepcopy(spec)
        next(n for n in bad_tau['workflow'].values() if n.get('class_type') == 'BlockSparseAttention')['inputs']['selection.tau'] = 2.5
        with self.assertRaisesRegex(ValueError, 'disagree'):
            validate_configuration(bad_tau, caps)

        bad_sink = copy.deepcopy(spec)
        next(n for n in bad_sink['workflow'].values() if n.get('class_type') == 'BlockSparseAttention')['inputs']['sink_conditioning'] = 'off'
        with self.assertRaisesRegex(ValueError, 'disagree'):
            validate_configuration(bad_sink, caps)

        disabled = copy.deepcopy(spec)
        disabled['sparse_attention'] = {'enabled': False}
        with self.assertRaisesRegex(ValueError, 'disabled'):
            validate_configuration(disabled, caps)
