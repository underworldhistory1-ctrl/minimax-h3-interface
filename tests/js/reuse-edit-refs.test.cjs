const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const compiler = require('../../web/h3/prompt-compiler.js');

const studioSrc = fs.readFileSync('web/studio.js', 'utf8');
const workspaceSrc = fs.readFileSync('web/h3/project-workspace.js', 'utf8');
const labSrc = fs.readFileSync('web/lab-ui.js', 'utf8');

function makeContext(assets = [], promptText = '') {
  const input = {
    value: promptText,
    selectionStart: promptText.length,
    selectionEnd: promptText.length,
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
    },
    focus() {},
  };
  const elements = {
    prompt: input,
    promptMode: { value: 'guided' },
    frameFit: { value: 'crop' },
    fitImages: { checked: true },
    fitFrames: { checked: true },
    duration: { value: '124' },
    durationSeconds: { value: '5.167' },
    steps: { value: '20' },
    seed: { value: '42' },
    refSize: { value: 'max' },
    enableRefine: { checked: false },
    preparationMode: { value: 'auto' },
    renderMethod: { value: 'native' },
    mentionMenu: { classList: { add() {} } },
    confirmEditedSetup: { hidden: true },
  };
  const state = {
    mode: 'refs',
    prompts: { text: '', frames: '', refs: promptText },
    currentProject: { project_id: 'p1', assets, asset_categories: [{ id: 'custom', name: 'Custom' }] },
    activeProjectId: 'p1',
    refs: [],
    guides: [],
    loras: [],
    dismissedCatalogAssets: new Set(),
    busy: false,
    projectLoading: false,
    hydrationEpoch: 0,
    width: 1344,
    height: 768,
  };
  const revoked = [];
  const ctx = {
    state,
    URL: {
      createObjectURL: () => 'blob:mock-' + Math.random().toString(36).slice(2),
      revokeObjectURL: u => revoked.push(u),
    },
    Blob: globalThis.Blob,
    File: globalThis.File,
    crypto: globalThis.crypto,
    H3StudioUX: { revealControl() {} },
    H3ReuseNavigation: require('../../web/h3/reuse-navigation.js'),
    H3ReferenceControls: { cleanup() {} },
    H3PromptCompiler: compiler,
    H3ConfigurationUI: null,
    H3ConnectedStudio: null,
    H3Scenes: { draft: () => ({}), ownership: () => ({}) },
    H3TabDraftStore: { save: async () => {}, load: async () => null },
    $: id => elements[id] || { value: '', checked: false, classList: { add() {}, remove() {} } },
    document: { querySelectorAll: () => [], createElement: () => ({}) },
    window: {},
    restoredPreparationMode: v => ['auto', 'ai', 'native'].includes(v) ? v : 'auto',
    location: { href: 'https://studio.test/index.html', origin: 'https://studio.test' },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout,
    info() {},
    renderRefs() {},
    renderGuides() {},
    renderEstimates() {},
    renderPromptAssets() {},
    renderContinuation() {},
    renderFrameItem: async () => {},
    updatePreviewLive() {},
    saveDraft() {},
    currentRenderSpec: () => ({ references: state.refs.map(r => ({ ...r, ...ctx.referenceDisplay(r) })) }),
    selectMode(m) { state.mode = m; },
    method: () => 'native',
    selectedCheckpoint: () => 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    modelRef: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    repairSavedSeed() {},
    syncDuration() {},
    aspectPresets: { '16:9': [[1344, 768]] },
    maxRefs: { image: 9, video: 3, audio: 3 },
    api: p => p,
    revoked,
  };
  vm.createContext(ctx);
  vm.runInContext(
    workspaceSrc.replace(/initWorkspaceNavigation\(\);\s*initProjectWorkspace\(\);\s*H3OrganizationUI\.init\(\);\s*$/, ''),
    ctx
  );
  vm.runInContext(studioSrc.slice(studioSrc.indexOf('function removeShotReference(ref)'), studioSrc.indexOf('function renderRefs()')), ctx);
  vm.runInContext(studioSrc.slice(studioSrc.indexOf('function referenceDisplay(ref)'), studioSrc.indexOf('function mentionItems()')), ctx);
  vm.runInContext(studioSrc.slice(studioSrc.indexOf('function preferredReferenceMention(alias)'), studioSrc.indexOf('function insertReferenceMention(alias,scroll)')), ctx);
  vm.runInContext(labSrc.slice(labSrc.indexOf('function allInputItems('), labSrc.indexOf('function refreshLabControls(')), ctx);
  vm.runInContext(labSrc.slice(labSrc.indexOf('function captureProjectDraft('), labSrc.indexOf('async function refreshProjectList(')), ctx);
  ctx.renderProjectCatalog = () => {};
  ctx.projectCtrl = {
    currentProject: state.currentProject,
    apiUrl: p => p,
    getAsset: async id => assets.find(a => a.asset_id === id),
    mediaBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
  };
  return { ctx, state, elements, revoked };
}

test('removing a reused audio adds assetId to dismissedCatalogAssets and sync never resurrects it', async () => {
  const assets = [
    { asset_id: 'voice_old', alias: 'voice', name: 'Leader Voice', kind: 'audio' },
    { asset_id: 'hero_img', alias: 'hero', name: 'Hero', kind: 'image' },
  ];
  const { ctx, state } = makeContext(assets, '@hero speaks with @voice clearly.');
  const reusedVoice = { assetId: 'voice_old', alias: 'voice', kind: 'audio', url: 'blob:v1' };
  const keptHero = { assetId: 'hero_img', alias: 'hero', kind: 'image', url: 'blob:h1' };
  state.refs = [keptHero, reusedVoice];

  assert.equal(ctx.removeShotReference(reusedVoice), true);
  assert.equal(state.dismissedCatalogAssets.has('voice_old'), true);
  assert.deepEqual(state.refs.map(r => r.alias), ['hero']);

  // Calling syncPromptMentionsToReferences (e.g. on blur or before generate) must NOT bring voice_old back
  await ctx.syncPromptMentionsToReferences();
  assert.deepEqual(state.refs.map(r => r.alias), ['hero']);
  assert.equal(state.refs.some(r => r.assetId === 'voice_old'), false);
});

test('explicitly inserting dismissed catalog asset re-attaches it and deduplicates alias against new replacement', async () => {
  const assets = [
    { asset_id: 'voice_old', alias: 'voice', name: 'voice', kind: 'audio' },
  ];
  const { ctx, state } = makeContext(assets, 'New scene: ');
  const oldVoice = { assetId: 'voice_old', alias: 'voice', kind: 'audio' };
  state.refs = [oldVoice];
  ctx.removeShotReference(oldVoice);
  assert.equal(state.dismissedCatalogAssets.has('voice_old'), true);

  // User adds a brand-new local audio named @voice
  state.refs.push({ assetId: null, alias: 'voice', kind: 'audio', label: 'new_voice.wav' });

  // User explicitly clicks "Use" on the old catalog element -> should un-dismiss and auto-suffix to voice_2 cleanly
  await ctx.insertProjectMention({ assetId: 'voice_old', alias: 'voice', kind: 'audio', catalog: true });
  assert.equal(state.dismissedCatalogAssets.has('voice_old'), false);
  assert.deepEqual(state.refs.map(r => r.alias), ['voice', 'voice_2']);
});

test('dismissed reused audio releases its mention name so newly uploaded audio can rename to it', () => {
  const assets = [{ asset_id: 'voice_old', alias: 'voice', name: 'voice', kind: 'audio' }];
  const { ctx, state } = makeContext(assets, '@voice speaks');
  const oldVoice = { assetId: 'voice_old', alias: 'voice', kind: 'audio' };
  const newAudio = { assetId: null, alias: 'upload', kind: 'audio' };
  state.refs = [oldVoice, newAudio];
  ctx.removeShotReference(oldVoice);

  const name = { value: 'voice' };
  ctx.ref = newAudio;
  ctx.name = name;
  ctx.locked = false;
  const start = studioSrc.indexOf('name.onchange=()=>{');
  vm.runInContext(studioSrc.slice(start, studioSrc.indexOf('nameWrap.append', start)), ctx);
  name.onchange();
  assert.equal(newAudio.alias, 'voice');
  assert.equal(ctx.preferredReferenceMention('voice'), 'voice');
});

test('stale double-remove does NOT splice(-1) and delete the remaining replacement audio', () => {
  const assets = [{ asset_id: 'voice_old', alias: 'voice', name: 'voice', kind: 'audio' }];
  const { ctx, state } = makeContext(assets, '');
  const oldVoice = { assetId: 'voice_old', alias: 'voice', kind: 'audio' };
  const newAudio = { assetId: null, alias: 'voice_new', kind: 'audio' };
  state.refs = [oldVoice, newAudio];

  assert.equal(ctx.removeShotReference(oldVoice), true);
  // Stale callback firing a second time for oldVoice must be a no-op!
  assert.equal(ctx.removeShotReference(oldVoice), false);
  assert.deepEqual(state.refs.map(r => r.alias), ['voice_new']);
});

test('captureProjectDraft and hydrateProjectDraft preserve dismissedCatalogAssets across reloads', async () => {
  const assets = [{ asset_id: 'voice_old', alias: 'voice', name: 'voice', kind: 'audio' }];
  const { ctx, state } = makeContext(assets, '@hero talks');
  state.refs = [{ assetId: 'voice_old', alias: 'voice', kind: 'audio' }];
  ctx.removeShotReference(state.refs[0]);

  const saved = ctx.captureProjectDraft(false);
  assert.deepEqual([...saved.dismissedCatalogAssets], ['voice_old']);

  // Simulate reload on a fresh state
  state.dismissedCatalogAssets = new Set();
  await ctx.hydrateProjectDraft(saved);
  assert.equal(state.dismissedCatalogAssets.size, 1);
  assert.equal(state.dismissedCatalogAssets.has('voice_old'), true);
});
