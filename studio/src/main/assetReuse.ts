import {prepareNativeImageTarget} from './imagePreparation.js';
import {readNativeDraft,requireCurrentNativePlan,fulfillMedia,getNativeImageGallery} from './externalTasks.js';
import {readState} from './services.js';
import {createContinuityResolver} from './identity/continuityGraph.js';
import type {AssetDecoder} from './assetPreparation.js';
export async function bindApprovedReuse(appPath:string,root:string,input:{targetKey:string;token:string;candidateSha:string;sourceSha:string;ownerAuthorized:true},decode:AssetDecoder){
 if(input.ownerAuthorized!==true)throw Error('ASSET_REUSE_OWNER_AUTHORIZATION_REQUIRED');
 await requireCurrentNativePlan(appPath,root);
 const draft=readNativeDraft(root),state=readState(root);
 if(!draft||draft.token!==input.token||draft.sha256!==input.candidateSha)throw Error('ASSET_REUSE_DRAFT_STALE');
 const prepared=prepareNativeImageTarget(appPath,root,input.targetKey);
 if(!prepared?.reuseApproved||!prepared.reuseSource||prepared.state!=='READY'||prepared.reuseSource.sha256!==input.sourceSha)throw Error('ASSET_REUSE_NOT_READY');
 const resolver=createContinuityResolver(appPath,root),previous=resolver.resolve(input.targetKey);
 if(!previous||previous.sha256!==input.sourceSha||previous.path!==prepared.reuseSource.path)throw Error('ASSET_REUSE_SOURCE_STALE');
 const source=state.media?.find(m=>m.kind==='image'&&m.path===previous.path&&m.sha256===previous.sha256&&m.rights.trim());
 if(!source)throw Error('ASSET_REUSE_RIGHTS_MISSING');
 return fulfillMedia(appPath,root,draft.token,input.targetKey,previous.path,source.rights,{ownerReviewed:true,decode});
}

const activeReuseBatches=new Set<string>();
export async function bindApprovedReuseBatch(appPath:string,root:string,input:{token:string;candidateSha:string;ownerAuthorized:true;items:Array<{targetKey:string;sourceSha:string}>},decode:AssetDecoder){
 if(input.ownerAuthorized!==true||!Array.isArray(input.items)||!input.items.length||new Set(input.items.map(x=>x.targetKey)).size!==input.items.length)throw Error('ASSET_REUSE_BATCH_AUTHORITY_REQUIRED');
 if(activeReuseBatches.has(root))throw Error('ASSET_REUSE_BATCH_BUSY');activeReuseBatches.add(root);
 try{
   await requireCurrentNativePlan(appPath,root);const draft=readNativeDraft(root);if(!draft||draft.token!==input.token||draft.sha256!==input.candidateSha)throw Error('ASSET_REUSE_DRAFT_STALE');
   const gallery=getNativeImageGallery(appPath,root),order=new Map(gallery.targets.map((t,i)=>[t.key,i]));
   if(input.items.some(item=>!order.has(item.targetKey)||! /^[a-f0-9]{64}$/.test(item.sourceSha)))throw Error('ASSET_REUSE_BATCH_TARGET_INVALID');
   const results:Array<{targetKey:string;status:'BOUND'|'FAILED';detail:string}>=[];
   for(const item of [...input.items].sort((a,b)=>order.get(a.targetKey)!-order.get(b.targetKey)!)){
     try{await bindApprovedReuse(appPath,root,{...item,token:input.token,candidateSha:input.candidateSha,ownerAuthorized:true},decode);results.push({targetKey:item.targetKey,status:'BOUND',detail:'Exact verified approved source bound'});}
     catch(error){results.push({targetKey:item.targetKey,status:'FAILED',detail:error instanceof Error?error.message:String(error)});}
   }return results;
 }finally{activeReuseBatches.delete(root);}
}
