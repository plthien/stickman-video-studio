/** One source parser for Native image preparation and target creative fingerprints.
 * Preserve each Author row verbatim; unsupported/partial ownership is NOT global.
 */
export type ImageRequirementFormat='structured'|'legacy-key-value'|'legacy-positional'|'unsupported';
export interface NativeImageRequirement {
  source:unknown;
  format:ImageRequirementFormat;
  scope:'target'|'path'|'global'|'partial'|'unsupported';
  shotId:string;layerId:string;path:string;
  description:string;orientation:string;continuity:string;assetKind:string;
}
export interface ImageRequirementTarget {shotId:string;layerId:string;path:string}
const isObject=(value:unknown):value is Record<string,unknown>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
const read=(row:Record<string,unknown>,names:string[]):string=>{
  for(const name of names)if(typeof row[name]==='string'&&(row[name] as string).trim())
    return (row[name] as string).trim();
  return '';
};
const validPath=(value:string)=>/^assets\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.(?:png|jpe?g)$/i.test(value);
const create=(source:unknown,format:ImageRequirementFormat,row:Record<string,unknown>):NativeImageRequirement=>{
  const shotId=read(row,['shot_id','shotId','target_shot_id','targetShotId']);
  const layerId=read(row,['layer_id','layerId','target_layer_id','targetLayerId']);
  const path=read(row,['expected_path','expectedPath','asset_path','assetPath','path']);
  const global=row.scope==='global'||row.global===true;
  const scope:NativeImageRequirement['scope']=shotId&&layerId?'target':
    (shotId||layerId)?'partial':
    path&&validPath(path)?'path':global&&!path?'global':'unsupported';
  return{source,format,scope,shotId,layerId,path,
    description:read(row,['content','image_description','imageDescription','asset_description','assetDescription','description']),
    orientation:read(row,['orientation','framing','canvas']),
    continuity:read(row,['continuity','visual_constraints','visualConstraints']),
    assetKind:read(row,['asset_kind','assetKind'])};
};
export function normalizeNativeImageRequirement(value:unknown):NativeImageRequirement{
  if(isObject(value))return create(value,'structured',value);
  if(typeof value!=='string')return create(value,'unsupported',{});
  const cells=value.split(/\s+\|\s+/).map(part=>part.trim());
  if(cells[0]!=='MISSING_REQUIRED_VISUAL'||cells.length<3)
    return create(value,'unsupported',{});
  // Key=value Native rows are distinguished by actual field keys, not a
  // freeform description containing an equals sign.
  const keyValue=/^(?:shot_id|layer_id|expected_path|asset_path|path|content|description|orientation|continuity|availability|asset_kind)=/;
  if(cells.slice(1).some(segment=>keyValue.test(segment))){
    const row:Record<string,unknown>={};
    for(const cell of cells.slice(1)){
      const sep=cell.indexOf('=');
      if(sep<1)continue;
      const key=cell.slice(0,sep).trim();
      if(['shot_id','layer_id','expected_path','asset_path','path','content','description',
        'orientation','continuity','availability','asset_kind'].includes(key))
        row[key]=cell.slice(sep+1).trim();
    }
    return create(value,'legacy-key-value',row);
  }
  // Actual Native Author form: STATUS | exact asset path | image brief | availability.
  // The fourth cell is never image content.
  if(cells.length!==4||!validPath(cells[1])||!cells[2])
    return create(value,'unsupported',{});
  return create(value,'legacy-positional',{path:cells[1],content:cells[2]});
}
export function imageRequirementsForTarget(rows:unknown[],target:ImageRequirementTarget){
  const matching:NativeImageRequirement[]=[];
  const conflicting:NativeImageRequirement[]=[];
  const partial:NativeImageRequirement[]=[];
  const global:NativeImageRequirement[]=[];
  for(const source of rows){
    const row=normalizeNativeImageRequirement(source);
    if(row.scope==='global'){global.push(row);continue;}
    if(row.scope==='target'){
      if(row.shotId===target.shotId&&row.layerId===target.layerId){
        if(row.path&&row.path!==target.path)conflicting.push(row);
        else matching.push(row);
      }
    }else if(row.scope==='path'&&row.path===target.path){
      // Shared description: one exact path requirement can describe many
      // occurrences; each occurrence keeps its own Shot/Layer binding.
      matching.push(row);
    }else if(row.scope==='partial'&&
      ((row.path&&row.path===target.path)||(row.shotId&&row.shotId===target.shotId))){
      partial.push(row);
    }
  }
  return{matching,conflicting,partial,global};
}
export function imageRequirementFingerprintSources(rows:unknown[],target:ImageRequirementTarget):unknown[]{
  const {matching,conflicting,partial,global}=imageRequirementsForTarget(rows,target);
  return[...matching,...conflicting,...partial,...global].map(row=>row.source);
}
