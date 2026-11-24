/** Explicit owner visual-definition addendum. Not Script Analysis inference.
 * Published canonical references remain unchanged until separate reviewed Publish. */
import {contentHash,type StyleBible} from './contracts.js';
import type {ApprovedScriptSnapshot} from './scriptAnalysis.js';
export interface OwnerVisualDefinition{
  charId:string;styleBibleSha:string;sourceScriptSha:string;sourceAuthoringSha:string;
  provenance:'SCRIPT_AUTHOR'|'OWNER_BRIEF';evidence:string;traits:string[];
  approvedByOwner:true;approvedAt:string;definitionSha:string;
}
const scalarStrings=(value:unknown):string[]=>{
  if(typeof value==='string')return[value];
  if(Array.isArray(value))return value.flatMap(scalarStrings);
  if(value&&typeof value==='object')return Object.values(value).flatMap(scalarStrings);
  return[];
};
export function ownerVisualDefinitionDigest(def:Omit<OwnerVisualDefinition,'definitionSha'>){
  return contentHash({domain:'f24-approved-visual-definition-v1',...def});
}
export function validateOwnerVisualDefinition(value:OwnerVisualDefinition,
  script:ApprovedScriptSnapshot,bible:StyleBible):OwnerVisualDefinition{
  if(!value||value.approvedByOwner!==true||
    !['SCRIPT_AUTHOR','OWNER_BRIEF'].includes(value.provenance)||
    !bible.characters.some(row=>row.char_id===value.charId)||
    value.styleBibleSha!==bible.style_bible_sha256||
    value.sourceScriptSha!==script.sha256||
    value.sourceAuthoringSha!==contentHash(script.authoring)||
    !Array.isArray(value.traits)||value.traits.length<1||value.traits.length>30||
    value.traits.some(trait=>typeof trait!=='string'||!trait.trim()||trait.length>300)||
    new Set(value.traits).size!==value.traits.length||
    typeof value.evidence!=='string'||value.evidence.length<8||
    value.evidence.length>4000||
    !Number.isFinite(Date.parse(value.approvedAt)))
    throw Error('OWNER_VISUAL_DEFINITION_INVALID');
  if(value.provenance==='SCRIPT_AUTHOR'){
    const text=scalarStrings(script.authoring);
    if(!text.some(piece=>piece.includes(value.evidence)))
      throw Error('OWNER_VISUAL_AUTHORING_EVIDENCE_MISSING');
  }
  const {definitionSha,...withoutSha}=value;
  if(ownerVisualDefinitionDigest(withoutSha)!==definitionSha)
    throw Error('OWNER_VISUAL_DEFINITION_SHA_INVALID');
  return value;
}
