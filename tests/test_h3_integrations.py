import copy
import json
import subprocess
import unittest
from h3_lab.configuration import PIKA, SPATIAL_PHYSICS, VBVR, validate_configuration

PIKA_8STEP = 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors'
SINGULARITY_V2 = 'Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors'

class H3IntegrationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.capabilities = {
            'sampling_options': {'samplers': ['euler'], 'schedulers': ['simple'], 'weight_dtypes': ['default']},
            'model_catalog': [{'name': SINGULARITY_V2, 'profiles': ['singularity']}],
            'facerefine_ready': True,
            'facerefine_detectors': ['face_yolov8m.pt'],
            'clip_vision_models': ['sigclip_vision_patch14_384.safetensors'],
            'spatial_physics_ready': True,
            'vbvr_ready': True,
            'dial_files': [],
            'dials_ready': True,
            'refine_ready': True,
            'continuation_ready': True,
            'native_nodes': {
                'UNETLoader': True, 'MiniMaxH3SigmaShift': True, 'CLIPLoader': True, 'VAELoader': True,
                'MiniMaxH3ImageToVideo': True, 'MiniMaxH3ReferenceToVideo': True, 'ConditioningZeroOut': True,
                'KSampler': True, 'VAEDecode': True, 'VAEDecodeAudio': True, 'CreateVideo': True,
                'H3SaveVideo': True, 'H3ReleaseForDecode': True, 'H3LoadSavedLatent': True
            }
        }

    def build_spec(self, loras, facerefine=None):
        sampling = {
            'sampler_name': 'euler',
            'scheduler': 'simple',
            'cfg': 1,
            'denoise': 1,
            'shift_video': 12,
            'shift_audio': 3,
            'weight_dtype': 'default'
        }
        spec = {
            'model_profile': 'singularity',
            'checkpoint': SINGULARITY_V2,
            'mode': 'refs',
            'render_method': 'native',
            'steps': 8,
            'sampling': sampling,
            'loras': loras,
            'references': [{'kind': 'image', 'alias': 'hero'}]
        }
        if facerefine:
            spec['facerefine'] = facerefine

        script = (
            'const s=JSON.parse(process.argv[1]);'
            'const caps=JSON.parse(process.argv[2]);'
            's.workflow=require("./web/h3/graph-builder").buildGraph(s,{hero:"hero.png"},caps);'
            'console.log(JSON.stringify(s));'
        )
        out = subprocess.check_output(['node', '-e', script, json.dumps(spec), json.dumps(self.capabilities)], text=True)
        return json.loads(out)

    def test_01_baseline_singularity_v2_pika_turbo(self):
        """Verify the baseline pipeline: Singularity V2 + Pika Flex Turbo (8-step Ref2VA) works unchanged."""
        loras = [{'name': PIKA_8STEP, 'enabled': True, 'strength': 1.0}]
        spec = self.build_spec(loras)
        self.assertIn('workflow', spec)
        validate_configuration(spec, self.capabilities)

    def test_02_spatial_physics_stacking(self):
        """Verify Singularity V2 + Pika Flex Turbo + Spatial Physics LoRA (0.3)."""
        loras = [
            {'name': PIKA_8STEP, 'enabled': True, 'strength': 1.0},
            {'name': SPATIAL_PHYSICS, 'enabled': True, 'strength': 0.3}
        ]
        spec = self.build_spec(loras)
        self.assertIn('workflow', spec)
        validate_configuration(spec, self.capabilities)

        lora_nodes = [n for n in spec['workflow'].values() if n.get('class_type') == 'LoraLoaderModelOnly']
        self.assertEqual(len(lora_nodes), 2)
        names = [n['inputs']['lora_name'] for n in lora_nodes]
        self.assertIn(PIKA_8STEP, names)
        self.assertIn(SPATIAL_PHYSICS, names)

    def test_03_vbvr_stacking(self):
        """Verify Singularity V2 + Pika Flex Turbo + VBVR LoRA (0.5)."""
        loras = [
            {'name': PIKA_8STEP, 'enabled': True, 'strength': 1.0},
            {'name': VBVR, 'enabled': True, 'strength': 0.5}
        ]
        spec = self.build_spec(loras)
        self.assertIn('workflow', spec)
        validate_configuration(spec, self.capabilities)

        lora_nodes = [n for n in spec['workflow'].values() if n.get('class_type') == 'LoraLoaderModelOnly']
        self.assertEqual(len(lora_nodes), 2)
        names = [n['inputs']['lora_name'] for n in lora_nodes]
        self.assertIn(PIKA_8STEP, names)
        self.assertIn(VBVR, names)

    def test_04_multi_lora_all_stacked(self):
        """Verify Singularity V2 + Pika Turbo + Spatial Physics + VBVR all stacked cleanly."""
        loras = [
            {'name': PIKA_8STEP, 'enabled': True, 'strength': 1.0},
            {'name': SPATIAL_PHYSICS, 'enabled': True, 'strength': 0.3},
            {'name': VBVR, 'enabled': True, 'strength': 0.5}
        ]
        spec = self.build_spec(loras)
        self.assertIn('workflow', spec)
        validate_configuration(spec, self.capabilities)

        lora_nodes = [n for n in spec['workflow'].values() if n.get('class_type') == 'LoraLoaderModelOnly']
        self.assertEqual(len(lora_nodes), 3)

    def test_05_facerefine_graph_construction(self):
        """Verify H3 FaceRefine graph topology and node linkages."""
        loras = [{'name': PIKA_8STEP, 'enabled': True, 'strength': 1.0}]
        facerefine = {
            'enabled': True,
            'crop_factor': 2.5,
            'denoise': 0.4,
            'feather': 6,
            'detector': 'face_yolov8m.pt',
            'clip_vision': 'sigclip_vision_patch14_384.safetensors'
        }
        spec = self.build_spec(loras, facerefine=facerefine)
        graph = spec['workflow']

        classes = [n.get('class_type') for n in graph.values()]
        for req in ('H3FaceTrackCrop', 'H3FaceStitch', 'MiniMaxH3NativeAudioLock', 'H3InjectVideoLatent', 'H3PerFrameDenoise'):
            self.assertIn(req, classes, f'Missing required node: {req}')

        stitch_key = next(k for k, n in graph.items() if n.get('class_type') == 'H3FaceStitch')
        self.assertEqual(graph['11']['inputs']['images'], [stitch_key, 0])

        validate_configuration(spec, self.capabilities)

if __name__ == '__main__':
    unittest.main()
