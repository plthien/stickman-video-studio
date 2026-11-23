/** Strict, exact current-DRAFT image declarations. Old string asset needs are
 * handled by the old pipeline only when identityPolicy === 'legacy'. */
import {loadSchema,validateWithSchema,contentHash,type StyleBible,
  type NativeImageNeedV2,type ImageRelation} from './contracts.js';
export interface NativeImageTarget {shotId:string;layerId:string;path:string}
/** Source-grounded lexical references, never an AI semantic classifier.
 * Only approved actor IDs and names demonstrated in their approved Script
 * occurrences can create an automatic match. Unknown natural-language
 * relationships (possessive, negated, overlapping aliases) require review. */
const normalizeMention=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en');
const wordChar=/[\p{L}\p{M}\p{N}_]/u;
function occurrenceOf(text:string,name:string){
  if(!name.trim())return false;
  const source=normalizeMention(text),needle=normalizeMention(name.trim());
  for(let offset=source.indexOf(needle);offset!==-1;
    offset=source.indexOf(needle,offset+1)){
    if((offset===0||!wordChar.test(source[offset-1]))&&
      (offset+needle.length===source.length||
       !wordChar.test(source[offset+needle.length])))return true;
  }
  return false;
}
export interface CharacterMention {
  charId:string;name:string;start:number;end:number;
}
/** A one-token alias at a clause opening can also modify a following noun
 * phrase (e.g. a quantity + adjective + object). Do not treat that pattern
 * as a certain actor just because the approved character has the same label.
 * We never apply this heuristic to explicit canonical IDs or multiword names.
 * Unresolved human/subject descriptions are checked separately below. */
function likelyNounModifier(source:string,start:number,end:number,name:string){
  if(name.startsWith('char_')||!/^\\p{L}+$/u.test(name))return false;
  const before=source.slice(0,start);
  if(before.trim()&&!/[.!?;,:]\\s*$/u.test(before))return false;
  const phrase=source.slice(end).match(/^\\s+([\\p{Ll}\\p{M}][\\p{L}\\p{M}-]*)\\s+([\\p{Ll}\\p{M}][\\p{L}\\p{M}-]*)/u);
  if(!phrase)return false;
  // A finite predicate such as "stands", "is", "has" or an adverb
  // after the name is not a demonstrable noun-modifier construction.
  const first=phrase[1];
  return !/(?:s|ed|ing|ly)$/u.test(first);
}
const genericVisibleNoun=/\\b(?:person|people|woman|man|boy|girl|child|children|caveman|human|humans|stickman|stickmen|actor|crowd|animal|robot|creature)\\b/gu;
/** This is an uncertainty gate, not a character/entity classifier. Never
 * assigns char_ids. Inspect actual subject descriptions independent of how
 * many named actors or canonical references were already declared. */
function assertNoUnboundVisibleSubjects(text:string,mentions:CharacterMention[]){
  const words=normalizeMention(text);
  for(const found of words.matchAll(genericVisibleNoun)){
    const at=found.index,word=found[0],before=words.slice(Math.max(0,at-72),at);
    const after=words.slice(at+word.length,at+word.length+32);
    if(mentions.some(m=>m.start<=at&&m.end>=at+word.length))continue;
    // Explicitly absent subjects, quoted narration and words on signage
    // are not proof that a separate subject is depicted in the image.
    if(/\\b(?:no|without|excluding|exclude|not|never)\\s+(?:(?:any|a|an|other|additional|visible)\\s+){0,2}$/u.test(before)||
       /\\b(?:do\\s+not|don't)\\s+(?:show|include|depict)\\s+(?:(?:a|an|any)\\s+)?$/u.test(before)||
       /\\b(?:narration|voiceover|voice-over|dialogue|caption|text|sign)\\s+(?:says|mentions|reads?)\\s+["'“‘]?(?:(?:a|an|the)\\s+)?$/u.test(before)||
       /\\b(?:photo|picture|drawing|poster|toy|statue)\\s+(?:of|showing|depicting|with)\\s+(?:(?:a|an|the)\\s+)?$/u.test(before)||
       /\\b(?:word|text|label)\\s+["'“‘]?$/u.test(before))
      continue;
    // "Kip is a man" describes the already-established subject rather
    // than introducing another actor. Do not erase unresolved co-presence.
    if(/\\b(?:is|was)\\s+an?\\s+$/u.test(before)&&
      mentions.some(m=>m.end<=at&&at-m.end<=14))continue;
    // A negative or object label immediately following a subject noun
    // still cannot be reinterpreted as an additional drawable character.
    if(/^(?:\\s+(?:toy|statue|figure|drawing|picture)\\b)/u.test(after))continue;
    throw Error('NATIVE_IDENTITY_CAST_REVIEW_REQUIRED: unidentified on-screen subject');
  }
}
export function detectPublishedCharacterMentions(text:string,
  bible:Pick<StyleBible,'characters'>):CharacterMention[]{
  const source=normalizeMention(text);
  const names=new Map<string,Set<string>>();
  const reviewOnly=new Set<string>();
  for(const actor of bible.characters){
    const candidates:string[]=[actor.char_id];
    const approvedQuotes=actor.occurrences.map(hit=>hit.quote);
    if(approvedQuotes.some(quote=>occurrenceOf(quote,actor.label)))
      candidates.push(actor.label);
    else reviewOnly.add(normalizeMention(actor.label));
    // An alias is allowed only if the source occurrence itself is that exact
    // name/marker. Arbitrary identity_markers like a scar are NOT aliases.
    for(const quote of approvedQuotes){
      const alias=quote.trim();
      const namedMention=/^\p{Lu}[\p{L}\p{M}'’\-]*(?:\s+\p{Lu}[\p{L}\p{M}'’\-]*){0,3}$/u.test(alias);
      if(alias.length<=64&&/^[\p{L}\p{M}\p{N}'’\- ]+$/u.test(alias)&&
        alias.split(/\s+/u).length<=4&&
        (alias===actor.label||namedMention||
         actor.identity_markers.some(marker=>
           normalizeMention(marker)===normalizeMention(alias))))
        candidates.push(alias);
      else if(alias.length<=64&&
        /^[\p{L}\p{M}\p{N}'’\- ]+$/u.test(alias)&&
        alias.split(/\s+/u).length<=4)
        reviewOnly.add(normalizeMention(alias));
    }
    for(const raw of candidates){
      const key=normalizeMention(raw.trim());
      if(!key)continue;
      const owners=names.get(key)??new Set<string>();
      owners.add(actor.char_id);names.set(key,owners);
    }
  }
  const matches:CharacterMention[]=[];
  for(const [name,ids] of names){
    let pos=source.indexOf(name);
    while(pos>=0){
      const end=pos+name.length;
      if((pos===0||!wordChar.test(source[pos-1]))&&
        (end===source.length||!wordChar.test(source[end]))){
        if(ids.size!==1)throw Error('NATIVE_IDENTITY_ALIAS_REVIEW_REQUIRED: '+name);
        if(!likelyNounModifier(source,pos,end,name))
          matches.push({charId:[...ids][0],name,start:pos,end});
      }
      pos=source.indexOf(name,pos+1);
    }
  }
  matches.sort((a,b)=>a.start-b.start||b.end-a.end);
  const winners:CharacterMention[]=[];
  for(const match of matches){
    const collisions=winners.filter(previous=>match.start<previous.end&&
      previous.start<match.end);
    if(collisions.some(previous=>previous.charId!==match.charId))
      throw Error('NATIVE_IDENTITY_ALIAS_REVIEW_REQUIRED: overlapping names');
    if(!collisions.length)winners.push(match);
  }
  // A source occurrence that is not a demonstrably unique proper name is
  // still possible character evidence. Never silently treat it as scenery.
  for(const name of reviewOnly){
    if(!name||names.has(name))continue;
    let pos=source.indexOf(name);
    while(pos>=0){
      const end=pos+name.length;
      if((pos===0||!wordChar.test(source[pos-1]))&&
        (end===source.length||!wordChar.test(source[end]))&&
        !winners.some(actor=>actor.start>=pos&&actor.end<=end))
        throw Error('NATIVE_IDENTITY_ALIAS_REVIEW_REQUIRED: '+name);
      pos=source.indexOf(name,pos+1);
    }
  }
  return winners;
}
export function assertNativeCastConsistency(row:NativeImageNeedV2,
  bible:Pick<StyleBible,'characters'>,text:string=row.content){
  const mentions=detectPublishedCharacterMentions(text,bible);
  const declared=new Set<string>(row.character_ids);
  for(const mention of mentions){
    const context=normalizeMention(text).slice(Math.max(0,mention.start-32),mention.end+12);
    if(/\b(?:no|without|exclude|excluding|not|rather than)\s+[\p{L}\p{M}\p{N}_'’ -]*$/u
      .test(context.slice(0,Math.max(0,mention.start-Math.max(0,mention.start-32))))||
      ((row.asset_kind==='prop'||row.asset_kind==='object')&&
       /^['’]s\b/u.test(context.slice(mention.end-Math.max(0,mention.start-32)))))
      throw Error('NATIVE_IDENTITY_CAST_REVIEW_REQUIRED: '+mention.charId);
    if(!declared.has(mention.charId))
      throw Error('NATIVE_IDENTITY_CHARACTER_CAST_MISSING: '+mention.charId);
  }
  if(mentions.length&&['background','object','prop','other'].includes(row.asset_kind))
    throw Error('NATIVE_IDENTITY_ASSET_KIND_CONFLICT');
  assertNoUnboundVisibleSubjects(text,mentions);
  return mentions.map(mention=>mention.charId);
}

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
    assertNativeCastConsistency(row,bible);
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
