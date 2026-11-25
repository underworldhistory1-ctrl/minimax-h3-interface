const test=require('node:test');
const assert=require('node:assert/strict');
const plan=require('../../web/h3/qwen-reference-plan.js');
test('all ten ordered references resolve with independent roles and instructions',()=>{
 const refs=Array.from({length:10},(_,i)=>({name:'ref'+i,role:i===0?'identity':'style',instructions:i===9?'Keep @ref0 face.':''}));
 const compiled=plan.compile('Combine @ref0 and @ref9.',refs,'combine');
 assert.match(compiled,/Combine <image1> and <image10>/);assert.match(compiled,/<image10>:.*Keep <image1> face/);
 assert.match(compiled,/do not copy subject identity/);
});
test('invalid and stale mentions, duplicate names and unknown roles fail',()=>{
 for(const prompt of ['@missing','<image0>','<image2>'])assert.throws(()=>plan.compile(prompt,[{name:'base'}]),/no attached/);
 assert.throws(()=>plan.compile('x',[{name:'A'},{name:'a'}]),/unique/);
 assert.throws(()=>plan.compile('x',[{name:'a',role:'fake'}]),/role/);
 assert.throws(()=>plan.compile('x',[],'fake'),/workflow/);
});
test('plain references preserve existing prompts and multilingual aliases',()=>{
 assert.equal(plan.compile('Keep @شخص.',[{name:'شخص',role:'context'}]),'Keep <image1>.');
 assert.equal(plan.compile('A blue vase',[]),'A blue vase');
});
test('project elements map categories and roles to Qwen roles and unique aliases',()=>{
 const cats=[
  {id:'characters',name:'Characters',role:'character identity'},
  {id:'locations',name:'Locations',role:'location'},
  {id:'props',name:'Props',role:'object'},
  {id:'styles',name:'Style',role:'visual style'},
  {id:'storyboards',name:'Storyboards',role:'storyboard'},
  {id:'custom',name:'Custom',role:'custom'},
  {id:'wardrobe_custom',name:'Wardrobe',role:'custom'},
 ];
 assert.equal(plan.roleFromElement({category:'characters',role:'character identity'},cats),'identity');
 assert.equal(plan.roleFromElement({category:'props',role:'object'},cats),'object');
 assert.equal(plan.roleFromElement({category:'locations',role:'location'},cats),'background');
 assert.equal(plan.roleFromElement({category:'styles',role:'visual style'},cats),'style');
 assert.equal(plan.roleFromElement({category:'storyboards',role:'storyboard'},cats),'composition');
 assert.equal(plan.roleFromElement({category:'custom',role:'custom'},cats),'custom');
 assert.equal(plan.roleFromElement({category:'props'},cats),'object');
 assert.equal(plan.roleFromElement({category:'unknown'},cats),'context');
 assert.equal(plan.elementAlias({name:'Hero Sword.png'},[]),'Hero_Sword');
 assert.equal(plan.elementAlias({name:'Hero Sword.png'},['hero_sword']),'Hero_Sword_2');
 assert.equal(plan.elementAlias({name:'سيف ذهبي.webp'},[]),'سيف_ذهبي');
});
