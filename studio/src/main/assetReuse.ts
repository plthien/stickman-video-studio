import {prepareNativeImageTarget} from './imagePreparation.js';
import {readNativeDraft,requireCurrentNativePlan,fulfillMedia} from './externalTasks.js';
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
