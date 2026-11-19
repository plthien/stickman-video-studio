/** Deterministic projection of an already-authored Native asset requirement.
 * Never invent an image prompt or borrow instructions from another target. */
export interface NativeImageNeedTarget {path:string;shotId?:string;layerId?:string}
const stringField=(row:Record<string,unknown>,...keys:string[]):string=>{
  for(const key of keys){const value=row[key];if(typeof value==='string'&&value.trim())return value.trim();}
  return '';
};
export function nativeImagePromptFromNeeds(needs:unknown[],target:NativeImageNeedTarget|null):string{
  if(!target||!Array.isArray(needs)||!target.path)return '';
  const candidates:Array<{score:number;prompt:string}>=[];
  for(const entry of needs){
    if(typeof entry==='string'){
      // Original Native Author freeform format:
      // MISSING_REQUIRED_VISUAL | project-relative/path.png | IMAGE DESCRIPTION | availability note
      const parts=entry.split(/\s*\|\s*/).map(x=>x.trim());
      if(parts.length>=3&&parts[1]===target.path&&parts[2])
        candidates.push({score:1,prompt:parts[2]});
      continue;
    }
    if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
    const row=entry as Record<string,unknown>;
    const sourcePath=stringField(row,'path','expected_path','target_path','relative_path','asset_path');
    if(sourcePath!==target.path)continue;
    const shotId=stringField(row,'shot_id','shotId'),layerId=stringField(row,'layer_id','layerId');
    if((shotId&&shotId!==target.shotId)||(layerId&&layerId!==target.layerId))continue;
    const prompt=stringField(row,'image_prompt','generation_prompt','prompt',
      'visual_description','content_description','asset_description','content','description','visual_brief');
    if(prompt)candidates.push({score:(shotId?2:0)+(layerId?2:0)+1,prompt});
  }
  if(!candidates.length)return '';
  const best=Math.max(...candidates.map(x=>x.score));
  const prompts=[...new Set(candidates.filter(x=>x.score===best).map(x=>x.prompt))];
  // Conflicting briefs for the same Native asset require explicit owner resolution.
  return prompts.length===1?prompts[0]:'';
}
