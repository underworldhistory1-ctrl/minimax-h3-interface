"""End-to-end JS -> Python admission validation for Inline Keyframes (image, audio, video)
across Original H3, Singularity v2, Pika Flex Turbo, Refine, Sol-Attn, Extend, and Reuse.
"""
import json
import subprocess
import unittest
from pathlib import Path

from h3_lab.configuration import PIKA, validate_configuration
from h3_lab.jobs import validate_resource_contract

ROOT = Path(__file__).resolve().parents[1]
SINGULARITY_V2 = 'Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors'

CAPS = {
    'add_guide': True,
    'guide_audio': True,
    'guide_video': True,
    'refine_ready': True,
    'sparse_attention_ready': True,
    'audio_refine_ready': True,
    'continuation_ready': True,
    'dials_ready': True,
    'dial_files': ['dials/h3_motion.safetensors'],
    'model_catalog': [{'name': SINGULARITY_V2, 'profiles': ['singularity'], 'loader': 'UNETLoader'}],
    'sampling_options': {'samplers': ['res_multistep', 'euler'], 'schedulers': ['simple'], 'weight_dtypes': ['default']},
}


class InlineKeyframeBackendAdmissionTest(unittest.TestCase):
    def test_inline_keyframes_pass_python_admission_and_resource_contract(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const C = require('./web/h3/configuration');
const B = require('./web/h3/graph-builder');
const P = require('./web/h3/prompt-compiler');
const caps = JSON.parse(process.argv[1]);
const src = fs.readFileSync('./web/studio.js', 'utf8');
const helpers = src.slice(src.indexOf('function maxKeyframeFrames()'), src.indexOf('function currentRenderSpec()'));

function runCase(cfg) {
  const ctx = { state: { refs: cfg.rawRefs, guides: [], continuation: cfg.continuation || null }, $: id => id === 'duration' ? { value: String(cfg.dur) } : null, Number, Math, Array, Object, Boolean, String, Error };
  vm.createContext(ctx);
  vm.runInContext(helpers, ctx);
  const { semanticRefs, inlineKeyframes, promotedAnchor } = ctx.partitionReferences(cfg.rawRefs);
  const references = semanticRefs.map(r => ({
    asset_id: r.alias, alias: r.alias, kind: r.kind,
    role: r === promotedAnchor ? 'custom' : r.role,
    instruction: r === promotedAnchor ? 'Timed keyframe anchor.' : '',
    filename: r.file.name,
  }));
  const guides = inlineKeyframes.map(r => ctx.inlineKeyframeGuideDescriptor(r));
  const spec = {
    model_profile: cfg.profile || 'original',
    checkpoint: cfg.checkpoint || null,
    mode: 'refs',
    prompt_mode: 'guided',
    source_prompt: cfg.prompt,
    width: cfg.w,
    height: cfg.h,
    target_frames: cfg.dur,
    steps: cfg.steps || 20,
    seed: 42,
    render_method: cfg.method || 'native',
    sampling: cfg.sampling || {},
    loras: C.activeLorasInModelOrder(cfg.loras || []),
    sparse_attention: { enabled: !!cfg.sparse },
    enable_refine: !!cfg.refine,
    refine_scale: 1.25,
    audio_refinement: { enabled: !!cfg.audioEnh },
    continuation: cfg.continuation || null,
    references,
    guides,
  };
  spec.compiled_prompt = P.compilePrompt(spec).compiled_prompt;
  const resolved = { references: {}, guides: {} };
  for (const r of references) resolved.references[r.alias] = r.filename;
  for (const g of guides) { resolved.guides[g.guide_id] = g.filename; resolved.guides[g.alias] = g.filename; }
  spec.workflow = B.buildGraph(spec, resolved, caps);
  return spec;
}

const pika8 = 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors';
const pikaSampling = C.pikaSampling(C.pikaVariant(pika8));
const cases = [
  // 1. Character + start/end inline image keyframes + Pika 8-step + Refine + Sol-Attn + 1080p
  {
    name: 'pika8_refine_sol_1080p_start_end_kf',
    w: 1920, h: 1080, dur: 124, steps: 8, sampling: pikaSampling,
    loras: [{ name: pika8, enabled: true, strength: 1 }], sparse: true, refine: true,
    prompt: '@hero walks through misty ruins.',
    rawRefs: [
      { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
      { alias: 'kf_open', kind: 'image', role: 'keyframe', keyframeTime: 0, file: { name: 'open.png' } },
      { alias: 'kf_close', kind: 'image', role: 'keyframe', keyframeTime: 5.0, file: { name: 'close.png' } },
    ],
  },
  // 2. Keyframe-only (no semantic refs!) -> auto-promoted anchor + Refine + Audio Enhancement
  {
    name: 'kf_only_anchor_refine_audio_enh',
    w: 1280, h: 704, dur: 124, refine: true, audioEnh: true,
    prompt: 'Rain falls across empty neon streets.',
    rawRefs: [
      { alias: 'frameA', kind: 'image', role: 'keyframe', keyframeTime: 0, file: { name: 'a.png' } },
      { alias: 'frameB', kind: 'image', role: 'keyframe', keyframeTime: 3.5, file: { name: 'b.png' } },
    ],
  },
  // 3. Inline timed audio + inline timed video + character ref + Extend (+39f offset) + Pika 8-step
  {
    name: 'timed_audio_video_extend_pika8',
    w: 1280, h: 704, dur: 175, steps: 8, sampling: pikaSampling,
    loras: [{ name: pika8, enabled: true, strength: 1 }],
    continuation: { type: 'imported', source_file: 'prev.mp4', source_canvas: { width: 1280, height: 704 }, context_length: 39, audio_feather_ticks: 8 },
    prompt: '@hero turns sharply as thunder strikes.',
    rawRefs: [
      { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
      { alias: 'thunder', kind: 'audio', role: 'keyframe', keyframeTime: 1.5, localDuration: 1.0, file: { name: 'thunder.wav' } },
      { alias: 'burst', kind: 'video', role: 'keyframe', keyframeTime: 0.5, useAudio: true, meta: { fps: 24, frame_count: 5, duration: 5/24 }, file: { name: 'burst.mp4' } },
    ],
  },
  // 4. Singularity v2 + Pika 8-step + Refine + inline image keyframe
  {
    name: 'singularity_v2_pika8_refine_kf',
    profile: 'singularity', checkpoint: C.SINGULARITY_V2,
    w: 1344, h: 768, dur: 124, steps: 8, sampling: pikaSampling,
    loras: [{ name: pika8, enabled: true, strength: 1 }], refine: true,
    prompt: '@hero draws a glowing blade.',
    rawRefs: [
      { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
      { alias: 'pose', kind: 'image', role: 'keyframe', keyframeTime: 2.0, file: { name: 'pose.png' } },
    ],
  },
];

process.stdout.write(JSON.stringify(cases.map(c => ({ name: c.name, spec: runCase(c) }))));
"""
        raw = subprocess.check_output(['node', '-e', script, json.dumps(CAPS)], cwd=ROOT, text=True)
        for item in json.loads(raw):
            with self.subTest(case=item['name']):
                spec = item['spec']
                validate_configuration(spec, CAPS)
                validate_resource_contract(spec)
                guide_nodes = [n for n in spec['workflow'].values() if n.get('class_type') == 'MiniMaxH3AddGuide']
                self.assertGreaterEqual(len(guide_nodes), 1)


if __name__ == '__main__':
    unittest.main()
