(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QwenReferencePlan=api;
})(globalThis,function(){
  'use strict';
  const roles={
    context:'Visual context',identity:'Person / identity',object:'Product / object',
    background:'Background / location',style:'Style / lighting',composition:'Composition',
    pose:'Pose / expression',outfit:'Clothing / accessories',text:'Text / typography',
    mask:'Mask / annotated edit',custom:'Custom instructions'
  };
  const directions={
    identity:'Use the identity and distinguishing appearance of the subject.',
    object:'Use the product or object identity, shape and distinguishing details.',
    background:'Use the location and environment; do not copy unrelated subjects.',
    style:'Use the visual style, palette and lighting; do not copy subject identity.',
    composition:'Use the framing and spatial arrangement; retain the requested subjects.',
    pose:'Use the pose and expression; do not copy subject identity or clothing.',
    outfit:'Use the clothing and accessories; retain the requested subject identity.',
    text:'Use the specified lettering and typography; follow the requested wording.',
    mask:'Treat this as a mask or annotated guide for the requested local edit, not output artwork.'
  };
  const workflows={
    general:{label:'Free edit / create',instruction:''},
    combine:{label:'Combine references',instruction:'Combine the assigned contributions into one coherent image.'},
    replace:{label:'Replace subject / product',instruction:'Replace only the requested subject or product in image 1 using the assigned references. Preserve unrelated details.'},
    background:{label:'Replace background',instruction:'Replace the background of image 1 using the assigned environment reference. Preserve the foreground subject.'},
    style:{label:'Transfer style / relight',instruction:'Apply the assigned style or lighting to image 1 while preserving its subject identity and composition.'},
    local:{label:'Local edit / mask guide',instruction:'Apply only the requested local edit to image 1. Use any mask or annotation reference to identify the edit region; preserve the rest and omit guide markings.'},
    extract:{label:'Extract transparent subject',instruction:'Extract the requested subject from image 1. The output is an RGBA image with an alpha channel and a transparent background.'}
  };
  function compile(prompt,references=[],workflow='general'){
    if(!workflows[workflow])throw Error('Unknown Qwen workflow.');
    if(references.length>10)throw Error('Qwen Image supports up to 10 reference images.');
    const names=new Map();
    references.forEach((ref,index)=>{
      if(!/^[\p{L}\p{N}_-]+$/u.test(ref.name||'')||names.has(ref.name.toLowerCase()))throw Error('Use unique reference mention names.');
      if(!Object.hasOwn(roles,ref.role||'context'))throw Error('Unknown reference role.');
      names.set(ref.name.toLowerCase(),index+1);
    });
    function resolve(text){
      const result=String(text||'').replace(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu,(full,prefix,name)=>{
        const index=names.get(name.toLowerCase());if(!index)throw Error(`@${name} has no attached reference. Add it or remove the mention.`);
        return `${prefix}<image${index}>`;
      });
      for(const match of result.matchAll(/<image(\d+)>/gi))if(Number(match[1])<1||Number(match[1])>references.length)throw Error(`${match[0]} has no attached reference.`);
      return result;
    }
    const lines=references.flatMap((ref,index)=>{
      const direction=directions[ref.role||'context']||'',instruction=resolve(ref.instructions||'').trim();
      return direction||instruction?[`<image${index+1}>: ${direction}${instruction?' '+instruction:''}`]:[];
    });
    const task=references.length?workflows[workflow].instruction:'';
    return [resolve(prompt).trim(),task,lines.length?'Reference instructions:\n'+lines.join('\n'):''].filter(Boolean).join('\n\n');
  }
  function rename(text,before,after){
    return String(text||'').replace(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu,(full,prefix,name)=>name.toLowerCase()===before.toLowerCase()?`${prefix}@${after}`:full);
  }
  return {roles,workflows,compile,rename};
});
