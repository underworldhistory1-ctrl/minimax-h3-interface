const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const C = require('../../web/h3/configuration');
const B = require('../../web/h3/graph-builder');
const P = require('../../web/h3/prompt-compiler');

function loadStudioKeyframeHelpers(initialState = {}, durationFrames = 124) {
  const source = fs.readFileSync('web/studio.js', 'utf8');
  const start = source.indexOf('function maxKeyframeFrames()');
  const end = source.indexOf('function currentRenderSpec()');
  assert.ok(start > 0 && end > start, 'Could not locate inline keyframe helpers in web/studio.js');
  const dom = { duration: { value: String(durationFrames) } };
  const ctx = {
    state: { refs: [], guides: [], continuation: null, ...initialState },
    $: id => dom[id] || null,
    Number, Math, Array, Object, Boolean, String, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, dom };
}

const CAPS = {
  add_guide: true,
  guide_audio: true,
  guide_video: true,
  refine_ready: true,
  sparse_attention_ready: true,
  audio_refine_ready: true,
  continuation_ready: true,
  dials_ready: true,
  dial_files: ['dials/h3_motion.safetensors'],
  model_catalog: [{ name: C.SINGULARITY_V2, profiles: ['singularity'], loader: 'UNETLoader' }],
  sampling_options: { samplers: ['res_multistep', 'euler'], schedulers: ['simple'], weight_dtypes: ['default'] },
};

test('partitionReferences keeps semantic refs clean, routes inline keyframes to guides, and promotes anchor when keyframe-only', () => {
  const { ctx } = loadStudioKeyframeHelpers();
  // Normal refs only -> zero keyframes
  const normal = [
    { alias: 'hero', kind: 'image', role: 'character identity' },
    { alias: 'voice1', kind: 'audio', role: 'voice' },
  ];
  const p0 = ctx.partitionReferences(normal);
  assert.equal(p0.semanticRefs.length, 2);
  assert.equal(p0.inlineKeyframes.length, 0);
  assert.equal(p0.promotedAnchor, null);

  // Mixed semantic + inline keyframes -> keyframes excluded from semanticRefs (zero wasted slots!)
  const mixed = [
    { alias: 'hero', kind: 'image', role: 'character identity' },
    { alias: 'kf_start', kind: 'image', role: 'keyframe', keyframeTime: 0 },
    { alias: 'kf_end', kind: 'image', role: 'keyframe', keyframeTime: 5.0 },
    { alias: 'sfx_hit', kind: 'audio', role: 'keyframe', keyframeTime: 2.5 },
  ];
  const p1 = ctx.partitionReferences(mixed);
  assert.deepEqual([...p1.semanticRefs.map(r => r.alias)], ['hero']);
  assert.deepEqual([...p1.inlineKeyframes.map(r => r.alias)], ['kf_start', 'kf_end', 'sfx_hit']);
  assert.equal(p1.promotedAnchor, null);

  // Keyframe-only -> first image promoted as anchor so MiniMaxH3ReferenceToVideo stays valid
  const kfOnly = [
    { alias: 'kf_a', kind: 'image', role: 'keyframe', keyframeTime: 0 },
    { alias: 'kf_b', kind: 'image', role: 'keyframe', keyframeTime: 4.5 },
  ];
  const p2 = ctx.partitionReferences(kfOnly);
  assert.equal(p2.promotedAnchor.alias, 'kf_a');
  assert.deepEqual([...p2.semanticRefs.map(r => r.alias)], ['kf_a']);
  assert.deepEqual([...p2.inlineKeyframes.map(r => r.alias)], ['kf_a', 'kf_b']);
});

test('keyframeReadoutText enforces bounds, Extend +39f offset, and audio/video clip overflow', () => {
  const { ctx } = loadStudioKeyframeHelpers({ continuation: null }, 124);
  assert.equal(ctx.keyframeReadoutText({ kind: 'image', keyframeTime: 0 }).bad, false);
  assert.equal(ctx.keyframeReadoutText({ kind: 'image', keyframeTime: 0 }).frameIdx, 0);
  assert.equal(ctx.keyframeReadoutText({ kind: 'image', keyframeTime: 5.12 }).bad, false); // 123 < 124
  assert.equal(ctx.keyframeReadoutText({ kind: 'image', keyframeTime: 5.2 }).bad, true); // 125 >= 124
  assert.equal(ctx.keyframeReadoutText({ kind: 'image', keyframeTime: -0.5 }).bad, true);
  assert.equal(ctx.keyframeReadoutText({ kind: 'audio', keyframeTime: 4.0, localDuration: 2.0 }).bad, true);
  assert.equal(ctx.keyframeReadoutText({ kind: 'audio', keyframeTime: 2.0, localDuration: 2.0 }).bad, false);

  // With continuation (124 total - 39 context = 85 new frames)
  const { ctx: extCtx } = loadStudioKeyframeHelpers({ continuation: { type: 'imported', context_length: 39 } }, 124);
  const okExt = extCtx.keyframeReadoutText({ kind: 'image', keyframeTime: 2.0 });
  assert.equal(okExt.bad, false);
  assert.equal(okExt.frameIdx, 48);
  assert.match(okExt.text, /#87 total/);
  assert.equal(extCtx.keyframeReadoutText({ kind: 'image', keyframeTime: 4.0 }).bad, true); // 96 >= 85
});

test('combinatorial simulation: 2,500+ inline keyframe workflows across models, Pika, Refine, Sol-Attn, Extend, LoRAs, and durations', () => {
  const durations = [56, 124, 175, 243, 362]; // H3 5 + 17k grid
  const canvases = [[864, 480], [1280, 704], [1664, 928], [1920, 1080], [1080, 1920]];
  const setups = [
    { name: 'orig_native', profile: 'original', method: 'native', steps: 20, loras: [], sampling: {} },
    { name: 'orig_spectrum', profile: 'original', method: 'spectrum', steps: 20, loras: [], sampling: {} },
    { name: 'orig_motioncache', profile: 'original', method: 'motioncache', steps: 20, loras: [{ name: 'Motion_Repair_V2.safetensors', enabled: true, strength: 0.9 }], sampling: {} },
    { name: 'orig_pika8', profile: 'original', method: 'native', steps: 8, loras: [{ name: 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors', enabled: true, strength: 1 }], sampling: C.pikaSampling(C.pikaVariant('pika_h3_flex_turbo_8step_hd_ref2va.safetensors')) },
    { name: 'orig_pika4_combat', profile: 'original', method: 'native', steps: 4, loras: [{ name: 'pika_h3_flex_turbo_4step_ref2va.safetensors', enabled: true, strength: 1 }, { name: C.COMBAT_V2, enabled: true, strength: 0.8 }], sampling: C.pikaSampling(C.pikaVariant('pika_h3_flex_turbo_4step_ref2va.safetensors')) },
    { name: 'sing_pika8_phys', profile: 'singularity', checkpoint: C.SINGULARITY_V2, method: 'native', steps: 8, loras: [{ name: 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors', enabled: true, strength: 1 }, { name: C.SPATIAL_PHYSICS, enabled: true, strength: 0.3 }], sampling: C.pikaSampling(C.pikaVariant('pika_h3_flex_turbo_8step_hd_ref2va.safetensors')) },
  ];
  const refPatterns = [
    'mixed_img_kf_start_end',
    'mixed_img_kf_plus_timed_audio',
    'mixed_img_kf_plus_timed_video',
    'kf_only_anchor',
    'mixed_plus_manual_guide',
  ];

  let simulated = 0;
  for (const dur of durations) {
    for (const [w, h] of canvases) {
      for (const setup of setups) {
        for (const pattern of refPatterns) {
          for (const sparse of [false, true]) {
            for (const extra of ['plain', 'refine', 'extend']) {
              // Skip invalid combinations that are guarded by policy
              if (extra === 'extend' && dur <= 39) continue;

              const continuation = extra === 'extend'
                ? { type: 'imported', source_file: 'prev.mp4', source_canvas: { width: 1280, height: 704 }, context_length: 39, audio_feather_ticks: 8 }
                : null;
              const enableRefine = extra === 'refine';
              const { ctx } = loadStudioKeyframeHelpers({ continuation }, dur);
              const maxF = ctx.maxKeyframeFrames();
              const midSec = Math.floor(((maxF - 1) / 2 / 24) * 100) / 100;
              const endSec = Math.floor(((maxF - 1) / 24) * 100) / 100;

              let rawRefs = [];
              let manualGuides = [];
              let userPrompt = '@hero stands in dramatic rain lighting.';
              if (pattern === 'mixed_img_kf_start_end') {
                rawRefs = [
                  { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
                  { alias: 'kf0', kind: 'image', role: 'keyframe', keyframeTime: 0, file: { name: 'kf0.png' } },
                  { alias: 'kfEnd', kind: 'image', role: 'keyframe', keyframeTime: endSec, file: { name: 'kfEnd.png' } },
                ];
              } else if (pattern === 'mixed_img_kf_plus_timed_audio') {
                rawRefs = [
                  { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
                  { alias: 'kfMid', kind: 'image', role: 'keyframe', keyframeTime: midSec, file: { name: 'kfMid.png' } },
                  { alias: 'boom', kind: 'audio', role: 'keyframe', keyframeTime: 0.1, localDuration: 0.4, file: { name: 'boom.wav' } },
                ];
              } else if (pattern === 'mixed_img_kf_plus_timed_video') {
                rawRefs = [
                  { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
                  { alias: 'clipKf', kind: 'video', role: 'keyframe', keyframeTime: 0, useAudio: true, meta: { fps: 24, frame_count: 5, duration: 5 / 24 }, file: { name: 'clip.mp4' } },
                ];
              } else if (pattern === 'kf_only_anchor') {
                userPrompt = 'A cinematic camera push into the neon alley.';
                rawRefs = [
                  { alias: 'shotStart', kind: 'image', role: 'keyframe', keyframeTime: 0, file: { name: 'start.png' } },
                  { alias: 'shotEnd', kind: 'image', role: 'keyframe', keyframeTime: endSec, file: { name: 'end.png' } },
                ];
              } else if (pattern === 'mixed_plus_manual_guide') {
                rawRefs = [
                  { alias: 'hero', kind: 'image', role: 'character identity', file: { name: 'hero.png' } },
                  { alias: 'kfMid', kind: 'image', role: 'keyframe', keyframeTime: midSec, file: { name: 'kfMid.png' } },
                ];
                manualGuides = [{ guide_id: 'manual_1', kind: 'image', frame_idx: 0, relative_to_new_content: !!continuation, filename: 'manual.png' }];
              }

              const { semanticRefs, inlineKeyframes, promotedAnchor } = ctx.partitionReferences(rawRefs);
              for (const kf of inlineKeyframes) {
                assert.equal(ctx.keyframeReadoutText(kf).bad, false, `Readout failed for ${pattern} dur=${dur} extra=${extra}`);
              }

              const specRefs = semanticRefs.map(r => ({
                asset_id: r.alias,
                alias: r.alias,
                kind: r.kind,
                role: r === promotedAnchor ? 'custom' : r.role,
                instruction: r === promotedAnchor ? 'Timed keyframe anchor.' : '',
                filename: r.file.name,
              }));
              const specGuides = [
                ...inlineKeyframes.map(r => ctx.inlineKeyframeGuideDescriptor(r)),
                ...manualGuides,
              ];

              const spec = {
                model_profile: setup.profile,
                checkpoint: setup.checkpoint || null,
                mode: 'refs',
                prompt_mode: 'guided',
                source_prompt: userPrompt,
                width: w,
                height: h,
                target_frames: dur,
                steps: setup.steps,
                seed: 42,
                render_method: setup.method,
                sampling: setup.sampling,
                loras: C.activeLorasInModelOrder(setup.loras),
                dials: sparse ? [{ name: 'dials/h3_motion.safetensors', strength: 0.4, enabled: true }] : [],
                sparse_attention: { enabled: sparse },
                enable_refine: enableRefine,
                refine_scale: 1.25,
                continuation,
                references: specRefs,
                guides: specGuides,
              };

              const compiled = P.compilePrompt(spec);
              spec.compiled_prompt = compiled.compiled_prompt;

              const resolvedAssets = { references: {}, guides: {} };
              for (const r of specRefs) resolvedAssets.references[r.alias] = r.filename;
              for (const g of specGuides) {
                resolvedAssets.guides[g.guide_id] = g.filename;
                if (g.alias) resolvedAssets.guides[g.alias] = g.filename;
              }

              const graph = B.buildGraph(spec, resolvedAssets, CAPS);
              const guideNodes = Object.values(graph).filter(n => n.class_type === 'MiniMaxH3AddGuide');
              assert.equal(guideNodes.length, specGuides.length);
              // Confirm every MiniMaxH3AddGuide frame_idx has Extend offset applied properly
              const ctxOffset = continuation ? 39 : 0;
              guideNodes.forEach((gn, idx) => {
                assert.equal(gn.inputs.frame_idx, specGuides[idx].frame_idx + ctxOffset);
              });
              // Confirm zero bleed: inline keyframes (unless promotedAnchor) are NOT in ref_images!
              const refImgInputs = Object.keys(graph['6'].inputs).filter(k => k.startsWith('ref_images.'));
              assert.equal(refImgInputs.length, specRefs.filter(r => r.kind === 'image').length);
              simulated++;
            }
          }
        }
      }
    }
  }
  assert.ok(simulated >= 2500, `Expected >= 2500 simulated inline-keyframe workflows, got ${simulated}`);
});
