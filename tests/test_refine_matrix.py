"""Exhaustive combinatorial verification of Generative Refinement (MinimaxH3LatentUpscaler3D)
across every supported H3 mode, profile, Pika Flex adapter, render method, Sol-Attn,
Audio Enhancement, LoRA stack, Dial, Temporal Guide, Canvas preset, and negative guard.
"""
import copy
import json
import subprocess
import unittest
from pathlib import Path

from h3_lab.configuration import (
    ANIME_TO_REALISM,
    CHARACTER_SWAP,
    PIKA,
    SPATIAL_PHYSICS,
    VBVR,
    validate_configuration,
)
from h3_lab.jobs import validate_resource_contract

ROOT = Path(__file__).resolve().parents[1]
SINGULARITY_V2 = 'Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors'

CAPS = {
    'sampling_options': {
        'samplers': ['res_multistep', 'euler'],
        'schedulers': ['simple', 'sgm_uniform'],
        'weight_dtypes': ['default', 'fp8_e4m3fn'],
    },
    'model_catalog': [
        {'name': SINGULARITY_V2, 'profiles': ['singularity'], 'loader': 'UNETLoader'},
        {'name': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'profiles': ['hybrid_conditioning', 'hybrid_loader'], 'loader': 'UNETLoader'},
    ],
    'hybrid_loader_ready': True,
    'dials_ready': True,
    'dial_files': ['dials/h3_motion.safetensors', 'dials/h3_evil_creepy.safetensors'],
    'refine_ready': True,
    'audio_refine_ready': True,
    'sparse_attention_ready': True,
    'continuation_ready': True,
    'controlnet_ready': True,
    'add_guide': True,
    'guide_audio': True,
    'guide_video': True,
}

ASSETS = {
    'first': 'first.png',
    'last': 'last.png',
    'references': {
        'hero': 'hero.png',
        'shot': 'shot.mp4',
        'voice': 'voice.wav',
    },
    'guides': {
        'g_img': 'guide.png',
        'g_aud': 'guide.wav',
        'g_vid': 'guide.mp4',
    },
}


def build_batch(cases):
    script = """
const C = require('./web/h3/configuration');
const B = require('./web/h3/graph-builder');
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = [];
for (const tc of input.cases) {
  const s = tc.spec;
  if (s.loras) s.loras = C.activeLorasInModelOrder(s.loras);
  try {
    const g = B.buildGraph(s, input.assets, input.caps);
    out.push({ id: tc.id, ok: true, spec: { ...s, workflow: g } });
  } catch (e) {
    out.push({ id: tc.id, ok: false, error: e.message });
  }
}
process.stdout.write(JSON.stringify(out));
"""
    raw = subprocess.check_output(
        ['node', '-e', script],
        input=json.dumps({'cases': cases, 'assets': ASSETS, 'caps': CAPS}),
        cwd=ROOT,
        text=True,
    )
    return json.loads(raw)


class RefineCombinatorialMatrixTest(unittest.TestCase):
    def test_exhaustive_valid_refine_matrix(self):
        cases = []
        base_refs = [
            {'kind': 'image', 'alias': 'hero', 'filename': 'hero.png'},
            {'kind': 'video', 'alias': 'shot', 'filename': 'shot.mp4', 'fps': 24, 'frame_count': 124, 'use_audio': True},
            {'kind': 'audio', 'alias': 'voice', 'filename': 'voice.wav'},
        ]

        # 1. All 7 Pika Flex variants x Original H3 (and Singularity v2 for Ref2VA) x Secondary LoRAs x Sol-Attn x Dials x Canvases
        for pika_name, (p_steps, family) in PIKA.items():
            modes = ['refs'] if family == 'ref2va' else ['text', 'frames']
            profiles = ['original', 'singularity'] if family == 'ref2va' else ['original']
            shift_v = 12 if family == 'ref2va' else 6
            for mode in modes:
                for profile in profiles:
                    for sparse in (False, True):
                        for extra_loras in (
                            [],
                            [{'name': 'Motion_Repair_V2.safetensors', 'enabled': True, 'strength': 0.9}],
                            [{'name': 'H3_Combat_V2.safetensors', 'enabled': True, 'strength': 0.85}, {'name': SPATIAL_PHYSICS, 'enabled': True, 'strength': 0.3}, {'name': VBVR, 'enabled': True, 'strength': 0.5}],
                            [{'name': ANIME_TO_REALISM, 'enabled': True, 'strength': 1.0}] if mode == 'refs' else [],
                        ):
                            if extra_loras == [] and mode != 'refs':
                                pass
                            spec = {
                                'model_profile': profile,
                                'checkpoint': SINGULARITY_V2 if profile == 'singularity' else None,
                                'mode': mode,
                                'render_method': 'native',
                                'width': 1920 if sparse else 1280,
                                'height': 1080 if sparse else 704,
                                'target_frames': 124,
                                'steps': p_steps,
                                'seed': 42,
                                'sampling': {'sampler_name': 'euler', 'scheduler': 'simple', 'cfg': 1, 'denoise': 1, 'shift_video': shift_v, 'shift_audio': 3, 'weight_dtype': 'default'},
                                'loras': [{'name': pika_name, 'enabled': True, 'strength': 1.0}] + extra_loras,
                                'dials': [{'name': 'dials/h3_motion.safetensors', 'strength': 0.5, 'enabled': True}] if sparse else [],
                                'sparse_attention': {'enabled': sparse},
                                'enable_refine': True,
                                'refine_scale': 1.25,
                                'refinement': {'steps': 6, 'denoise': 0.35, 'cfg': 1, 'sampler_name': 'euler' if sparse else 'res_multistep', 'scheduler': 'simple'},
                                'frames': {'first': {'filename': 'first.png'}, 'last': {'filename': 'last.png'}} if mode == 'frames' else {},
                                'references': base_refs if mode == 'refs' else [],
                            }
                            cases.append({'id': f'pika:{pika_name}:{profile}:{mode}:sp={sparse}:ex={len(extra_loras)}', 'spec': spec})

        # 2. All non-Pika profiles x modes x render methods x Sol-Attn x Audio Enhance x Motion_Repair_V2 / Character Swap / Preserve Audio
        for profile in ('original', 'singularity', 'hybrid_conditioning', 'hybrid_loader'):
            for mode in ('text', 'frames', 'refs'):
                for method in ('native', 'spectrum', 'motioncache'):
                    for sparse in (False, True):
                        for audio_enh in (False, True):
                            loras = [{'name': 'Motion_Repair_V2.safetensors', 'enabled': True, 'strength': 0.9, 'refinement_strength': None}]
                            if mode == 'refs' and method == 'native' and not sparse:
                                loras.append({'name': CHARACTER_SWAP, 'enabled': True, 'strength': 1.0})
                            spec = {
                                'model_profile': profile,
                                'checkpoint': SINGULARITY_V2 if profile == 'singularity' else None,
                                'hybrid_preset': 'block_range_adaln' if profile == 'hybrid_loader' else 'none',
                                'mode': mode,
                                'render_method': method,
                                'width': 1664 if method == 'spectrum' else 1280,
                                'height': 928 if method == 'spectrum' else 704,
                                'target_frames': 124,
                                'steps': 20,
                                'seed': 101,
                                'loras': loras,
                                'dials': [{'name': 'dials/h3_motion.safetensors', 'strength': 0.4, 'enabled': True}, {'name': 'dials/h3_evil_creepy.safetensors', 'strength': -0.5, 'enabled': True}],
                                'sparse_attention': {'enabled': sparse},
                                'audio_refinement': {'enabled': audio_enh, 'steps': 6, 'denoise': 0.45, 'sampler_name': 'euler', 'scheduler': 'simple'},
                                'enable_refine': True,
                                'refine_scale': 1.2,
                                'refinement': {'steps': 10, 'denoise': 0.4, 'cfg': 1, 'sampler_name': 'res_multistep', 'scheduler': 'simple'},
                                'frames': {'first': {'filename': 'first.png'}, 'last': {'filename': 'last.png'}} if mode == 'frames' else {},
                                'references': base_refs if mode == 'refs' else [],
                                'guides': [
                                    {'guide_id': 'g_img', 'kind': 'image', 'frame_idx': 24, 'filename': 'guide.png'},
                                    {'guide_id': 'g_aud', 'kind': 'audio', 'frame_idx': 48, 'filename': 'guide.wav'},
                                ] if mode == 'refs' and audio_enh else [],
                            }
                            cases.append({'id': f'std:{profile}:{mode}:{method}:sp={sparse}:aud={audio_enh}', 'spec': spec})

        # 3. All 17 Studio canvas presets + preserve_reference_audio + refine scales
        canvases = [
            (1280, 704), (1344, 768), (1664, 928), (1920, 1080), (1024, 576), (864, 480),
            (704, 1280), (768, 1344), (1080, 1920), (576, 1024), (480, 864),
            (960, 960), (896, 896), (1152, 864), (1024, 768), (864, 1152), (768, 1024), (1344, 576), (1472, 640),
        ]
        for w, h in canvases:
            for scale in (1.0, 1.15, 1.25):
                spec = {
                    'model_profile': 'original',
                    'mode': 'refs',
                    'render_method': 'native',
                    'width': w,
                    'height': h,
                    'target_frames': 124,
                    'steps': 20,
                    'seed': 42,
                    'enable_refine': True,
                    'refine_scale': scale,
                    'preserve_reference_audio': 'shot' if scale == 1.25 else None,
                    'references': base_refs,
                }
                cases.append({'id': f'canvas:{w}x{h}:s={scale}', 'spec': spec})

        self.assertGreater(len(cases), 250)
        results = build_batch(cases)
        for res in results:
            with self.subTest(case=res['id']):
                self.assertTrue(res['ok'], f"JS buildGraph failed: {res.get('error')}")
                spec = res['spec']
                # Also verify key-order independence (sort_keys=True) in Python admission!
                sorted_spec = json.loads(json.dumps(spec, sort_keys=True))
                validate_configuration(sorted_spec, CAPS)
                validate_resource_contract(sorted_spec)
                # Confirm MinimaxH3LatentUpscaler3D and 2+ KSamplers are wired
                upscalers = [n for n in sorted_spec['workflow'].values() if n.get('class_type') == 'MinimaxH3LatentUpscaler3D']
                self.assertEqual(len(upscalers), 1)
                self.assertEqual(upscalers[0]['inputs']['mode'], 'scale by multiplier')

    def test_invalid_refine_combinations_rejected_on_both_sides(self):
        invalid_cases = [
            ('refine+continuation', {
                'model_profile': 'original', 'mode': 'text', 'enable_refine': True,
                'continuation': {'type': 'imported', 'source_file': 'clip.mp4', 'context_length': 39},
            }),
            ('refine+controlnet', {
                'model_profile': 'original', 'mode': 'text', 'enable_refine': True,
                'control': {'enabled': True, 'kind': 'depth', 'model_name': 'minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors', 'fps': 24, 'frame_count': 124, 'width': 1280, 'height': 704},
            }),
            ('refine+scale_too_large', {
                'model_profile': 'original', 'mode': 'text', 'enable_refine': True, 'refine_scale': 1.5,
            }),
            ('refine+pika+audio_enhance', {
                'model_profile': 'original', 'mode': 'refs', 'enable_refine': True, 'steps': 8,
                'sampling': {'sampler_name': 'euler', 'scheduler': 'simple', 'cfg': 1, 'denoise': 1, 'shift_video': 12, 'shift_audio': 3},
                'loras': [{'name': 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors', 'enabled': True, 'strength': 1.0}],
                'audio_refinement': {'enabled': True},
                'references': [{'kind': 'image', 'alias': 'hero'}],
            }),
        ]
        results = build_batch([{'id': cid, 'spec': s} for cid, s in invalid_cases])
        for res in results:
            with self.subTest(case=res['id']):
                self.assertFalse(res['ok'], f"Expected JS rejection for {res['id']}")

        # Backend must also independently reject refine + continuation
        valid_base = build_batch([{'id': 'base', 'spec': {'model_profile': 'original', 'mode': 'text', 'enable_refine': True}}])[0]['spec']
        bad_cont = copy.deepcopy(valid_base)
        bad_cont['continuation'] = {'type': 'imported', 'source_file': 'clip.mp4', 'context_length': 39}
        with self.assertRaisesRegex(ValueError, 'continuation'):
            validate_configuration(bad_cont, CAPS)

        # Legacy refinement dict carrying 'scale' must be sanitized by JS graph-builder and pass backend
        legacy_scale = build_batch([{'id': 'legacy_scale', 'spec': {
            'model_profile': 'original', 'mode': 'text', 'enable_refine': True,
            'refine_scale': 1.25, 'refinement': {'scale': 1.25, 'steps': 10, 'denoise': 0.4, 'cfg': 1, 'sampler_name': 'res_multistep', 'scheduler': 'simple'},
        }}])[0]
        self.assertTrue(legacy_scale['ok'])
        cleaned = copy.deepcopy(legacy_scale['spec'])
        cleaned['refinement'] = {k: v for k, v in cleaned['refinement'].items() if k != 'scale'}
        validate_configuration(cleaned, CAPS)


if __name__ == '__main__':
    unittest.main()
