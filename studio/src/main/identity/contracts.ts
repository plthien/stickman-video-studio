/** F24 typed upstream identity contracts. This file is deliberately separate from
 * externalTasks.Stage ('script' | 'native'). No renderer manifest changes. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';

export type CharacterId = `char_${string}`;
export type IdentityReviewOperation = 'author'|'review'|'correct'|'recheck';
export type ImageRelation = 'same_setup'|'match_subject'|'match_location'|
  'match_composition'|'graphic_sequence';
export interface Span {section_id:string;quote:string;start:number;end:number}
export interface PresenceRange {start:number;end:number}
export type VisualTraitRelationship='intrinsic_appearance'|'stable_wardrobe'|
  'transient_object'|'transient_action'|'scene_state'|'requires_owner_review';
export interface VisualTraitEvidence {
  trait:string;source:Span;relationship:VisualTraitRelationship;
}
export interface ScriptCharacter {
  char_id:CharacterId;label:string;description:string;
  narrative_role:string;explicit_visual_traits:string[];
  /** Optional only to read older F24 candidates. Missing evidence is NEVER
   * approved to enter canonical reference prompts. */
  visual_trait_evidence?:VisualTraitEvidence[];
  identity_markers:string[];
  continuity_notes:string[];physical_constraints:string[];
  occurrences:Span[];presence_ranges:PresenceRange[];
}
export interface ScriptAnalysis {
  schema:'stickman-script-analysis-v1';project_id:string;
  source_script_sha256:string;source_authoring_sha256:string;
  continuity_catalog:{characters:ScriptCharacter[]};
}
/** Versioned AI design extension; older published v1 snapshots omit it. */
export interface AICharacterDesign {
  char_id:CharacterId;visual_design:string;source_established:string[];
  creative_decisions:string[];reference_prompt:string;
}
export interface StyleDesignCandidate {
  schema:'stickman-ai-style-design-v1';project_id:string;
  analysis_sha256:string;style_profile_sha256:string;characters:AICharacterDesign[];
}
export interface StyleDesignReview {
  schema:'stickman-ai-style-design-review-v1';project_id:string;
  candidate_sha256:string;independent_review:true;approved:boolean;
  findings:Array<{finding_id:string;severity:'P0'|'P1'|'P2';location:string;issue:string;evidence:string}>;
}
export interface BibleCharacter extends ScriptCharacter {
  ai_design?:AICharacterDesign;
  source_definition_hash:string;
  visual_readiness:'READY_FOR_REFERENCE'|'NEEDS_OWNER_DEFINITION';
}
export interface StyleBible {
  schema:'stickman-project-style-bible-v1';project_id:string;
  source_script_sha256:string;source_authoring_sha256:string;
  analysis_sha256:string;style_profile_id:'B1'|'B2'|'B3'|'B4';
  style_profile_sha256:string;style_guidance_sha256:string;
  characters:BibleCharacter[];style_bible_sha256:string;
  automatic_authority?:{version:'automatic-reference-authority-v1'};
  design_authority?:{version:'ai-style-design-v1';candidate_sha256:string;review:StyleDesignReview};
}
export interface NativeImageNeedV2 {
  shot_id:string;layer_id:string;expected_path:string;content:string;
  orientation?:'9:16'|'16:9'|'1:1'|'3:4'|'4:3';
  output?:import('../assetPreparation.js').AssetOutput;
  asset_kind:'background'|'character'|'pose'|'prop'|'object'|'other';
  character_ids:CharacterId[];
  continuity_source?:{shot_id:string;layer_id:string;relation:ImageRelation};
}
export function hash(data:Buffer|string){return createHash('sha256').update(data).digest('hex');}
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value as Record<string,unknown>).sort().map(key=>
    JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
export const contentHash=(value:unknown)=>hash(canonical(value));
interface Schema {
  type?:'object'|'array'|'string'|'number'|'integer'|'boolean'|'null';
  const?:unknown;enum?:unknown[];pattern?:string;
  minLength?:number;maxLength?:number;minimum?:number;maximum?:number;
  minItems?:number;maxItems?:number;uniqueItems?:boolean;
  uniqueItemProperties?:string[];additionalProperties?:boolean;
  required?:string[];properties?:Record<string,Schema>;items?:Schema;
  $ref?:string;$defs?:Record<string,Schema>;
}
function validateNode(schema:Schema,value:unknown,root:Schema,location:string):void {
  if(schema.$ref){
    if(!schema.$ref.startsWith('#/$defs/'))throw Error('IDENTITY_SCHEMA_REF_NOT_ALLOWED');
    const name=schema.$ref.slice('#/$defs/'.length),child=root.$defs?.[name];
    if(!child)throw Error('IDENTITY_SCHEMA_REF_MISSING');
    return validateNode(child,value,root,location);
  }
  if('const'in schema&&value!==schema.const)throw Error('IDENTITY_SCHEMA_CONST '+location);
  if(schema.enum&&!schema.enum.includes(value))throw Error('IDENTITY_SCHEMA_ENUM '+location);
  if(schema.type){
    const type=Array.isArray(value)?'array':value===null?'null':
      Number.isInteger(value)?'integer':typeof value;
    if(!(type===schema.type||(schema.type==='number'&&type==='integer')))
      throw Error('IDENTITY_SCHEMA_TYPE '+location);
  }
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&value.length<schema.minLength||
      schema.maxLength!==undefined&&value.length>schema.maxLength||
      schema.pattern!==undefined&&!new RegExp(schema.pattern,'u').test(value))
      throw Error('IDENTITY_SCHEMA_STRING '+location);
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum||
      schema.maximum!==undefined&&value>schema.maximum)throw Error('IDENTITY_SCHEMA_NUMBER '+location);
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems||
      schema.maxItems!==undefined&&value.length>schema.maxItems)
      throw Error('IDENTITY_SCHEMA_ARRAY '+location);
    if(schema.uniqueItems&&new Set(value.map(canonical)).size!==value.length)
      throw Error('IDENTITY_SCHEMA_DUPLICATE '+location);
    for(const key of schema.uniqueItemProperties??[]){
      const mapped=value.map(v=>(v as Record<string,unknown>)?.[key]);
      if(new Set(mapped).size!==mapped.length)throw Error('IDENTITY_SCHEMA_DUPLICATE '+location+'.'+key);
    }
    if(schema.items)value.forEach((entry,index)=>validateNode(schema.items!,entry,root,location+'['+index+']'));
  }
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
    const obj=value as Record<string,unknown>;
    for(const key of schema.required??[]){if(!Object.hasOwn(obj,key))throw Error('IDENTITY_SCHEMA_REQUIRED '+location+'.'+key);}
    for(const [key,field]of Object.entries(obj)){
      if(['__proto__','prototype','constructor'].includes(key))throw Error('IDENTITY_SCHEMA_FORBIDDEN_KEY');
      const child=schema.properties?.[key];
      if(!child){if(schema.additionalProperties===false)throw Error('IDENTITY_SCHEMA_EXTRA '+location+'.'+key);}
      else validateNode(child,field,root,location+'.'+key);
    }
  }
}
/** Runtime enforces the checked-in JSON Schema; no decorative-only schema. */
export function validateWithSchema<T>(schema:Schema,value:unknown):T{
  validateNode(schema,value,schema,'$');return value as T;
}
export function readAndValidate<T>(schema:Schema,text:string):T{
  if(Buffer.byteLength(text,'utf8')>4*1024*1024)throw Error('IDENTITY_JSON_OVERSIZE');
  // Reject duplicate object keys (including nested quote-evidence records).
  // This scanner is whitespace/string-aware; JSON.parse checks the grammar.
  const stack:Array<{kind:'object';keys:Set<string>;expectKey:boolean}|{kind:'array'}>=[];
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      const start=i;let escaped=false;i++;
      for(;i<text.length;i++){
        if(escaped)escaped=false;
        else if(text[i]==='\\')escaped=true;
        else if(text[i]==='"')break;
      }
      if(i>=text.length)throw Error('IDENTITY_JSON_UNTERMINATED_STRING');
      const last=stack.at(-1);
      let j=i+1;while(/\s/.test(text[j]??''))j++;
      if(last?.kind==='object'&&last.expectKey&&text[j]===':'){
        const key=JSON.parse(text.slice(start,i+1)) as string;
        if(last.keys.has(key))throw Error('IDENTITY_JSON_DUPLICATE_KEY '+key);
        if(['__proto__','constructor','prototype'].includes(key))throw Error('IDENTITY_JSON_FORBIDDEN_KEY');
        last.keys.add(key);last.expectKey=false;
      }
      continue;
    }
    if(c==='{')stack.push({kind:'object',keys:new Set(),expectKey:true});
    else if(c==='[')stack.push({kind:'array'});
    else if(c==='}'||c===']')stack.pop();
    else if(c===','){
      const last=stack.at(-1);if(last?.kind==='object')last.expectKey=true;
    }
    if(stack.length>64)throw Error('IDENTITY_JSON_MAX_DEPTH');
  }
  const parsed=JSON.parse(text) as unknown;
  return validateWithSchema<T>(schema,parsed);
}
/** Canonical schema filenames for project-local runtime. */
export const schemas=Object.freeze({
  analysis:'script-analysis-v1.schema.json',
  bible:'style-bible-v1.schema.json',
  need:'native-asset-need-v2.schema.json'
});
export function loadSchema(kind:keyof typeof schemas):Schema{
  const url=new URL('../../../contracts/schemas/identity/'+schemas[kind],import.meta.url);
  return JSON.parse(fs.readFileSync(url,'utf8')) as Schema;
}
