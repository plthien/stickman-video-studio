/** F24 upstream-to-Native authority. Never changes project.json or renderer Core. */
import {readState,sha} from '../services.js';
import {readIdentityWorkflow,publishedIdentityView,currentApprovedSource} from './identityWorkflow.js';
import {verifyIndependentReview} from './scriptAnalysis.js';
import {compileStyleBible} from './styleBible.js';
import {loadImageStyleProfile} from '../imagePreparation.js';
import {contentHash,type NativeImageNeedV2,type StyleBible} from './contracts.js';
import {validateNativeIdentityNeeds} from './nativeNeeds.js';
import {verifyReferenceFile} from './referencePublication.js';
import {nativeImageTargetsFromManifest,readNativeDraft} from '../externalTasks.js';

export interface ApprovedAnchor{
  charId:string;sourceDefinitionHash:string;path:string;sha256:string;
  mime:'image/png'|'image/jpeg'|'image/webp';rightsSha256:string;
  candidateId:string;approvalEventId:string;
}
export interface ApprovedNativeIdentity{
  policy:'v1';projectId:string;scriptSha:string;authoringSha:string;
  analysisSha:string;styleBibleSha:string;styleProfileSha:string;
  approvalSetSha:string;approvalRevision:number;characters:StyleBible['characters'];
  anchors:ApprovedAnchor[];snapshotSha:string;
}
/** Cheap current-source verification; G-Labs also decodes every actual PNG before POST. */
export function readApprovedNativeIdentity(root:string,appPath:string):ApprovedNativeIdentity{
  const state=readState(root);
  if(state.identityPolicy!=='v1')throw Error('IDENTITY_NATIVE_V1_POLICY_REQUIRED');
  const script=currentApprovedSource(root),
    store=publishedIdentityView(readIdentityWorkflow(root));
  if(!store.draftAnalysis||!store.analysisApproved||
    store.analysisApproved.sha256!==contentHash(store.draftAnalysis)||
    !store.independentReview||
    !verifyIndependentReview(store.independentReview,store.draftAnalysis)||
    store.analysisApproved.reviewSha256!==contentHash(store.independentReview)||
    store.draftAnalysis.source_script_sha256!==script.sha256||
    store.draftAnalysis.source_authoring_sha256!==contentHash(script.authoring))
    throw Error('IDENTITY_NATIVE_ANALYSIS_STALE');
  const style=loadImageStyleProfile(appPath,state.project.style as 'B1'|'B2'|'B3'|'B4');
  const bible=compileStyleBible(store.draftAnalysis,script,{
    id:style.id,guidance:style.guidance,sha256:style.sha256
  });
  if(!store.bible||contentHash(store.bible)!==contentHash(bible)||
    store.bible.style_bible_sha256!==bible.style_bible_sha256||
    store.bibleTextApproved?.sha256!==bible.style_bible_sha256)
    throw Error('IDENTITY_NATIVE_STYLE_BIBLE_STALE');
  const set=store.referenceApprovalSet;
  if(!set||set.project_id!==state.project.id||
    set.source_script_sha256!==script.sha256||
    set.analysis_sha256!==bible.analysis_sha256||
    set.style_bible_sha256!==bible.style_bible_sha256||
    !Number.isSafeInteger(set.revision)||set.revision<1||
    set.entries.length!==bible.characters.length)
    throw Error('IDENTITY_NATIVE_REFERENCE_SET_STALE');
  const {approval_set_sha256:stored,...base}=set;
  if(contentHash(base)!==stored)throw Error('IDENTITY_NATIVE_REFERENCE_SET_TAMPERED');
  if(new Set(set.entries.map(entry=>entry.anchor_id)).size!==set.entries.length)
    throw Error('IDENTITY_NATIVE_REFERENCE_DUPLICATE');
  const anchors:ApprovedAnchor[]=[];
  for(const row of bible.characters){
    const entry=set.entries.find(e=>e.anchor_id===row.char_id&&e.anchor_type==='character'&&
      e.source_definition_hash===row.source_definition_hash);
    const candidate=store.referenceCandidates.find(c=>c.candidate_id===entry?.candidate_id);
    if(!entry||!candidate||candidate.status!=='APPROVED'||
      candidate.approval_event_id!==entry.approval_event_id||
      candidate.anchor_id!==row.char_id||candidate.media_path!==entry.media_path||
      candidate.media_sha256!==entry.media_sha256||
      candidate.media_mime!==entry.media_mime||
      candidate.visual_definition_sha256!==entry.visual_definition_sha256||
      sha(candidate.rights)!==entry.rights_sha256)
      throw Error('IDENTITY_NATIVE_ANCHOR_NOT_APPROVED');
    const evidence=(state.media??[]).find(m=>m.kind==='image'&&
      m.path===entry.media_path&&m.sha256===entry.media_sha256&&
      m.rights===candidate.rights);
    if(!evidence||!state.imports?.includes(entry.media_path))
      throw Error('IDENTITY_NATIVE_APPROVED_MEDIA_LEDGER_REQUIRED');
    verifyReferenceFile(root,entry.media_path,entry.media_sha256,entry.media_mime);
    anchors.push({charId:row.char_id,sourceDefinitionHash:row.source_definition_hash,
      path:entry.media_path,sha256:entry.media_sha256,
      mime:entry.media_mime,rightsSha256:entry.rights_sha256,
      candidateId:entry.candidate_id,approvalEventId:entry.approval_event_id});
  }
  const core={policy:'v1' as const,projectId:state.project.id,scriptSha:script.sha256,
    authoringSha:contentHash(script.authoring),analysisSha:bible.analysis_sha256,
    styleBibleSha:bible.style_bible_sha256,styleProfileSha:style.sha256,
    approvalSetSha:stored,approvalRevision:set.revision,
    characters:bible.characters,anchors};
  return{...core,snapshotSha:contentHash(core)};
}
export interface NativeBindingPlan{
  targetKey:string;shotId:string;layerId:string;path:string;characterIds:string[];
  canonicalAnchors:ApprovedAnchor[];continuitySource:NativeImageNeedV2['continuity_source']|null;
  upstreamSnapshotSha:string;targetBindingSha:string;
}
/** Target-scoped reference identity; never includes global approval revisions. */
export function exactNativeTargetBindingHash(input:{
  targetKey:string;shotId:string;layerId:string;path:string;
  assetKind:NativeImageNeedV2['asset_kind'];characterIds:string[];
  canonicalAnchors:ApprovedAnchor[];
  continuitySource:NativeImageNeedV2['continuity_source']|null;
  styleProfileSha:string;
}):string{
  return contentHash(input);
}
export function validateNativeBindingPayload(root:string,appPath:string,
  manifest:Record<string,unknown>,assetNeeds:unknown[]){
  const identity=readApprovedNativeIdentity(root,appPath);
  const targets=nativeImageTargetsFromManifest(manifest);
  const bible=publishedIdentityView(readIdentityWorkflow(root)).bible;
  if(!bible||bible.style_bible_sha256!==identity.styleBibleSha)
    throw Error('IDENTITY_NATIVE_STYLE_BIBLE_STALE');
  const validated=validateNativeIdentityNeeds(assetNeeds,targets,bible,'v1');
  const rows=validated.rows;
  const plans=targets.map((target,index)=>{
    const row=rows[index],key=target.key;
    const anchors=row.character_ids.map(id=>{
      const value=identity.anchors.find(anchor=>anchor.charId===id);
      if(!value)throw Error('CHARACTER_REFERENCE_REQUIRED: '+id+' '+key);
      return value;
    });
    const base={targetKey:key,shotId:target.shotId,layerId:target.layerId,
      path:target.path,characterIds:[...row.character_ids],canonicalAnchors:anchors,
      continuitySource:row.continuity_source??null,
      upstreamSnapshotSha:identity.snapshotSha};
    // The published SET hash is global; using it for every target would
    // invalidate unrelated images whenever any other actor is replaced.
    // Pin only this layer's cast, canonical bytes/rights and installed style.
    const targetBindingSha=exactNativeTargetBindingHash({
      targetKey:key,shotId:target.shotId,layerId:target.layerId,
      path:target.path,assetKind:row.asset_kind,
      characterIds:base.characterIds,canonicalAnchors:anchors,
      continuitySource:base.continuitySource,
      styleProfileSha:identity.styleProfileSha
    });
    return{...base,targetBindingSha};
  });
  return{identity,rows,digest:validated.digest!,plans};
}
export function resolveNativeTargetBinding(root:string,appPath:string,targetKey:string){
  const draft=readNativeDraft(root);
  if(!draft)throw Error('IDENTITY_NATIVE_DRAFT_REQUIRED');
  const artifact=draft.artifact as unknown as {
    manifest:Record<string,unknown>;asset_needs:unknown[]
  };
  const all=validateNativeBindingPayload(root,appPath,artifact.manifest,artifact.asset_needs);
  const plan=all.plans.find(row=>row.targetKey===targetKey);
  if(!plan)throw Error('IDENTITY_NATIVE_TARGET_NOT_CURRENT');
  const state=readState(root);
  if(!state.tasks?.native||draft.authorTaskId!==state.tasks.native.id)
    throw Error('IDENTITY_NATIVE_DRAFT_TASK_STALE');
  return{...plan,approvalSetSha:all.identity.approvalSetSha,
    styleBibleSha:all.identity.styleBibleSha};
}
