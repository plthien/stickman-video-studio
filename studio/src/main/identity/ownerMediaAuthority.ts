/** Exact owner-approved media authority, without a provider job or semantic inference. */
import {contentHash} from './contracts.js';
import type {StudioState} from '../services.js';
export interface OwnerImageApproval{
  schema:'owner-native-image-approval-v1';approvalId:string;projectId:string;
  draftToken:string;authorTaskId:string;targetKey:string;shotId:string;layerId:string;
  imagePath:string;imageSha:string;rightsSha:string;targetCreativeSha:string;
  targetBindingSha:string;previousDependencySha:string|null;reviewSha:string;
  approvedAt:string;approvalSha:string;
}
export function verifyOwnerImageApproval(state:StudioState,expected:{
  targetKey:string;shotId:string;layerId:string;imagePath:string;imageSha:string;
  targetBindingSha:string;previousDependencySha:string|null;
  draftToken?:string;authorTaskId?:string;targetCreativeSha?:string;approvalId?:string;
}):OwnerImageApproval|null{
  for(const media of state.media??[]){
    const approval=media.ownerImageApproval;
    if(!approval||media.kind!=='image'||media.path!==expected.imagePath||
      media.sha256!==expected.imageSha||media.shotId!==expected.shotId||
      media.layerId!==expected.layerId||!media.rights?.trim())continue;
    const {approvalSha,...body}=approval;
    if(approval.schema!=='owner-native-image-approval-v1'||contentHash(body)!==approvalSha||
      approval.projectId!==state.project.id||approval.rightsSha!==contentHash(media.rights))continue;
    if(Object.entries(expected).every(([key,value])=>approval[key as keyof OwnerImageApproval]===value))return approval;
  }
  return null;
}
