const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../../web/h3/configuration');const {buildGraph}=require('../../web/h3/graph-builder');
const caps={sampling_options:{samplers:['euler','res_multistep'],schedulers:['simple'],weight_dtypes:['default']}};
for(const [name,p] of Object.entries(C.PIKA))test('Pika graph '+name,()=>{
 const spec={mode:p.family==='ref2va'?'refs':'text',model_profile:'original',steps:p.steps,render_method:'native',loras:[{name,enabled:true,strength:1}],sampling:{sampler_name:'euler',scheduler:'simple',cfg:1,denoise:1,shift_video:p.family==='ref2va'?12:6,shift_audio:3},references:[{kind:'image',alias:'hero'}]};
 const graph=buildGraph(spec,{hero:'hero.png'},caps);assert.equal(graph['8'].inputs.steps,p.steps);assert.equal(graph['2'].inputs.shift_video,spec.sampling.shift_video);assert.equal(graph['50'].inputs.lora_name,name);
 for(const patch of [{steps:20},{mode:spec.mode==='refs'?'text':'refs'},{enable_refine:true},{render_method:'spectrum'},{loras:[...spec.loras,{name:'style.safetensors',enabled:true}]}])assert.throws(()=>buildGraph({...spec,...patch},{hero:'hero.png'},caps),/Pika Flex/);
 assert.throws(()=>buildGraph({...spec,sampling:{...spec.sampling,shift_video:9}},{hero:'hero.png'},caps),/Pika Flex/);
});

test('leaving Pika restores sampling and valid standard steps',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('web/studio.js','utf8');
 const fields={steps:{value:'4'}},ctx={state:{sampling:{shift_video:6},pikaBefore:{sampling:{shift_video:9},steps:24}},H3Configuration:C,$:id=>fields[id],window:{},refreshes:0};
 ctx.window.H3ConfigurationUI={refresh(){ctx.refreshes++;}};ctx.H3ConfigurationUI=ctx.window.H3ConfigurationUI;vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function restorePikaSampling()'),source.indexOf('function selectedPika()')),ctx);
 ctx.restorePikaSampling();assert.equal(fields.steps.value,'24');assert.equal(ctx.state.sampling.shift_video,9);assert.equal(ctx.refreshes,1);
 ctx.state.pikaBefore={sampling:{sampler_name:'h3_turbo'},steps:6};ctx.restorePikaSampling();assert.equal(ctx.state.sampling.sampler_name,undefined);
 fields.steps.value='4';ctx.restorePikaSampling();assert.equal(fields.steps.value,'20');assert.equal(ctx.state.sampling.shift_video,12);
});

test('Anime and Pika stay selected together with Pika first on both Ref2VA profiles',()=>{
 const pika='pika_h3_flex_turbo_8step_hd_ref2va.safetensors',anime=C.ANIME_TO_REALISM;
 const supported={...caps,model_catalog:[{name:C.SINGULARITY_V2,profiles:['singularity']}]};
 for(const profile of ['original','singularity'])for(const action of ['pika','lora']){
  const spec=C.normalizeSelection({mode:'refs',model_profile:profile,
   checkpoint:profile==='singularity'?C.SINGULARITY_V2:C.REF,
   loras:[{name:anime,enabled:true,strength:.7},{name:pika,enabled:true,strength:1}],
   references:[{kind:'video',alias:'source',fps:24,frame_count:124}]},action,supported);
  assert.ok(spec.loras.every(l=>l.enabled));
  spec.loras=C.activeLorasInModelOrder(spec.loras);
  const graph=buildGraph(spec,{source:'source.mp4'},supported);
  assert.deepEqual(graph['50'].inputs,{model:['1',0],lora_name:pika,strength_model:1});
  assert.deepEqual(graph['51'].inputs,{model:['50',0],lora_name:anime,strength_model:.7});
  assert.deepEqual(graph['2'].inputs.model,['51',0]);
  assert.equal(graph['8'].inputs.steps,8);
 }
});

test('Combat V2 stacks with Pika across Text, Frames and References in any order',()=>{
 const combat=C.COMBAT_V2;
 const supported={...caps,model_catalog:[{name:C.SINGULARITY_V2,profiles:['singularity']}]};
 const cases=[
  {mode:'text',profile:'original',pika:'pika_h3_flex_turbo_8step_hd_fl2va.safetensors',extra:{},assets:{}},
  {mode:'frames',profile:'original',pika:'pika_h3_flex_turbo_4step_fl2va.safetensors',extra:{first:{asset_id:'f1'}},assets:{first:'first.png'}},
  {mode:'refs',profile:'original',pika:'pika_h3_flex_turbo_8step_hd_ref2va.safetensors',extra:{references:[{kind:'image',alias:'hero'}]},assets:{hero:'hero.png'}},
  {mode:'refs',profile:'singularity',pika:'pika_h3_flex_turbo_4step_ref2va_lite_r32.safetensors',extra:{checkpoint:C.SINGULARITY_V2,references:[{kind:'image',alias:'hero'}]},assets:{hero:'hero.png'}},
  {mode:'refs',profile:'original',pika:'pika_h3_flex_turbo_2step_draft_ref2va.safetensors',extra:{references:[{kind:'image',alias:'hero'}]},assets:{hero:'hero.png'}},
 ];
 for(const tc of cases)for(const action of ['pika','lora']){
  const spec=C.normalizeSelection({mode:tc.mode,model_profile:tc.profile,
   loras:[{name:combat,enabled:true,strength:0.85},{name:tc.pika,enabled:true,strength:1}],
   ...tc.extra},action,supported);
  assert.ok(spec.loras.every(l=>l.enabled),`${tc.mode}/${tc.profile}/${action} keeps both Pika and Combat V2 enabled`);
  spec.loras=C.activeLorasInModelOrder(spec.loras);
  const graph=buildGraph(spec,tc.assets,supported);
  assert.deepEqual(graph['50'].inputs,{model:['1',0],lora_name:tc.pika,strength_model:1});
  assert.deepEqual(graph['51'].inputs,{model:['50',0],lora_name:combat,strength_model:0.85});
  assert.deepEqual(graph['2'].inputs.model,['51',0]);
  assert.equal(graph['8'].inputs.steps,C.pikaVariant(tc.pika).steps);
 }
});
