"use strict";
const $=id=>document.getElementById(id);
const state={
  mode:"create",refs:[],profiles:{},nodes:{},availableLoras:[],ready:false,busy:false,
  projects:[],currentProject:null,activeProjectId:null,projectElementsLoading:false,
  clientId:sessionStorage.getItem('qwen.clientId')||crypto.randomUUID(),socket:null,activePromptId:sessionStorage.getItem("qwen.activePromptId")||null,
  started:0,lastStepAt:0,lastStep:0,stepTotal:0,stepTimes:[],uploaded:[],current:null,results:[],visible:8,timer:null,
  settings:null,abort:null,completing:false,generationEpoch:0,inferenceEnabled:true,standbyReason:null,pendingToken:null,refsSaving:false,refsSaved:false,referencesReady:false
};
sessionStorage.setItem('qwen.clientId',state.clientId);
const profileFiles={
  int8:{unet:"qwen_image_2.1_int8_convrot.safetensors",clip:"qwen3vl_8b_int8_convrot.safetensors"},
  bf16:{unet:"qwen_image_2.1_bf16.safetensors",clip:"qwen3vl_8b_bf16.safetensors"},
  turbo_int8:{unet:"qwen_image_2.1_turbo_int8_convrot.safetensors",clip:"qwen3vl_8b_int8_convrot.safetensors"},
  turbo_bf16:{unet:"qwen_image_2.1_turbo_bf16.safetensors",clip:"qwen3vl_8b_bf16.safetensors"}
};
const vaeName="qwen_image_2.1_vae_bf16.safetensors";
const sizeMap={
  "1":{"1:1":[1024,1024],"16:9":[1344,768],"9:16":[768,1344],"4:3":[1152,896],"3:4":[896,1152],"3:2":[1216,832],"2:3":[832,1216]},
  "1.6":{"1:1":[1280,1280],"16:9":[1696,960],"9:16":[960,1696],"4:3":[1472,1088],"3:4":[1088,1472],"3:2":[1536,1024],"2:3":[1024,1536]},
  "4":{"1:1":[2048,2048],"16:9":[2752,1536],"9:16":[1536,2752],"4:3":[2400,1792],"3:4":[1792,2400],"3:2":[2528,1696],"2:3":[1696,2528]}
};
function imageServerPrefix(){
  const marker=location.pathname.indexOf("/extensions/");
  return marker<0?"":location.pathname.slice(0,marker);
}
function api(path){return imageServerPrefix()+path;}
function wsUrl(){const url=new URL(location.href);url.protocol=url.protocol==="https:"?"wss:":"ws:";url.pathname=api("/ws");url.search="?clientId="+encodeURIComponent(state.clientId);url.hash="";return url.toString();}
function fmt(seconds){if(!Number.isFinite(seconds)||seconds<0)return "—";const total=Math.round(seconds),m=Math.floor(total/60),s=total%60;return m?`${m}m ${String(s).padStart(2,"0")}s`:`${s}s`;}
function fmtBytes(bytes){if(bytes<1024)return bytes+" B";if(bytes<1048576)return (bytes/1024).toFixed(1)+" KB";return (bytes/1048576).toFixed(1)+" MB";}
function showError(message=""){$("error").textContent=message;$("error").classList.toggle("hidden",!message);}
function setConnection(kind,text){$("connection").className="connection "+kind;$("connectionText").textContent=text;}
function showStage(title,copy){$("stage").innerHTML=`<div class="stage-empty"><b></b><span></span></div>`;$("stage").querySelector("b").textContent=title;$("stage").querySelector("span").textContent=copy;}
function setProgress(label,pct,remaining=null,indeterminate=false){
  $("status").textContent=label;$("percent").textContent=Number.isFinite(pct)?Math.round(pct)+"%":"—";
  $("progressFill").style.width=Math.max(0,Math.min(100,pct||0))+"%";$("progressBar").classList.toggle("busy",indeterminate);
  $("remaining").textContent="Time remaining: "+(remaining===null?"—":fmt(remaining));
}
function setBusy(value){const changed=state.busy!==value;state.busy=value;$("generate").disabled=value||!state.ready||!state.referencesReady;$("generate").classList.toggle("hidden",value);$("cancel").classList.toggle("hidden",!value);if(changed){renderRefs();renderProjectElements();}document.querySelectorAll(".left input,.left select,.left textarea,#addReferences,#refreshImageElements,#uploadImageElement,#imageElementsList button").forEach(el=>{if(el.id!=="aspect"&&el.id!=="resolution")el.disabled=value;});document.querySelectorAll("#mentionList button,#mentionMenu button,#randomSeed,#editCurrent,#addCurrentReference,#saveElementCategory,#saveElementName,#saveToElements").forEach(el=>{el.disabled=value;});updateSettings();}
function dimensions(){return sizeMap[$("resolution").value][$("aspect").value];}
function outputDimensions(){
  const first=state.refs[0];if(!first||$("customSize").checked||!first.width||!first.height)return dimensions();
  let w=first.width,h=first.height;
  // Mirror Pillow.thumbnail integer aspect selection before the native encoder's ties-to-even grid.
  if($("fitReferences").checked&&Math.max(w,h)>2048){
    const aspect=w/h,pick=(value,error)=>{const lo=Math.floor(value),hi=Math.ceil(value);return Math.max(1,error(lo)<=error(hi)?lo:hi);};
    if(aspect<=1){h=2048;w=pick(h*aspect,n=>Math.abs(aspect-n/h));}
    else {w=2048;h=pick(w/aspect,n=>n===0?0:Math.abs(aspect-w/n));}
  }
  const round=value=>{const n=Math.floor(value);return value-n===.5?n+n%2:Math.round(value);};
  return [Math.max(32,round(w/32)*32),Math.max(32,round(h/32)*32)];
}
function imageTimingConfiguration(settings=null){
  if(!settings){const [width,height]=outputDimensions(),guidance=$('imageGuidance').value;settings={width,height,profile:$('profile').value,steps:Number($('steps').value),mode:state.refs.length?'edit':'create',cfg:guidance==='auto'?($('negativePrompt').value.trim()?2:1):Number(guidance),lora:$('lora').value,loraStrength:Number($('loraStrength').value),transparent:!state.refs.length&&$('transparent').checked,referenceResolution:$('referenceResolution').value,cacheDevice:$('cacheDevice').value,cacheDtype:$('cacheDtype').value};}
  return H3TimingEstimator.imageConfiguration({...settings,fitReferences:$('fitReferences').checked},state.refs,state.timingRuntime);
}
function imageTimingSamples(){return state.results.map(entry=>({filename:entry.filename,seconds:entry.settings?.timingMeasurement?.seconds,source:entry.settings?.timingMeasurement?.source,configuration:entry.settings?.timingConfiguration}));}
function imageEstimate(){return H3TimingEstimator.imageEstimate(imageTimingConfiguration(),imageTimingSamples());}
function estimateSeconds(){return imageEstimate().seconds;}
function updateSettings(){
  const turbo=$("profile").value.startsWith("turbo_");
  if(turbo&&!state.turboControls)state.baselineSteps=$("steps").value;
  if(!turbo&&state.turboControls)$("steps").value=state.baselineSteps||"40";
  state.turboControls=turbo;$("steps").disabled=state.busy||turbo;
  if(turbo)$("steps").value="8";

  const hasRefs=state.refs.length>0,sourceCanvas=hasRefs&&!$("customSize").checked;
  $("referenceOptions").hidden=!hasRefs;$("referenceCount").textContent=hasRefs?`${state.refs.length}/10 attached`+(state.refsSaving?" · saving…":state.refsSaved?" · saved in this browser":""):"Optional";
  $("aspect").disabled=state.busy;$("resolution").disabled=state.busy;$("canvasOptions").hidden=!hasRefs;$("referenceResolution").disabled=state.busy||state.refs.length<2;$("transparentLabel").hidden=hasRefs;
  for(const meta of document.querySelectorAll('[data-reference-canvas="true"]')){const first=state.refs[0];if(first)meta.textContent=fmtBytes(first.file.size)+(sourceCanvas?" · sets canvas size":" · fitted to selected canvas");}
  const [w,h]=outputDimensions();$("dimensions").textContent=sourceCanvas?(state.refs[0].width?`Output canvas from first reference · approximately ${w} × ${h}`:"Output canvas follows the first reference · reading dimensions…"):`${w} × ${h} · ${(w*h/1048576).toFixed(1)} MP target`;
  const estimate=imageEstimate();$('estimate').textContent=estimate.count?(estimate.count===1?fmt(estimate.seconds)+' observed':fmt(estimate.low)+' – '+fmt(estimate.high))+` · ${estimate.count} measured run${estimate.count===1?'':'s'} for this setup`:'No measured estimate for this setup yet. A completed fresh render will teach its time.';
  const current=imageTimingConfiguration();H3TimingEstimator.renderHistory($('imageMeasuredTimings'),H3TimingEstimator.groups(imageTimingSamples(),true).filter(g=>H3TimingEstimator.signature(g.configuration.runtime)===H3TimingEstimator.signature(current.runtime)),current,fmt);
}
let referenceSignature='',referenceWrite=Promise.resolve(),referenceWriteVersion=0;
function persistReferences(){
  if(!state.referencesReady||state.referencesSessionOnly)return referenceWrite;
  const signature=JSON.stringify(state.refs.map(ref=>[ref.id,ref.name,ref.width,ref.height,ref.role,ref.instructions,ref.assetId||'',ref.projectId||'',ref.elementCategory||'']));
  if(signature===referenceSignature)return referenceWrite;
  referenceSignature=signature;
  const version=++referenceWriteVersion;
  const snapshot=state.refs.map(ref=>({...ref}));
  state.refsSaving=true;state.refsSaved=false;updateSettings();
  referenceWrite=referenceWrite.then(()=>QwenReferenceStore.save(snapshot)).then(()=>{
    if(version===referenceWriteVersion){state.refsSaving=false;state.refsSaved=true;updateSettings();}
  }).catch(error=>{
    if(version===referenceWriteVersion){referenceSignature='';state.refsSaving=false;state.refsSaved=false;updateSettings();
      showError('Could not save references for refresh. Keep this page open and retry: '+error.message);}
  });
  return referenceWrite;
}
const imageExtraControls=["imageGuidance","negativePrompt","imageWorkflow","cacheDevice","cacheDtype"];
for(const [value,item] of Object.entries(QwenReferencePlan.workflows)){const option=document.createElement("option");option.value=value;option.textContent=item.label;$("imageWorkflow").append(option);}
function saveDraft(){
  if(!state.referencesReady)return;
  sessionStorage.setItem("qwen.imageDraft",JSON.stringify({baselineSteps:state.baselineSteps,...Object.fromEntries(imageExtraControls.map(id=>[id,$(id).value])),prompt:$("prompt").value,lora:$("lora").value,loraStrength:$("loraStrength").value,profile:$("profile").value,aspect:$("aspect").value,resolution:$("resolution").value,steps:$("steps").value,seed:$("seed").value,transparent:$("transparent").checked,referenceResolution:$("referenceResolution").value,customSize:$("customSize").checked,fitReferences:$("fitReferences").checked}));
  void persistReferences();
}
window.QwenTabState={prepareReload:async()=>{
  if(!state.referencesReady)throw Error('Wait for references to finish loading.');
  await referenceWrite;saveDraft();await persistReferences();
  if(state.refsSaving||!state.refsSaved)throw Error('References are not saved. Keep this tab open and retry.');
}};
function restoreDraft(){
  let draft={};try{draft=JSON.parse(sessionStorage.getItem("qwen.imageDraft")||"{}");}catch{}
  for(const id of [...imageExtraControls,"prompt","profile","aspect","resolution","steps","seed","referenceResolution","lora","loraStrength"]){if(draft[id]!==undefined&&$(id))$(id).value=String(draft[id]);}
  if($("seed").value.trim()&&$("seed").value.trim()!=="-1"){try{$("seed").value=String(H3RenderValues.seed($("seed").value));}catch{$("seed").value="42";showError("The saved seed was invalid. Reset to the default42.");}}
  state.baselineSteps=draft.baselineSteps||"40";state.turboControls=$("profile").value.startsWith("turbo_");
  $("transparent").checked=!!draft.transparent;$("customSize").checked=!!draft.customSize;$("fitReferences").checked=draft.fitReferences!==false;
}
function validName(name){return /^[\p{L}\p{N}_-]+$/u.test(name);}
function suggestedName(file){const base=file.name.replace(/\.[^.]+$/,""),clean=base.replace(/[^\p{L}\p{N}_-]+/gu,"_").replace(/^_+|_+$/g,"").slice(0,30)||"image";let name=clean,index=2;while(state.refs.some(ref=>ref.name.toLowerCase()===name.toLowerCase()))name=`${clean}_${index++}`;return name;}
function resolveMentions(prompt){return QwenReferencePlan.compile(prompt,state.refs,$("imageWorkflow").value);}
function refreshPromptPreview(){
  document.querySelectorAll('#referenceList textarea').forEach((field,index)=>{if(field!==document.activeElement)field.value=state.refs[index]?.instructions||'';});
  try{const prompt=resolveMentions($("prompt").value);$("promptPreview").textContent=prompt+"\n\n"+state.refs.map((ref,index)=>`@${ref.name} → <image${index+1}> → ${ref.file.name}${index===0?' (canvas source)':''}`).join("\n");}
  catch(error){$("promptPreview").textContent=error.message;}
}
$("refreshPromptPreview").onclick=refreshPromptPreview;
function insertMention(name){if(state.busy||!state.referencesReady)return;const field=$("prompt"),at=field.selectionStart,before=field.value.slice(0,at),match=before.match(/@([\p{L}\p{N}_-]*)$/u),start=match?at-match[0].length:at,token=`@${name} `;field.setRangeText(token,start,at,"end");H3StudioUX.revealControl(field);field.focus();saveDraft();renderMentions();}
function renderMentions(){
  const field=$("prompt"),list=$("mentionList"),menu=$("mentionMenu");list.replaceChildren();menu.replaceChildren();
  state.refs.forEach((ref,index)=>{const chip=document.createElement("button");chip.type="button";chip.disabled=state.busy;chip.textContent=`@${ref.name} · image${index+1}`;chip.title=`Insert @${ref.name} into prompt`;chip.onclick=()=>insertMention(ref.name);list.append(chip);});
  const before=field.value.slice(0,field.selectionStart),match=before.match(/@([\p{L}\p{N}_-]*)$/u),matches=match?state.refs.filter(ref=>ref.name.toLowerCase().startsWith(match[1].toLowerCase())):[];
  menu.classList.toggle("is-hidden",!matches.length);matches.forEach(ref=>{const index=state.refs.indexOf(ref),button=document.createElement("button");button.type="button";button.disabled=state.busy;button.role="option";button.textContent=`@${ref.name} · image${index+1}`;button.onmousedown=event=>event.preventDefault();button.onclick=()=>{insertMention(ref.name);menu.classList.add("is-hidden");};menu.append(button);});
}

function moveReference(index,direction){
  if(state.busy)return;
  const next=index+direction;
  if(next<0||next>=state.refs.length)return;
  const reordered=state.refs.slice();[reordered[index],reordered[next]]=[reordered[next],reordered[index]];commitImageReferenceOrder(reordered);
}
function commitImageReferenceOrder(next){
  if(state.busy||!state.referencesReady)return;
  const before=state.refs;if(next.length!==before.length||new Set(next).size!==before.length||next.some(ref=>!before.includes(ref)))throw Error('Reference order changed. Try again.');
  $('prompt').value=H3ReferenceOrder.remapQwen($('prompt').value,before,next);for(const ref of next)ref.instructions=H3ReferenceOrder.remapQwen(ref.instructions||'',before,next);state.refs=next;renderRefs();saveDraft();showError('');
}

function renderRefs(){
  H3Drag.destroyTree($("referenceList"));const before=state.refs.slice();
  $("referenceList").replaceChildren();state.refs.forEach((ref,index)=>{
    const row=document.createElement("div");row.className="ref";const image=document.createElement("img");image.src=ref.url;image.alt=`Preview of image ${index+1}`;
    const text=document.createElement("div");const title=document.createElement("strong");title.textContent=`image${index+1} · ${ref.file.name}`;const meta=document.createElement("small");meta.dataset.referenceCanvas=String(index===0);meta.textContent=fmtBytes(ref.file.size)+(index===0?" · sets canvas size":" · reference");let elementTag=null;if(ref.assetId){elementTag=document.createElement("small");const badge=document.createElement("span");badge.className="element-badge";badge.textContent=`Element · ${ref.elementCategory||"Project"}`;elementTag.append(badge);}const nameLabel=document.createElement("label");nameLabel.textContent="MENTION NAME";const nameInput=document.createElement("input");nameInput.className="ref-name";nameInput.value=ref.name;nameInput.maxLength=32;nameInput.setAttribute("aria-label",`Mention name for image ${index+1}`);nameInput.onchange=()=>{const next=nameInput.value.trim();if(!validName(next)||state.refs.some(other=>other!==ref&&other.name.toLowerCase()===next.toLowerCase())){showError("Use a unique reference name with letters, numbers, _ or -.");nameInput.value=ref.name;return;}const old=ref.name;ref.name=next;$("prompt").value=QwenReferencePlan.rename($("prompt").value,old,next);for(const item of state.refs){if(item.instructions)item.instructions=QwenReferencePlan.rename(item.instructions,old,next);}showError("");renderMentions();renderProjectElements();refreshPromptPreview();saveDraft();};nameInput.oninput=()=>{if(validName(nameInput.value.trim())&&!state.refs.some(other=>other!==ref&&other.name.toLowerCase()===nameInput.value.trim().toLowerCase()))nameInput.onchange();};text.append(title,meta,...(elementTag?[elementTag]:[]),nameLabel,nameInput);
    const remove=document.createElement("button");remove.className="button alt small";remove.type="button";remove.textContent="Remove";remove.onclick=()=>{if(state.busy)return;const before=state.refs.slice(),after=before.filter(item=>item!==ref);
      const remap=text=>String(text||'').replace(/<image(\d+)>/gi,(whole,n)=>{const item=before[Number(n)-1];return item===ref?'@'+ref.name:item?'<image'+(after.indexOf(item)+1)+'>':whole;});
      $("prompt").value=remap($("prompt").value);for(const item of after)item.instructions=remap(item.instructions);
      URL.revokeObjectURL(ref.url);state.refs=after;renderRefs();saveDraft();};
    const aliasRow=document.createElement("div");aliasRow.className="ref-alias-row";aliasRow.append(nameLabel,nameInput);
    const insert=document.createElement("button");insert.type="button";insert.className="button alt small ref-insert";insert.textContent=`Insert @${ref.name} into prompt`;insert.title=insert.textContent;insert.disabled=state.busy;insert.onclick=()=>{insertMention(ref.name);$("prompt").scrollIntoView({behavior:"smooth",block:"center"});};
    nameInput.addEventListener("input",()=>{insert.textContent=`Insert @${ref.name} into prompt`;insert.title=insert.textContent;});
    const order=document.createElement("div");order.className="ref-order";
    const orderLabel=document.createElement("span");orderLabel.textContent=index===0?"Image 1 · output canvas / base":"Image "+(index+1)+" · additional reference";
    order.append(orderLabel);
    for(const [label,direction] of [["Move up",-1],["Move down",1]]){
      const button=document.createElement("button");button.type="button";button.className="button alt small";button.textContent=label;
      button.setAttribute("aria-label",`${label} ${ref.name}`);button.disabled=state.busy||index+direction<0||index+direction>=state.refs.length;
      button.onclick=()=>moveReference(index,direction);order.append(button);
    }
    row.classList.add('image-reference-row');row.dataset.referenceIndex=String(index);const grip=H3Drag.handle('Move image reference '+ref.name,offset=>moveReference(index,offset),'image-reference-handle');grip.disabled=state.busy||!state.referencesReady;
    const guidance=document.createElement("div");guidance.className="ref-alias-row";
    const roleLabel=document.createElement("label");roleLabel.textContent="USE FROM THIS IMAGE";
    const role=document.createElement("select");role.setAttribute("aria-label",`Role for image ${index+1}`);
    for(const [value,label] of Object.entries(QwenReferencePlan.roles)){const option=document.createElement("option");option.value=value;option.textContent=label;role.append(option);}
    role.value=ref.role||"context";role.disabled=state.busy;role.onchange=()=>{ref.role=role.value;saveDraft();refreshPromptPreview();};
    const instructionLabel=document.createElement("label");instructionLabel.textContent="TAKE / PRESERVE / EXCLUDE";
    const instructions=document.createElement("textarea");instructions.rows=2;instructions.placeholder="What to take from this image, what to preserve or ignore…";instructions.value=ref.instructions||"";instructions.maxLength=4000;instructions.disabled=state.busy;instructions.setAttribute("aria-label",`Instructions for image ${index+1}`);instructions.oninput=()=>{ref.instructions=instructions.value;saveDraft();refreshPromptPreview();};
    guidance.append(roleLabel,role,instructionLabel,instructions);
    row.append(grip,image,text,remove,aliasRow,order,insert,guidance);$("referenceList").append(row);
  });renderMentions();renderProjectElements();updateSettings();refreshPromptPreview();
  H3Drag.attach($('referenceList'),{selector:'.ref',handle:'.image-reference-handle',locked:()=>state.busy||!state.referencesReady,onCancel:renderRefs,onCommit:()=>{
    if(before.length!==state.refs.length||before.some((ref,index)=>ref!==state.refs[index])){renderRefs();return;}
    commitImageReferenceOrder(H3ReferenceOrder.permutation(before,[...$('referenceList').children].map(n=>Number(n.dataset.referenceIndex))));
  }});
}
$("addReferences").onclick=()=>{if(!state.busy&&state.referencesReady)$("referenceFiles").click();};
$("referenceFiles").onchange=()=>{
  if(!state.referencesReady||state.busy)return;
  const incoming=[...$("referenceFiles").files];for(const file of incoming){
    if(state.refs.length>=10){showError("Qwen Image supports up to 10 images. Remaining files were not added.");break;}
    if(!/\.(png|jpe?g|webp)$/i.test(file.name)||!file.size||file.size>25*1024*1024){showError("Use non-empty PNG, JPG or WebP images under 25 MB.");continue;}
    const ref={id:crypto.randomUUID(),file,url:URL.createObjectURL(file),name:suggestedName(file),role:"context",instructions:"",width:0,height:0};state.refs.push(ref);createImageBitmap(file).then(bitmap=>{ref.width=bitmap.width;ref.height=bitmap.height;bitmap.close();updateSettings();void persistReferences();}).catch(()=>{});
  }
  $("referenceFiles").value="";renderRefs();saveDraft();
};

async function checkConnection(){
  try{
    const response=await fetch(api("/h3_studio/image_readiness"),{cache:"no-store"});if(!response.ok)throw Error("Image extension unavailable");
    let loader={};
    try{const loaderResponse=await fetch(api("/object_info/LoraLoaderModelOnly"),{cache:"no-store",signal:AbortSignal.timeout(5000)});if(loaderResponse.ok)loader=await loaderResponse.json();}catch{/* Optional LoRA discovery must not disable baseline Qwen generation. */}
    state.availableLoras=loader.LoraLoaderModelOnly?.input?.required?.lora_name?.[0]||[];
    for(const option of $("lora").options)option.disabled=!!option.value&&!state.availableLoras.some(name=>name.replaceAll('\\','/')===option.value);
    $("loraNote").textContent=state.availableLoras.some(name=>name.replaceAll('\\','/')==="qwen21/NSFW-Qwen-by-TheseAlpacas-V2.safetensors")?"V2 installed · applies before reference caching. Strength 0 disables its effect.":"V2 installation could not be verified. Your saved selection is kept.";
    const data=await H3RenderValues.readJson(response);state.profiles=data.profiles||{};state.nodes=data.nodes||{};state.inferenceEnabled=data.inference_enabled!==false;state.standbyReason=state.inferenceEnabled?null:(data.reason||"Inference is disabled on this standby server.");state.ready=state.inferenceEnabled&&!!data.ready;
    const context=await Promise.all(['/system_stats','/h3_studio/readiness'].map(async path=>{try{const response=await fetch(api(path),{cache:'no-store',signal:AbortSignal.timeout(3000)});return response.ok?await response.json():{};}catch{return {};}}));
    state.timingRuntime=H3TimingEstimator.runtimeContext(...context);
    for(const option of $("profile").options){option.disabled=!state.profiles[option.value]?.ready;}
    let savedProfile;try{savedProfile=JSON.parse(sessionStorage.getItem('qwen.imageDraft')||'{}').profile;}catch{}
    if(!state.profiles[$("profile").value]?.ready&&!savedProfile){const first=[...$("profile").options].find(option=>!option.disabled);if(first)$("profile").value=first.value;}
    if(data.ready&&!state.profiles[$("profile").value]?.ready){state.ready=false;setConnection('down','Selected precision profile is unavailable');$('profileNote').textContent='Your saved precision choice was kept. Select an installed profile to generate.';return false;}
    const readyProfiles=Object.entries(state.profiles).filter(([,item])=>item.ready).map(([key])=>key.toUpperCase());
    const missingNodes=Object.entries(state.nodes).filter(([,ready])=>!ready).map(([name])=>name);
    if(!state.inferenceEnabled){setConnection("down",state.standbyReason);$("profileNote").textContent=state.standbyReason;return false;}
    if(!state.ready){setConnection("down",missingNodes.length?"Missing nodes: "+missingNodes.join(", "):"Qwen weights are not installed");$("profileNote").innerHTML="<strong>Qwen Image is unavailable</strong><br>Install one complete model profile before generating.";return false;}
    setConnection("ready","Connected · "+readyProfiles.join(" + "));if($("profile").value.startsWith("turbo_")){$("profileNote").textContent="Official Turbo · 8 steps with its fixed sampling schedule. Requires a separate installed checkpoint; visual quality is unverified on this server.";openSocket();return true;}$("profileNote").innerHTML=$("profile").value==="bf16"?"<strong>Maximum precision</strong><br>Full BF16 weights. More model loading and memory use.":"<strong>Fast / efficient</strong><br>INT8 ConvRot reduces storage and VRAM with a possible small quality difference.";openSocket();return true;
  }catch(error){state.ready=false;setConnection("down",error.message);return false;}finally{setBusy(state.busy);updateSettings();}
}
$("retry").onclick=checkConnection;$("profile").onchange=()=>{updateSettings();saveDraft();void checkConnection();};
function openSocket(){
  if(state.socket&&state.socket.readyState<=1)return;try{state.socket=new WebSocket(wsUrl());}catch{return;}
  state.socket.onmessage=event=>{let msg;try{msg=JSON.parse(event.data);}catch{return;}handleSocket(msg);};state.socket.onclose=()=>{state.socket=null;if(state.busy)setTimeout(openSocket,1500);};
}
function handleSocket(message){
  const data=message.data||{};if(data.prompt_id&&state.activePromptId&&data.prompt_id!==state.activePromptId)return;
  if(message.type==="progress"&&state.busy){
    const value=Number(data.value||0),max=Math.max(1,Number(data.max||1)),now=Date.now();if(state.lastStepAt&&value>state.lastStep)state.stepTimes.push((now-state.lastStepAt)/1000/(value-state.lastStep));if(value>state.lastStep)state.lastStepAt=now;state.lastStep=value;state.stepTotal=max;saveActiveJob();
    const pct=12+Math.round(78*value/max),avg=state.stepTimes.length?state.stepTimes.slice(-8).reduce((a,b)=>a+b,0)/Math.min(8,state.stepTimes.length):0;setProgress(`Sampling · ${value}/${max}`,pct,avg?avg*(max-value):null);
  }else if(message.type==="executing"&&state.busy){
    if(data.node===null){pollHistory(true);}else if(data.node==="save")setProgress("Saving PNG and settings",96,null);else if(data.node==="decode")setProgress("Decoding image",91,null);else if(!state.lastStepAt)setProgress("Loading Qwen Image",8,estimateSeconds(),true);
  }else if(message.type==="execution_error"&&state.busy){failGeneration(data.exception_message||"ComfyUI graph failed");}
}
function saveActiveJob(){if(!state.activePromptId)return;sessionStorage.setItem("qwen.activeJob",JSON.stringify({promptId:state.activePromptId,pendingToken:state.pendingToken,settings:state.settings,started:state.started,uploaded:state.uploaded,lastStep:state.lastStep,stepTotal:state.stepTotal,stepTimes:state.stepTimes.slice(-8),completionObservation:state.completionObservation}));}
async function pollImageProgress(){const id=state.activePromptId;if(!id)return;try{const response=await fetch(api("/h3_studio/job_progress?prompt_id="+encodeURIComponent(id)),{cache:"no-store"});if(!response.ok)return;const data=await H3RenderValues.readJson(response);if(id!==state.activePromptId||!Number.isFinite(data.step)||!Number.isFinite(data.total)||data.total<=0||data.step<state.lastStep)return;state.lastStep=data.step;state.stepTotal=data.total;state.lastStepAt=Date.now();const avg=state.stepTimes.length?state.stepTimes.reduce((a,b)=>a+b,0)/state.stepTimes.length:0;setProgress(`Sampling · ${data.step}/${data.total}`,12+Math.round(78*data.step/data.total),avg?avg*(data.total-data.step):null);saveActiveJob();}catch{}}

function qwenLora(settings){
  const lora=settings.lora||"";
  if(!lora)return {lora:"",loraStrength:0};
  if(lora.replaceAll('\\','/')!=="qwen21/NSFW-Qwen-by-TheseAlpacas-V2.safetensors")throw Error("Unknown Qwen Image 2.1 LoRA.");
  const loraStrength=Number(settings.loraStrength??0.8);
  if(!Number.isFinite(loraStrength)||loraStrength<0||loraStrength>2)throw Error("LoRA strength must be between 0 and 2.");
  return {lora,loraStrength};
}
function buildGraph(settings,uploads,token){
  const cfg=settings.cfg??(settings.negativePrompt?.trim()?2:1);
  if(!Number.isFinite(cfg)||cfg<1||cfg>5)throw Error("Guidance must be between 1 and 5.");
  if(settings.negativePrompt?.trim()&&cfg===1)throw Error("Negative prompt requires guidance above 1. Choose Auto or higher guidance.");
  settings={...settings,cfg};
  if(uploads.length>10||settings.mode==="edit"&&!uploads.length)throw Error("Edit requires 1–10 reference images.");
  if(!["auto","gpu","cpu","off"].includes(settings.cacheDevice||"auto")||!["default","int8","int4"].includes(settings.cacheDtype||"default"))throw Error("Invalid reference cache settings.");
  settings={...settings,...qwenLora(settings)};
  if(settings.mode==="edit"&&uploads.length>1&&settings.referenceResolution>0&&(settings.referenceResolution<103||settings.referenceResolution>4096))throw Error("Additional reference detail must be 0 or 103–4096 px for this runtime.");
  const turbo=settings.profile.startsWith("turbo_");
  if(turbo&&(cfg!==1||settings.negativePrompt?.trim()||settings.lora))throw Error("Qwen Turbo requires guidance 1, no negative prompt and no extra LoRA.");
  if(turbo)settings={...settings,steps:8};
  const files=profileFiles[settings.profile];if(!files)throw Error("Selected model profile is invalid.");
  const prompt=settings.transparent&&settings.mode==="create"?`This is an RGBA format image with transparency. ${settings.prompt.replace(/\.+$/,'')}. The image has an alpha channel and a transparent background.`:settings.prompt;
  const metadata={kind:"image",...settings,prompt,references:uploads.map((name,index)=>({name:settings.referenceNames?.[index]||`image${index+1}`,file:name.split(/[\\/]/).pop()})),submitted_at:Date.now()/1000,token};
  const graph={
    unet:{class_type:"UNETLoader",inputs:{unet_name:files.unet,weight_dtype:"default"}},
    clip:{class_type:"CLIPLoader",inputs:{clip_name:files.clip,type:"qwen_image",device:"default"}},
    vae:{class_type:"VAELoader",inputs:{vae_name:vaeName}},
    enc:{class_type:"TextEncodeQwenImage21",inputs:{clip:["clip",0],prompt,negative_prompt:settings.negativePrompt||"",resolution:settings.referenceResolution}},
    decode:{class_type:"VAEDecode",inputs:{samples:["sampler",0],vae:["vae",0]}},
    save:{class_type:"QwenStudioSaveImage",inputs:{images:["decode",0],token,metadata_json:JSON.stringify(metadata)}}
  };
  let model=["unet",0],latent;
  if(settings.lora){graph.lora={class_type:"LoraLoaderModelOnly",inputs:{model,lora_name:settings.lora,strength_model:settings.loraStrength}};model=["lora",0];}
  if(settings.mode==="create"){
    graph.latent={class_type:"EmptyLatentImage",inputs:{width:settings.width,height:settings.height,batch_size:1}};latent=["latent",0];
  }else{
    graph.enc.inputs.vae=["vae",0];graph.enc.inputs.resolution=0;uploads.forEach((name,index)=>{const n=index+1,id="load"+n;graph[id]={class_type:"LoadImage",inputs:{image:name}};let link=[id,0];if(n===1&&settings.customSize){graph.scale_primary={class_type:"ImageScale",inputs:{image:link,upscale_method:"lanczos",width:settings.width,height:settings.height,crop:"center"}};link=["scale_primary",0];}else if(n>1&&settings.referenceResolution>0){const scale="scale_ref"+n;graph[scale]={class_type:"ImageScaleToTotalPixels",inputs:{image:link,upscale_method:"lanczos",megapixels:settings.referenceResolution**2/1048576,resolution_steps:32}};link=[scale,0];}graph.enc.inputs["images.image_"+n]=link;});
    graph.cache={class_type:"QwenImage21Cache",inputs:{model,device:settings.cacheDevice||"auto",dtype:settings.cacheDtype||"default"}};model=["cache",0];latent=["enc",2];
  }
  graph.sampler={class_type:"KSampler",inputs:{model,seed:settings.seed,steps:settings.steps,cfg,sampler_name:"euler",scheduler:"simple",positive:["enc",0],negative:["enc",1],latent_image:latent,denoise:1}};
  if(turbo){
    graph.sigmas={class_type:"ManualSigmas",inputs:{sigmas:"1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"}};
    graph.noise={class_type:"RandomNoise",inputs:{noise_seed:settings.seed}};
    graph.sample_method={class_type:"KSamplerSelect",inputs:{sampler_name:"euler"}};
    graph.guider={class_type:"CFGGuider",inputs:{model,positive:["enc",0],negative:["enc",1],cfg:1}};
    graph.sampler={class_type:"SamplerCustomAdvanced",inputs:{noise:["noise",0],guider:["guider",0],sampler:["sample_method",0],sigmas:["sigmas",0],latent_image:latent}};
  }
  return graph;
}
async function uploadOne(file,index){
  const signal=state.abort?.signal;
  const encoded=await new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException("Cancelled","AbortError"));return;}
    const reader=new FileReader(),cancel=()=>reader.abort();
    const finish=()=>signal?.removeEventListener("abort",cancel);
    signal?.addEventListener("abort",cancel,{once:true});
    reader.onload=()=>{finish();resolve(String(reader.result).split(",")[1]);};
    reader.onerror=()=>{finish();reject(Error("Could not read this image. Remove it and add the original file again."));};
    reader.onabort=()=>{finish();reject(new DOMException("Cancelled","AbortError"));};
    reader.readAsDataURL(file);
  });
  if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest(),cancel=()=>xhr.abort(),finish=()=>signal?.removeEventListener("abort",cancel);
    signal?.addEventListener("abort",cancel,{once:true});xhr.open("POST",api("/h3_studio/upload_ref?kind=image"+($("fitReferences").checked?"&resize=1":"")));
    xhr.setRequestHeader("Content-Type","application/json");xhr.timeout=300000;
    xhr.upload.onprogress=event=>{if(event.lengthComputable)setProgress(`Uploading image ${index+1}/${state.refs.length}`,2+Math.round(6*event.loaded/event.total),null);};
    xhr.onload=()=>{finish();let data={};try{data=JSON.parse(xhr.responseText);}catch{}if(xhr.status>=200&&xhr.status<300&&typeof data.name==="string"&&data.name)resolve(data.name);else reject(Error(data.error||`Image upload failed (HTTP ${xhr.status}). ${/just a moment|cf_chl|cloudflare/i.test(xhr.responseText)?'The hosting gateway blocked the upload.':'The server did not return a valid upload response.'}`));};
    xhr.onerror=()=>{finish();reject(Error("Image upload could not reach the server. Check the connection and retry; your references remain saved."));};
    xhr.ontimeout=()=>{finish();reject(Error("Image upload timed out. Your references remain saved; check the connection and retry."));};
    xhr.onabort=()=>{finish();reject(new DOMException("Cancelled","AbortError"));};
    xhr.send(JSON.stringify({filename:file.name,data:encoded}));
  });
}
async function cleanupUploads(){const names=state.uploaded.splice(0);await Promise.allSettled(names.map(filename=>fetch(api("/h3_studio/discard"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename}),signal:AbortSignal.timeout(5000)})));}
function captureSettings(){
  const [width,height]=outputDimensions(),sourcePrompt=$("prompt").value.trim(),steps=Number($("steps").value),seed=H3RenderValues.seed($("seed").value,{allowRandom:true}),profile=$("profile").value,mode=state.refs.length?"edit":"create";
  if(!sourcePrompt)throw Error("Write a prompt.");if(!state.profiles[profile]?.ready)throw Error("The selected precision profile is not installed.");if(!Number.isInteger(steps)||steps<1||steps>100)throw Error("Steps must be between 1 and 100.");if(state.refs.length>10)throw Error("Qwen Image supports up to 10 images.");
  if(mode==="edit"&&!$("customSize").checked){if(!state.refs[0].width||!state.refs[0].height)throw Error("Still reading the first reference's dimensions. Try again in a moment.");if(width<256||height<256)throw Error("First reference is too small for the output canvas. Select 'Use selected output size'.");if(width>2752||height>2752)throw Error("First reference exceeds the supported output canvas. Select 'Use selected output size'.");}
  const loraSettings=qwenLora({lora:$("lora").value,loraStrength:$("loraStrength").value});
  const actualLora=state.availableLoras.find(name=>name.replaceAll('\\','/')===loraSettings.lora.replaceAll('\\','/'));
  if(loraSettings.lora&&!actualLora)throw Error("The selected LoRA is not installed. Select None or install it before generating.");
  if(actualLora)loraSettings.lora=actualLora;
  const negativePrompt=$("negativePrompt").value.trim(),guidance=$("imageGuidance").value;
  const cfg=guidance==="auto"?(negativePrompt?2:1):Number(guidance);
  if(negativePrompt&&cfg===1)throw Error("Negative prompt requires guidance above 1. Choose Auto or higher guidance.");
  const prompt=resolveMentions(sourcePrompt);
  if(state.refs.length&&!state.nodes.LoadImage)throw Error("Missing node: LoadImage. Update the server before using references.");
  $("seed").value=String(seed);saveDraft();
  if(profile.startsWith("turbo_")){
    for(const name of ["ManualSigmas","KSamplerSelect","RandomNoise","CFGGuider","SamplerCustomAdvanced"])if(!state.nodes[name])throw Error("Missing Turbo node: "+name);
    if(cfg!==1||negativePrompt||loraSettings.lora)throw Error("Qwen Turbo requires guidance 1, no negative prompt and no extra LoRA.");
  }
  return {...loraSettings,cfg,negativePrompt:$("negativePrompt").value.trim(),workflow:$("imageWorkflow").value,cacheDevice:$("cacheDevice").value,cacheDtype:$("cacheDtype").value,projectId:state.currentProject?.project_id||null,referencePlan:state.refs.map(ref=>({name:ref.name,role:ref.role||"context",instructions:ref.instructions||"",...(ref.assetId?{assetId:ref.assetId}:{}),...(ref.elementCategory?{elementCategory:ref.elementCategory}:{})})),mode,profile,prompt,sourcePrompt,referenceNames:state.refs.map(ref=>ref.name),width,height,steps:profile.startsWith("turbo_")?8:steps,seed,transparent:mode==="create"&&$("transparent").checked,referenceResolution:Number($("referenceResolution").value),customSize:mode==="edit"&&$("customSize").checked};
}
async function recoverPendingImage(){
  if(!state.pendingToken)return state.activePromptId;
  const token=state.pendingToken;
  const matches=graph=>graph?.save?.inputs?.token===token;
  let found=null;
  try{const queue=await(await fetch(api('/queue'),{signal:AbortSignal.timeout(10000)})).json();found=[...(queue.queue_running||[]),...(queue.queue_pending||[])].find(item=>matches(item[2]))?.[1];}catch{}
  if(!found)try{const history=await(await fetch(api('/history?max_items=100'),{signal:AbortSignal.timeout(10000)})).json();found=Object.entries(history).find(([,item])=>matches(item.prompt?.[2]))?.[0];}catch{}
  if(found&&state.pendingToken===token){state.activePromptId=found;state.pendingToken=null;sessionStorage.setItem('qwen.activePromptId',found);saveActiveJob();return found;}
  return null;
}
async function cancelQueuedImage(promptId){
  if(String(promptId).startsWith('submission:'))promptId=await recoverPendingImage();
  if(!promptId)return false;
  const response=await fetch(api('/queue'));if(!response.ok)return false;
  const queue=await H3RenderValues.readJson(response);
  if((queue.queue_running||[]).some(item=>item[1]===promptId))return false;
  if(!(queue.queue_pending||[]).some(item=>item[1]===promptId))return false;
  const deleted=await fetch(api('/queue'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[promptId]})});if(!deleted.ok)return false;
  const verified=await fetch(api('/queue'));if(!verified.ok)return false;
  const after=await verified.json();return ![...(after.queue_running||[]),...(after.queue_pending||[])].some(item=>item[1]===promptId);
}
async function generate(){
  if(state.busy)return;
  stopImagePolling();
  const promptEpoch=++state.generationEpoch;
  showError("");let settings;try{if(!await checkConnection())throw Error(state.standbyReason||"Qwen Image is not ready on this server.");if(promptEpoch!==state.generationEpoch||state.busy)return;settings=captureSettings();}catch(error){showError(error.message);return;}
  state.completionObservation=null;state.settings=settings;state.abort=new AbortController();state.uploaded=[];state.started=Date.now();state.lastStepAt=0;state.lastStep=0;state.stepTotal=0;state.stepTimes=[];setBusy(true);setProgress("Preparing inputs",2,estimateSeconds(),true);showStage("Generating your image","The first run can include model loading.");
  settings.timingConfiguration=imageTimingConfiguration(settings);
  let submitted=false,submissionSettled=false;
  try{
    if(settings.mode==="edit")for(let i=0;i<state.refs.length;i++){const name=await uploadOne(state.refs[i].file,i);state.uploaded.push(name);}
    if(promptEpoch!==state.generationEpoch||state.abort.signal.aborted)throw new DOMException("Cancelled","AbortError");
    const token=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const prompt=buildGraph(settings,state.uploaded,token);
    state.pendingToken=token;state.activePromptId="submission:"+token;sessionStorage.setItem("qwen.activePromptId",state.activePromptId);saveActiveJob();submitted=true;
    const response=await fetch(api("/prompt"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,client_id:state.clientId})});
    const data=await H3RenderValues.readJson(response);
    if(!response.ok||!data.prompt_id){submissionSettled=!response.ok&&response.status<500;if(submissionSettled){state.activePromptId=null;state.pendingToken=null;}throw Error(nodeError(data));}
    submissionSettled=true;state.pendingToken=null;
    state.activePromptId=data.prompt_id;sessionStorage.setItem("qwen.activePromptId",data.prompt_id);saveActiveJob();
    if(promptEpoch!==state.generationEpoch){
      let confirmed=false;
      try{confirmed=await cancelQueuedImage(data.prompt_id);}catch{}
      if(!confirmed){
        setProgress("Cancellation unconfirmed · job tracked",0,null,true);
        throw Error("Cancellation could not be confirmed on the server. The job remains tracked. This version can remove queued images but cannot safely interrupt a running image.");
      }
      throw Error("Cancelled");
    }
    setProgress("Queued or loading Qwen Image",8,estimateSeconds(),true);pollQueue();pollHistory(false);
  }catch(error){if(submitted&&!submissionSettled){setBusy(true);showError("Submission acknowledgement was lost. The image may still run. Inputs are retained; this workspace will look for its saved token in queue/history. Do not retry yet.");pollQueue();pollHistory(false);return;}if(state.activePromptId&&error.message!=="Cancelled"){setBusy(true);showError(error.message);return;}if(error.name==="AbortError"||error.message==="Cancelled"){await finishFailure("Cancelled",true);}else await finishFailure(error.message,false);}
}
function nodeError(data){const errors=[];if(data.error?.message)errors.push(data.error.message);for(const [id,node] of Object.entries(data.node_errors||{}))for(const error of node.errors||[])errors.push(`${id}: ${error.message||""} ${error.details||""}`.trim());return (errors.join(" · ")||"ComfyUI rejected the image graph").slice(0,700);}
async function finishFailure(message,cancelled){stopImagePolling();state.activePromptId=null;state.pendingToken=null;state.completing=false;state.completionObservation=null;sessionStorage.removeItem("qwen.activePromptId");sessionStorage.removeItem("qwen.activeJob");await cleanupUploads();setBusy(false);setProgress(cancelled?"Cancelled":"Generation failed",0,null);showStage(cancelled?"Generation cancelled":"Generation failed",cancelled?"Your prompt and references are still here.":message);if(!cancelled)showError(message);}
function failGeneration(message){finishFailure(message,false);}
$("generate").onclick=generate;
$("cancel").onclick=async()=>{
  ++state.generationEpoch;
  state.abort?.abort();const id=state.activePromptId;
  if(id){
    try{if(!await cancelQueuedImage(id)){showError("Cancellation is unconfirmed. This version can remove queued images but cannot safely interrupt a running image. The job and inputs remain tracked.");setBusy(true);pollQueue();pollHistory();return;}}
    catch{showError("Could not confirm cancellation. The job and inputs remain tracked.");setBusy(true);pollQueue();pollHistory();return;}
  }
  await finishFailure("Cancelled",true);
};
let queuePollTimer=null,historyPollTimer=null,queuePollRequest=null,historyPollRequest=null;
function stopImagePolling(){clearTimeout(queuePollTimer);clearTimeout(historyPollTimer);queuePollTimer=historyPollTimer=null;}
async function pollQueue(){
  clearTimeout(queuePollTimer);queuePollTimer=null;const epoch=state.generationEpoch;
  if(!state.busy||queuePollRequest?.epoch===epoch)return;const request={epoch};queuePollRequest=request;
  try{if(state.pendingToken)await recoverPendingImage();if(epoch!==state.generationEpoch||!state.busy)return;const id=state.activePromptId,data=await(await fetch(api('/queue'),{cache:'no-store',signal:AbortSignal.timeout(10000)})).json();if(epoch!==state.generationEpoch||id!==state.activePromptId||!state.busy)return;const running=data.queue_running||[],pending=data.queue_pending||[],position=pending.findIndex(item=>item[1]===id);$('queueInfo').textContent=running.some(item=>item[1]===id)?`Queue: rendering now · ${pending.length} waiting`:position>=0?`Queue: position ${position+1} · ${pending.length} waiting`:`Queue: ${running.length} active · ${pending.length} waiting`;if(running.some(item=>item[1]===id))await pollImageProgress();}catch{}
  finally{if(queuePollRequest===request)queuePollRequest=null;if(epoch===state.generationEpoch&&state.busy)queuePollTimer=setTimeout(pollQueue,2500);}
}
function findOutput(history){for(const output of Object.values(history?.outputs||{})){for(const image of output.images||[]){if(/^qwen_studio_[A-Za-z0-9_-]+_[0-9]{5}\.png$/.test(image.filename||""))return image;}}return null;}
async function pollHistory(force=false){
  clearTimeout(historyPollTimer);historyPollTimer=null;const epoch=state.generationEpoch;
  if(!state.activePromptId||historyPollRequest?.epoch===epoch)return;
  const request={epoch};historyPollRequest=request;let id=state.activePromptId;
  try{
    if(state.pendingToken&&!await recoverPendingImage())return;
    if(epoch!==state.generationEpoch)return;id=state.activePromptId;if(!id)return;
    const response=await fetch(api('/history/'+encodeURIComponent(id)),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Image history is temporarily unavailable.');
    const all=await H3RenderValues.readJson(response);
    if(state.activePromptId!==id||epoch!==state.generationEpoch)return;
    const history=all[id];
    if(history){
      const file=findOutput(history);if(file){await completeGeneration(file,history);return;}
      const status=history.status||{},messages=status.messages||[];
      const failure=messages.find(message=>message[0]==='execution_error');
      const interrupted=messages.some(message=>message[0]==='execution_interrupted');
      if(status.status_str==='error'||failure||interrupted){
        await finishFailure(failure?.[1]?.exception_message||'The image graph stopped. Your inputs are retained.',interrupted);return;
      }
    }
  }catch(error){if(state.activePromptId===id&&epoch===state.generationEpoch&&force)showError('Reconnecting to the saved image. '+error.message);}
  finally{if(historyPollRequest===request)historyPollRequest=null;if(epoch===state.generationEpoch&&state.activePromptId)historyPollTimer=setTimeout(()=>pollHistory(false),2000);}
}
async function completeGeneration(file,history){
  if(state.completing)return;state.completing=true;
  const epoch=state.generationEpoch,id=state.activePromptId,filename=file.filename,settings=state.settings||{};
  if(state.completionObservation?.id!==id||state.completionObservation?.filename!==filename){const timing=H3TimingEstimator.measured(history);state.completionObservation={id,filename,elapsed:timing?.seconds??(Date.now()-state.started)/1000,timing,modified:Date.now()/1000};try{saveActiveJob();}catch{}}
  const observation=state.completionObservation,elapsed=observation.elapsed;
  settings.timingMeasurement=observation.timing||{source:'browser',seconds:elapsed};
  try{
    const response=await fetch(api('/h3_studio/image_details'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename,render_seconds:elapsed,settings}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Image settings could not be saved.');
    if(epoch!==state.generationEpoch||id!==state.activePromptId)return;
    stopImagePolling();state.activePromptId=null;sessionStorage.removeItem('qwen.activePromptId');sessionStorage.removeItem('qwen.activeJob');await cleanupUploads();if(epoch!==state.generationEpoch)return;setBusy(false);setProgress('Completed',100,0);$('timer').textContent='Actual time: '+fmt(elapsed);await loadLibrary(true);if(epoch!==state.generationEpoch)return;showImage(state.results.find(item=>item.filename===filename)||{filename,settings});showError('');
  }catch(error){if(epoch===state.generationEpoch&&id===state.activePromptId){if(!observation.previewShown){showImage({filename,settings,modified:observation.modified});observation.previewShown=true;}showError('Image rendered. Retrying settings save after a connection error. '+error.message);}throw error;}
  finally{state.completing=false;}
}
function imageUrl(entry){return api("/h3_studio/image_file?"+new URLSearchParams({filename:entry.filename,_time:String(entry.modified||Date.now())}));}
function showImage(entry){state.current=entry;const image=document.createElement("img");image.src=imageUrl(entry);image.alt="Generated Qwen image";$("stage").replaceChildren(image);$("currentActions").classList.remove("hidden");}
async function useCurrentImage(replace){
  if(state.busy||!state.referencesReady||!state.current)return;
  if(!replace&&state.refs.length>=10){showError('Remove a reference before adding another image.');return;}
  const current=state.current;
  const epoch=state.generationEpoch;
  try{
    const response=await fetch(imageUrl(current));if(!response.ok)throw Error('Could not load the selected image.');
    const file=new File([await response.blob()],current.filename,{type:'image/png'});
    const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
    if(state.busy||epoch!==state.generationEpoch||!state.referencesReady)return;
    if(!replace&&state.refs.length>=10)throw Error('Remove a reference before adding another image.');
    if(replace){for(const ref of state.refs)URL.revokeObjectURL(ref.url);state.refs=[];$('prompt').value='';$('imageWorkflow').value='general';$('customSize').checked=false;}
    state.refs.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),name:suggestedName(file),role:'context',instructions:'',width,height});
    renderRefs();saveDraft();showError('');
  }catch(error){showError(error.message);}
}
$('editCurrent').onclick=()=>useCurrentImage(true);
$('addCurrentReference').onclick=()=>useCurrentImage(false);
async function loadLibrary(force=false){
  try{const response=await fetch(api("/h3_studio/image_library"),{cache:"no-store"});if(!response.ok)throw Error();state.results=(await H3RenderValues.readJson(response)).items||[];renderLibrary();}catch{if(force)showError("Could not refresh the generated image library.");}
}
function renderLibrary(){
  updateSettings();
  $("results").replaceChildren();$("imageCount").textContent=`(${state.results.length} on server)`;$("emptyHistory").classList.toggle("hidden",!!state.results.length);const remaining=Math.max(0,state.results.length-state.visible);$("showMore").classList.toggle("hidden",!remaining);$("showMore").textContent=`Show ${Math.min(8,remaining)} more · ${remaining} remaining`;
  state.results.slice(0,state.visible).forEach((entry,index)=>{const card=document.createElement("div");card.className="result";const open=document.createElement("button");open.className="result-open";open.type="button";const media=document.createElement("div");media.className="result-media";const image=document.createElement("img");image.src=imageUrl(entry);image.loading="lazy";image.alt=`Generated image ${index+1}`;media.append(image);const label=document.createElement("div");label.className="result-label";label.textContent=`${entry.width} × ${entry.height} · ${(entry.settings?.profile||"Qwen").toUpperCase()}`;const small=document.createElement("small");small.textContent=new Date(entry.modified*1000).toLocaleString()+(entry.render_seconds?" · "+fmt(entry.render_seconds):"");label.append(small);open.append(media,label);open.onclick=()=>showImage(entry);const actions=document.createElement("div");actions.className="result-card-actions";const details=document.createElement("button");details.type="button";details.textContent="Details";details.onclick=()=>openDetails(entry,details);const remove=document.createElement("button");remove.type="button";remove.textContent="Delete";remove.setAttribute("aria-label",`Delete generated image ${index+1}`);remove.onclick=()=>deleteEntry(entry);const download=document.createElement("button");download.type="button";download.textContent="Download";download.setAttribute("aria-label",`Download generated image ${index+1}`);download.onclick=()=>downloadImageEntry(entry);actions.append(download,details,remove);card.append(open,actions);$("results").append(card);});
}
function openDetails(entry,trigger){const data=entry.settings||{};const content=$("detailsContent");content.replaceChildren();const grid=document.createElement("dl");grid.className="settings";const row=(key,value)=>{const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=key;dd.textContent=value===undefined||value===null||value===""?"—":String(value);grid.append(dt,dd);};row("Inputs",data.mode==="edit"?"Prompt + references":"Prompt only");row("Precision",data.profile?.toUpperCase());row("Canvas",`${entry.width||data.width} × ${entry.height||data.height}`);row("LoRA",data.lora||"None");row("LoRA strength",data.lora?data.loraStrength:"—");row("Steps",data.steps);row("Seed",data.seed);row("Transparent",data.transparent?"Yes":"No");row("References",Array.isArray(data.referenceNames)?data.referenceNames.map((name,index)=>`@${name} → image${index+1}`).join(", "):Array.isArray(data.references)?data.references.length:0);row("Render time",entry.render_seconds?fmt(entry.render_seconds):"—");row("Workflow",data.workflow||"general");row("Reference roles",JSON.stringify(data.referencePlan||[]));row("Guidance",data.cfg??1);row("Negative prompt",data.negativePrompt||data.negative_prompt);row("Cache",(data.cacheDevice||data.cache_device||"auto")+" / "+(data.cacheDtype||data.cache_dtype||"default"));row("Prompt",data.sourcePrompt||data.prompt);row("Resolved prompt",data.prompt);content.append(grid);$("detailsDialog").showModal();$("detailsDialog").dataset.returnId=trigger?.id||"";}
$("closeDetails").onclick=()=>$("detailsDialog").close();$("detailsDialog").onclick=event=>{if(event.target===$("detailsDialog"))$("detailsDialog").close();};
$("details").onclick=event=>state.current&&openDetails(state.current,event.currentTarget);
function downloadImageEntry(entry){if(!entry)return;const a=document.createElement("a");a.href=imageUrl(entry);a.download=entry.filename;document.body.append(a);a.click();a.remove();}
$("download").onclick=()=>downloadImageEntry(state.current);
async function deleteEntry(entry){if(!entry||!confirm("Delete this generated image from the server? This cannot be undone."))return;try{const response=await fetch(api("/h3_studio/delete_image"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:entry.filename})});if(!response.ok)throw Error();if(state.current?.filename===entry.filename){state.current=null;$("currentActions").classList.add("hidden");showStage("Image deleted","Generate another image or select one from the library.");}state.results=state.results.filter(item=>item.filename!==entry.filename);renderLibrary();showError("");await loadLibrary(false);}catch{showError("The image could not be deleted. Retry after reconnecting.");}}
if($("sendToH3")) $("sendToH3").onclick = async () => {
  if(!state.current) return;
  const role = $("h3HandoffRole")?.value || "reference";
  try {
    const res = await fetch(api("/h3_studio/lab/import_qwen_image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_filename: state.current.filename,
        project_id: state.currentProject?.project_id || undefined,
        as_role: role,
        alias: (state.current.filename.replace(/\.[^.]+$/, "")).slice(-8)
      })
    });
    if(!res.ok) throw new Error((await res.text()).slice(0, 200));
    const data = await H3RenderValues.readJson(res);
    sessionStorage.setItem("h3_lab.imported_handoff", JSON.stringify({
      asset: data.asset,
      as_role: role
    }));
    window.location.href = "index.html";
  } catch(e) {
    showError("Handoff to H3 failed: " + e.message);
  }
};
$("deleteCurrent").onclick=()=>deleteEntry(state.current);$("refreshLibrary").onclick=()=>loadLibrary(true);$("showMore").onclick=()=>{state.visible+=8;renderLibrary();};
$("randomSeed").onclick=()=>{if(state.busy)return;$("seed").value=H3RenderValues.randomSeed();saveDraft();};
for(const id of [...imageExtraControls,"prompt","aspect","resolution","steps","seed","transparent","referenceResolution","customSize","fitReferences","lora","loraStrength"]){$(id).addEventListener("input",()=>{if(id==="aspect"||id==="resolution")$("customSize").checked=true;updateSettings();saveDraft();if(id==="prompt")renderMentions();refreshPromptPreview();});}
window.addEventListener("focus",()=>loadLibrary(false));
state.timer=setInterval(()=>{if(state.busy&&state.started){const elapsed=(Date.now()-state.started)/1000;$("timer").textContent="Elapsed: "+fmt(elapsed);if(!state.lastStepAt){const estimate=estimateSeconds();$("remaining").textContent=estimate===null?'Time remaining: collecting measurements':'Time remaining: '+fmt(Math.max(0,estimate-elapsed));}}},1000);
async function resume(){if(!state.activePromptId)return;let job={};try{job=JSON.parse(sessionStorage.getItem("qwen.activeJob")||"{}");}catch{}if(job.promptId===state.activePromptId){state.settings=job.settings||null;const observation=job.completionObservation;if(observation?.id===state.activePromptId&&Number.isFinite(observation.elapsed)&&observation.elapsed>=0&&Number.isFinite(observation.modified)){state.completionObservation={...observation,previewShown:false};}state.pendingToken=job.pendingToken||null;state.started=Number(job.started)||Date.now();state.uploaded=Array.isArray(job.uploaded)?job.uploaded:[];state.lastStep=Number(job.lastStep)||0;state.stepTotal=Number(job.stepTotal)||0;state.stepTimes=Array.isArray(job.stepTimes)?job.stepTimes:[];}else{state.started=Date.now();}setBusy(true);setProgress("Restoring active generation",5,null,true);if(state.lastStep&&state.stepTotal)setProgress(`Sampling · ${state.lastStep}/${state.stepTotal}`,12+Math.round(78*state.lastStep/state.stepTotal),null);openSocket();pollQueue();pollHistory(false);}
function imageLabServerKey(){
  return sessionStorage.getItem("h3studio.comfyBase")||location.origin;
}
function preferredImageProjectId(){
  const fromUrl=new URLSearchParams(location.search).get("project");
  if(fromUrl)return fromUrl;
  return sessionStorage.getItem("qwen.imageProjectId")||sessionStorage.getItem(`h3_lab.${imageLabServerKey()}.active_project_id`)||"";
}
function syncImageProjectSelection(projectId){
  state.activeProjectId=projectId||null;
  if(projectId){
    sessionStorage.setItem("qwen.imageProjectId",projectId);
    sessionStorage.setItem(`h3_lab.${imageLabServerKey()}.active_project_id`,projectId);
  }else{
    sessionStorage.removeItem("qwen.imageProjectId");
  }
}
function imageElementCategories(project){
  const list=Array.isArray(project?.asset_categories)&&project.asset_categories.length?project.asset_categories:[
    {id:"characters",name:"Characters",role:"character identity"},
    {id:"locations",name:"Locations",role:"location"},
    {id:"props",name:"Props",role:"object"},
    {id:"styles",name:"Style",role:"visual style"},
    {id:"storyboards",name:"Storyboards",role:"storyboard"},
    {id:"custom",name:"Custom",role:"custom"}
  ];
  return list.filter(cat=>cat&&cat.id!=="audio"&&cat.role!=="voice");
}
function populateImageElementCategories(project){
  const categories=imageElementCategories(project);
  const filter=$("imageElementCategoryFilter");
  if(filter){
    const current=filter.value||"all";
    filter.replaceChildren();
    const allOpt=document.createElement("option");allOpt.value="all";allOpt.textContent="All categories";filter.append(allOpt);
    for(const cat of categories){const opt=document.createElement("option");opt.value=cat.id;opt.textContent=cat.name;filter.append(opt);}
    filter.value=[...filter.options].some(o=>o.value===current)?current:"all";
  }
  const saveCat=$("saveElementCategory");
  if(saveCat){
    const current=saveCat.value||"props";
    saveCat.replaceChildren();
    for(const cat of categories){const opt=document.createElement("option");opt.value=cat.id;opt.textContent=cat.name;saveCat.append(opt);}
    saveCat.value=[...saveCat.options].some(o=>o.value===current)?current:(categories[0]?.id||"custom");
  }
}
function renderProjectElements(){
  const list=$("imageElementsList"),status=$("imageElementsStatus"),count=$("imageElementsCount");
  if(!list||!status||!count)return;
  list.replaceChildren();
  const project=state.currentProject;
  if(!project){
    count.textContent=state.projects.length?"Select project":"Optional";
    status.textContent=state.projects.length?"Choose a project to browse its Characters, Props, Locations and other Elements.":"No project yet. Upload an element or save a generated image to create one.";
    return;
  }
  const categories=imageElementCategories(project);
  const categoryName=id=>categories.find(c=>c.id===id)?.name||(project.asset_categories||[]).find(c=>c.id===id)?.name||"Custom";
  const allImages=(project.assets||[]).filter(asset=>asset&&asset.asset_id&&asset.kind==="image"&&!asset.catalog_hidden);
  const selectedCat=$("imageElementCategoryFilter")?.value||"all";
  const query=($("imageElementSearch")?.value||"").trim().toLowerCase();
  const filtered=allImages.filter(asset=>{
    if(selectedCat!=="all"&&(asset.category||"custom")!==selectedCat)return false;
    if(!query)return true;
    const hay=[asset.name,asset.alias,asset.notes,categoryName(asset.category)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(query);
  });
  count.textContent=`${allImages.length} element${allImages.length===1?"":"s"}`;
  if(!allImages.length){
    status.textContent="This project has no image elements yet. Upload one here or save a generated image to Elements.";
    return;
  }
  if(!filtered.length){
    status.textContent="No elements match the selected category or search.";
    return;
  }
  status.textContent=`${filtered.length} of ${allImages.length} shown · click + Use to attach with mapped role and @mention`;
  for(const asset of filtered){
    const card=document.createElement("div");
    const attached=state.refs.find(ref=>ref.assetId===asset.asset_id);
    card.className="element-card"+(attached?" attached":"");
    card.dataset.assetId=asset.asset_id;
    const thumb=document.createElement("img");
    thumb.src=api(`/h3_studio/lab/assets/${encodeURIComponent(asset.asset_id)}/thumbnail`);
    thumb.loading="lazy";
    thumb.alt=asset.name||asset.alias||"Project element";
    thumb.onerror=()=>{if(!thumb.dataset.fallback){thumb.dataset.fallback="1";thumb.src=api(`/h3_studio/lab/assets/${encodeURIComponent(asset.asset_id)}/file`);}};
    const meta=document.createElement("div");meta.className="element-meta";
    const title=document.createElement("strong");title.textContent=asset.name||asset.alias||"Element";
    const sub=document.createElement("small");
    const badge=document.createElement("span");badge.className="element-badge";badge.textContent=categoryName(asset.category);
    const mappedRole=QwenReferencePlan.roleFromElement(asset,project.asset_categories||[]);
    const mentionLabel=attached?`@${attached.name}`:`@${QwenReferencePlan.elementAlias(asset,[])}`;
    sub.append(badge,document.createTextNode(`${mentionLabel} · ${QwenReferencePlan.roles[mappedRole]||mappedRole}`));
    meta.append(title,sub);
    const btn=document.createElement("button");btn.type="button";btn.className="button alt small";
    btn.disabled=state.busy||!state.referencesReady;
    if(attached){
      btn.textContent=`Insert @${attached.name}`;
      btn.title=`Already attached as @${attached.name}. Click to insert into prompt.`;
      btn.onclick=()=>{insertMention(attached.name);$("prompt").scrollIntoView({behavior:"smooth",block:"center"});};
    }else{
      btn.textContent="+ Use";
      btn.title=`Attach ${asset.name||asset.alias} as Qwen reference (${QwenReferencePlan.roles[mappedRole]||mappedRole})`;
      btn.onclick=()=>void attachProjectElement(asset,btn);
    }
    card.append(thumb,meta,btn);
    list.append(card);
  }
}
async function attachProjectElement(asset,triggerButton=null){
  if(state.busy||!state.referencesReady||!asset?.asset_id)return;
  const existing=state.refs.find(ref=>ref.assetId===asset.asset_id);
  if(existing){insertMention(existing.name);return;}
  if(state.refs.length>=10){showError("Qwen Image supports up to 10 images. Remove a reference before adding this element.");return;}
  if(triggerButton){triggerButton.disabled=true;triggerButton.textContent="Adding…";}
  const epoch=state.generationEpoch;
  try{
    const response=await fetch(api(`/h3_studio/lab/assets/${encodeURIComponent(asset.asset_id)}/file`),{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error(`Could not load project element (HTTP ${response.status}).`);
    const blob=await response.blob();
    if(!blob.size||blob.size>25*1024*1024)throw Error("Project element image must be non-empty and under 25 MB.");
    const ext=(asset.server_path||"").match(/\.(png|jpe?g|webp)$/i)?.[0]||".png";
    const rawName=(asset.name||asset.alias||"element").replace(/[\\/:*?"<>|]+/g,"_");
    const filename=/\.(png|jpe?g|webp)$/i.test(rawName)?rawName:rawName+ext;
    const mime=blob.type&&blob.type.startsWith("image/")?blob.type:(ext.toLowerCase()===".webp"?"image/webp":/\.jpe?g$/i.test(ext)?"image/jpeg":"image/png");
    const file=new File([blob],filename,{type:mime});
    let width=0,height=0;
    try{const bitmap=await createImageBitmap(file);width=bitmap.width;height=bitmap.height;bitmap.close();}catch{}
    if(state.busy||epoch!==state.generationEpoch||!state.referencesReady)return;
    if(state.refs.some(ref=>ref.assetId===asset.asset_id))return;
    if(state.refs.length>=10)throw Error("Qwen Image supports up to 10 images. Remove a reference before adding this element.");
    const categories=state.currentProject?.asset_categories||[];
    const role=QwenReferencePlan.roleFromElement(asset,categories);
    const alias=QwenReferencePlan.elementAlias(asset,state.refs.map(ref=>ref.name));
    const categoryName=categories.find(c=>c.id===asset.category)?.name||"Custom";
    state.refs.push({
      id:crypto.randomUUID(),file,url:URL.createObjectURL(file),name:alias,role,
      instructions:String(asset.notes||"").trim(),width,height,
      assetId:asset.asset_id,projectId:state.currentProject?.project_id||null,elementCategory:categoryName
    });
    renderRefs();saveDraft();showError("");
  }catch(error){
    showError(error.message||"Could not attach project element.");
    renderProjectElements();
  }
}
async function loadImageProject(projectId){
  if(!projectId){state.currentProject=null;syncImageProjectSelection(null);populateImageElementCategories(null);renderProjectElements();return null;}
  state.projectElementsLoading=true;
  if($("imageElementsStatus"))$("imageElementsStatus").textContent="Loading project elements…";
  try{
    const res=await fetch(api(`/h3_studio/lab/projects/${encodeURIComponent(projectId)}`),{cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    const project=await H3RenderValues.readJson(res);
    state.currentProject=project;
    syncImageProjectSelection(project.project_id);
    if($("imageProjectSelect"))$("imageProjectSelect").value=project.project_id;
    populateImageElementCategories(project);
    renderProjectElements();
    return project;
  }catch(error){
    state.currentProject=null;
    populateImageElementCategories(null);
    renderProjectElements();
    if($("imageElementsStatus"))$("imageElementsStatus").textContent="Could not load project elements: "+error.message;
    return null;
  }finally{state.projectElementsLoading=false;}
}
async function loadImageProjects(force=false){
  const select=$("imageProjectSelect");
  if(!select)return;
  try{
    const res=await fetch(api("/h3_studio/lab/projects"),{cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    const data=await H3RenderValues.readJson(res);
    state.projects=Array.isArray(data.projects)?data.projects:[];
    const desired=state.activeProjectId||preferredImageProjectId();
    select.replaceChildren();
    const empty=document.createElement("option");empty.value="";empty.textContent=state.projects.length?"Choose project…":"No projects yet";select.append(empty);
    for(const proj of state.projects){
      const opt=document.createElement("option");opt.value=proj.project_id;
      opt.textContent=`${proj.name} (${proj.asset_count||0})`;
      select.append(opt);
    }
    const targetId=state.projects.some(p=>p.project_id===desired)?desired:(state.projects[0]?.project_id||"");
    select.value=targetId;
    if(targetId)await loadImageProject(targetId);
    else{state.currentProject=null;populateImageElementCategories(null);renderProjectElements();}
  }catch(error){
    if(force&&$("imageElementsStatus"))$("imageElementsStatus").textContent="Project Elements unavailable: "+error.message;
    else renderProjectElements();
  }
}
async function ensureImageElementsProject(){
  if(state.currentProject?.project_id)return state.currentProject;
  const res=await fetch(api("/h3_studio/lab/projects"),{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:"Image Elements",request_id:crypto.randomUUID()})
  });
  if(!res.ok)throw Error("Could not create a project for Elements.");
  const created=await H3RenderValues.readJson(res);
  syncImageProjectSelection(created.project_id);
  await loadImageProjects(false);
  return state.currentProject||created;
}
async function uploadFilesToElements(files){
  if(state.busy||!files?.length)return;
  try{
    const project=await ensureImageElementsProject();
    const filterVal=$("imageElementCategoryFilter")?.value||"all";
    const category=filterVal!=="all"?filterVal:"custom";
    for(const file of files){
      if(!/\.(png|jpe?g|webp)$/i.test(file.name)||!file.size||file.size>25*1024*1024){
        showError("Use non-empty PNG, JPG or WebP images under 25 MB.");continue;
      }
      const existingNames=(state.currentProject?.assets||[]).filter(a=>!a.catalog_hidden).map(a=>a.name||a.alias);
      const uniqueName=QwenReferencePlan.elementAlias({name:file.name},existingNames);
      const query=new URLSearchParams({filename:file.name,project_id:project.project_id,category,name:uniqueName});
      const res=await fetch(api("/h3_studio/lab/assets?"+query),{method:"POST",body:file,headers:{"Content-Type":"application/octet-stream"}});
      if(!res.ok){let msg=`HTTP ${res.status}`;try{msg=(await res.json()).error||msg;}catch{}throw Error(msg);}
      await loadImageProject(project.project_id);
    }
    showError("");
  }catch(error){showError("Element upload failed: "+error.message);}
}
async function saveCurrentImageToElements(){
  if(state.busy||!state.current)return;
  const btn=$("saveToElements");
  if(btn){btn.disabled=true;btn.textContent="Saving…";}
  try{
    const project=await ensureImageElementsProject();
    const category=$("saveElementCategory")?.value||"custom";
    const typed=($("saveElementName")?.value||"").trim();
    const existingNames=(project.assets||[]).filter(a=>!a.catalog_hidden).map(a=>a.name||a.alias);
    const name=typed||QwenReferencePlan.elementAlias({name:state.current.filename.replace(/^qwen_studio_/,"qwen_")},existingNames);
    const res=await fetch(api("/h3_studio/lab/import_qwen_image"),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({image_filename:state.current.filename,project_id:project.project_id,as_role:"reference",category,name})
    });
    if(!res.ok){let msg=`HTTP ${res.status}`;try{msg=(await res.json()).error||msg;}catch{}throw Error(msg);}
    const data=await H3RenderValues.readJson(res);
    if(data.project){state.currentProject=data.project;populateImageElementCategories(data.project);renderProjectElements();}
    else await loadImageProject(project.project_id);
    if($("saveElementName"))$("saveElementName").value="";
    if($("imageElementsStatus"))$("imageElementsStatus").textContent=`Saved "${name}" to Project Elements.`;
    showError("");
  }catch(error){showError("Save to Elements failed: "+error.message);}
  finally{if(btn){btn.disabled=state.busy;btn.textContent="Save to Elements";}}
}
if($("imageProjectSelect"))$("imageProjectSelect").onchange=()=>void loadImageProject($("imageProjectSelect").value);
if($("refreshImageElements"))$("refreshImageElements").onclick=()=>void loadImageProjects(true);
if($("imageElementCategoryFilter"))$("imageElementCategoryFilter").onchange=renderProjectElements;
if($("imageElementSearch"))$("imageElementSearch").oninput=renderProjectElements;
if($("uploadImageElement"))$("uploadImageElement").onclick=()=>{if(!state.busy)$("uploadImageElementFile").click();};
if($("uploadImageElementFile"))$("uploadImageElementFile").onchange=async()=>{const files=[...$("uploadImageElementFile").files];$("uploadImageElementFile").value="";await uploadFilesToElements(files);};
if($("saveToElements"))$("saveToElements").onclick=()=>void saveCurrentImageToElements();

async function initialize(){
  restoreDraft();
  $("addReferences").disabled=true;
  try{
    const saved=await QwenReferenceStore.load();
    state.refs=saved.filter(ref=>ref&&ref.file instanceof Blob&&ref.file.size>0&&ref.file.size<=25*1024*1024
      &&typeof ref.file.name==='string'&&/\.(png|jpe?g|webp)$/i.test(ref.file.name)&&validName(ref.name)).slice(0,10)
      .map(ref=>({...ref,id:ref.id||crypto.randomUUID(),url:URL.createObjectURL(ref.file)}));
    await Promise.all(state.refs.filter(ref=>!ref.width||!ref.height).map(async ref=>{
      try{const bitmap=await createImageBitmap(ref.file);ref.width=bitmap.width;ref.height=bitmap.height;bitmap.close();}catch{}
    }));
    state.refsSaved=true;
    state.referencesReady=true;
    $("addReferences").disabled=false;
    referenceSignature=JSON.stringify(state.refs.map(ref=>[ref.id,ref.name,ref.width,ref.height,ref.role,ref.instructions,ref.assetId||'',ref.projectId||'',ref.elementCategory||'']));
  }catch(error){
    showError('Saved references could not be restored. Reload to retry, or continue for this session: '+error.message);
    const continueButton=document.createElement('button');continueButton.type='button';continueButton.className='button alt small';
    continueButton.textContent='Continue without saved references';
    continueButton.onclick=()=>{state.referencesReady=true;state.referencesSessionOnly=true;$("addReferences").disabled=false;showError('References are available for this session only. Reload to retry browser storage.');updateSettings();setBusy(state.busy);};
    $("error").append(continueButton);
  }
  renderRefs();updateSettings();loadLibrary(false);void loadImageProjects(false);await checkConnection();await resume();
}
void initialize();

const clearImageSetup=document.createElement('button');clearImageSetup.id='clearImageSetup';clearImageSetup.type='button';clearImageSetup.className='button alt small';clearImageSetup.textContent='Clear this tab’s setup';$('addReferences').parentElement.append(clearImageSetup);
clearImageSetup.onclick=async()=>{
 if(state.busy||state.refsSaving||!state.referencesReady)return;
 if(!confirm('Clear this tab’s image inputs and settings? Generated images remain.'))return;
 for(const ref of state.refs)URL.revokeObjectURL(ref.url);state.refs=[];
 for(const id of ['prompt','negativePrompt','steps','seed','loraStrength'])$(id).value=$(id).defaultValue;
 for(const id of ['profile','aspect','resolution','referenceResolution','lora','imageWorkflow','imageGuidance','cacheDevice','cacheDtype']){const el=$(id);el.value=[...el.options].find(o=>o.defaultSelected)?.value||el.options[0]?.value;}
 $('transparent').checked=false;$('customSize').checked=false;$('fitReferences').checked=true;
 state.baselineSteps='40';state.turboControls=false;
 renderRefs();saveDraft();await referenceWrite;updateSettings();
};
addEventListener('beforeunload',event=>{saveDraft();if(state.refsSaving){event.preventDefault();event.returnValue='';}});

setInterval(()=>{
 if(!state.referencesReady||state.referencesSessionOnly||state.refsSaving||!state.refs.length)return;
 const snapshot=state.refs.map(ref=>({id:ref.id,file:ref.file,name:ref.name,width:ref.width,height:ref.height,role:ref.role||"context",instructions:ref.instructions||"",...(ref.assetId?{assetId:ref.assetId}:{}),...(ref.projectId?{projectId:ref.projectId}:{}),...(ref.elementCategory?{elementCategory:ref.elementCategory}:{})}));
 referenceWrite=referenceWrite.then(()=>QwenReferenceStore.save(snapshot)).catch(error=>{showError('Saved reference storage needs attention: '+error.message);});
},60000);
