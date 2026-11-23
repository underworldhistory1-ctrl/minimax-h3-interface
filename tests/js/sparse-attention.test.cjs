const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../web/h3/configuration');
const { buildGraph } = require('../../web/h3/graph-builder');

const caps = {
  sparse_attention_ready: true,
  refine_ready: true,
  audio_refine_ready: true,
  turbo_ready: true,
  turbo_ref_ready: true,
  sampling_options: { samplers: ['res_multistep', 'euler', 'h3_turbo'], schedulers: ['simple'], weight_dtypes: ['default'] },
};

test('sparse attention is omitted by default', () => {
  const g = buildGraph({ mode: 'text', render_method: 'native' }, {}, caps);
  assert.ok(!Object.values(g).some(n => n.class_type === 'BlockSparseAttention'));
  assert.deepEqual(g['8'].inputs.model, ['2', 0]);
});

test('Pika 8-Step HD Ref2VA at 1920x1080 with Sol-Attn wires after MiniMaxH3SigmaShift', () => {
  const g = buildGraph({
    model_profile: 'original',
    mode: 'refs',
    width: 1920,
    height: 1080,
    steps: 8,
    render_method: 'native',
    loras: [{ name: 'pika_h3_flex_turbo_8step_hd_ref2va.safetensors', enabled: true, strength: 1 }],
    sampling: { sampler_name: 'euler', scheduler: 'simple', cfg: 1, denoise: 1, shift_video: 12, shift_audio: 3, weight_dtype: 'default' },
    references: [{ alias: 'hero', kind: 'image' }],
    sparse_attention: { enabled: true },
  }, { hero: 'hero.png' }, caps);

  const sparseNodes = Object.entries(g).filter(([, n]) => n.class_type === 'BlockSparseAttention');
  assert.equal(sparseNodes.length, 1);
  const [sparseId, sparseNode] = sparseNodes[0];
  assert.deepEqual(sparseNode.inputs, {
    model: ['2', 0],
    selection: 'sol-attn',
    'selection.tau': 1.3,
    start_percent: 0.2,
    end_percent: 1.0,
    dense_blocks: '',
    min_tokens: 12288,
    extra_tokens: 256,
    sink_conditioning: 'exact_kv_and_rows',
    verbose: false,
  });
  assert.deepEqual(g['8'].inputs.model, [sparseId, 0]);
});

test('Refine with Motion_Repair_V2 + spectrum + Sol-Attn wires both samplers cleanly', () => {
  const g = buildGraph({
    model_profile: 'original',
    mode: 'text',
    render_method: 'spectrum',
    enable_refine: true,
    loras: [{ name: 'Motion_Repair_V2.safetensors', enabled: true, strength: 1 }],
    sparse_attention: { enabled: true, tau: 1.5, start_percent: 0.15, end_percent: 0.95, extra_tokens: 128, sink_conditioning: 'exact_kv' },
  }, {}, caps);

  const sparseEntries = Object.entries(g).filter(([, n]) => n.class_type === 'BlockSparseAttention');
  assert.equal(sparseEntries.length, 2);
  const samplers = Object.values(g).filter(n => n.class_type === 'KSampler');
  assert.equal(samplers.length, 2);
  for (const sampler of samplers) {
    const sparseId = sampler.inputs.model[0];
    assert.equal(g[sparseId].class_type, 'BlockSparseAttention');
    const prevId = g[sparseId].inputs.model[0];
    assert.equal(g[prevId].class_type, 'SpectrumApplyMiniMaxH3');
  }
});

test('invalid sparse attention contracts and unavailable runtimes are rejected', () => {
  assert.throws(() => buildGraph({ sparse_attention: { enabled: true } }, {}, { ...caps, sparse_attention_ready: false }), /unavailable/);
  for (const bad of [
    { tau: -0.1 },
    { tau: 4.5 },
    { start_percent: -0.1 },
    { end_percent: 1.2 },
    { start_percent: 0.8, end_percent: 0.2 },
    { extra_tokens: 100 },
    { extra_tokens: 320 },
    { sink_conditioning: 'invalid_mode' },
  ]) {
    assert.throws(() => C.resolve({ mode: 'text', sparse_attention: { enabled: true, ...bad } }, caps));
  }
  assert.throws(() => C.resolve({
    mode: 'text',
    render_method: 'turbo',
    steps: 6,
    sparse_attention: { enabled: true },
  }, caps), /Turbo/);
  assert.equal(C.normalizeSelection({
    mode: 'text',
    render_method: 'turbo',
    sparse_attention: { enabled: true },
  }, 'method', caps).sparse_attention.enabled, false);
});
