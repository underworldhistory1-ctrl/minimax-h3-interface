(function(root){
  'use strict';
  let database;
  function open(){
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('h3-qwen-reference-drafts',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('draft');
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
      request.onerror=()=>{database=null;reject(request.error);};
      request.onblocked=()=>{database=null;reject(Error('Reference storage is blocked by another browser tab.'));};
    });
    return database;
  }
  async function load(){
    if(root.H3TabDraftStore)return await root.H3TabDraftStore.load('image.references')||[];
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('draft','readonly');
      const request=transaction.objectStore('draft').get('references');
      transaction.oncomplete=()=>resolve(Array.isArray(request.result)?request.result:[]);
      transaction.onabort=transaction.onerror=()=>reject(transaction.error||request.error);
    });
  }
  function serializeReference(ref){
    const item={id:ref.id,file:ref.file,name:ref.name,width:ref.width,height:ref.height,role:ref.role||"context",instructions:ref.instructions||""};
    if(ref.assetId)item.assetId=ref.assetId;
    if(ref.projectId)item.projectId=ref.projectId;
    if(ref.elementCategory)item.elementCategory=ref.elementCategory;
    return item;
  }
  async function save(references){
    const snapshot=references.map(serializeReference);
    if(root.H3TabDraftStore)return root.H3TabDraftStore.save('image.references',snapshot);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('draft','readwrite');
      transaction.objectStore('draft').put(snapshot,'references');
      transaction.oncomplete=()=>resolve();
      transaction.onabort=transaction.onerror=()=>reject(transaction.error||Error('Reference storage failed.'));
    });
  }
  root.QwenReferenceStore={load,save};
})(globalThis);
