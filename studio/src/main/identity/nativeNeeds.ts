/** Strict, exact current-DRAFT image declarations. Old string asset needs are
 * handled by the old pipeline only when identityPolicy === 'legacy'. */
import {loadSchema,validateWithSchema,contentHash,type StyleBible,
  type NativeImageNeedV2,type ImageRelation} from './contracts.js';
export interface NativeImageTarget {shotId:string;layerId:string;path:string}
/** Cast is explicitly authored and independently reviewed; content is opaque. */
export function validateNativeIdentityNeeds(rows:unknown[],targets:NativeImageTarget[],
  bible:StyleBible,identityPolicy:'legacy'|'v1'){
  if(identityPolicy==='legacy')return{status:'LEGACY' as const,rows:[] as NativeImageNeedV2[],digest:null};
  const byKey=new Map<string,NativeImageNeedV2>();
  const knownIds=new Set(bible.characters.map(c=>c.char_id));
  const order=targets.map(t=>t.shotId+'/'+t.layerId+'/'+t.path);
  if(new Set(order).size!==order.length)throw Error('NATIVE_DUPLICATE_IMAGE_TARGET');
  for(const source of rows){
    const row=validateWithSchema<NativeImageNeedV2>(loadSchema('need'),source);
    const key=row.shot_id+'/'+row.layer_id+'/'+row.expected_path;
    if(row.expected_path.split('/').includes('..')||row.expected_path.includes('//')||
      !row.expected_path.startsWith('assets/images/'))
      throw Error('NATIVE_IDENTITY_UNSAFE_PATH');
    if(!order.includes(key)||byKey.has(key))throw Error('NATIVE_IDENTITY_TARGET_MISMATCH');
    // v1 has no untyped fallback: a missing asset_kind must never disguise
    // a character or pose target as an empty-cast background.
    if(!row.asset_kind)throw Error('NATIVE_IDENTITY_ASSET_KIND_REQUIRED');
    if((row.asset_kind==='character'||row.asset_kind==='pose')&&
      row.character_ids.length===0)
      throw Error('NATIVE_IDENTITY_CHARACTER_CAST_REQUIRED');
    for(const char of row.character_ids){if(!knownIds.has(char))throw Error('NATIVE_IDENTITY_UNKNOWN_CHARACTER');}
    byKey.set(key,row);
  }
  if(byKey.size!==targets.length)throw Error('NATIVE_IDENTITY_DECLARATION_MISSING');
  for(const [key,row]of byKey){
    if(row.continuity_source){
      const relation:ImageRelation=row.continuity_source.relation;
      if(!['same_setup','match_subject','match_location','match_composition','graphic_sequence'].includes(relation))
        throw Error('NATIVE_CONTINUITY_RELATION_INVALID');
      const sourceIndex=targets.findIndex(t=>t.shotId===row.continuity_source?.shot_id&&
        t.layerId===row.continuity_source?.layer_id);
      const targetIndex=order.indexOf(key);
      if(sourceIndex<0||sourceIndex>=targetIndex)throw Error('NATIVE_CONTINUITY_SOURCE_NOT_EARLIER');
    }
  }
  const ordered=order.map(k=>byKey.get(k)!);
  return{status:'READY' as const,rows:ordered,digest:contentHash({
    styleBibleSha:bible.style_bible_sha256,rows:ordered})};
}
