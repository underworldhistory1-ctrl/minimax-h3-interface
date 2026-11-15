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
