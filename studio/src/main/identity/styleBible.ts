/** A deterministic derived Style Bible. It MUST NOT author characters itself. */
import {canonical,contentHash,hash,loadSchema,validateWithSchema,
  type StyleBible,type ScriptAnalysis,type BibleCharacter} from './contracts.js';
import {validateScriptAnalysis,type ApprovedScriptSnapshot} from './scriptAnalysis.js';
import type {OwnerVisualDefinition} from './visualDefinitions.js';
export interface PinnedStyle {
  id:'B1'|'B2'|'B3'|'B4';guidance:string;sha256:string;
}
export function compileStyleBible(analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,
  pinned:PinnedStyle):StyleBible{
  validateScriptAnalysis(analysis,script);
  // loadImageStyleProfile() pins the full installed B1–B4 source (for B4:
  // manifest + lock + anchors), while guidance is an extracted projection.
  // Their SHA values are intentionally different. The caller must obtain the
  // source SHA from that verified loader, and we separately hash guidance.
  if(!pinned.guidance.trim()||!/^[a-f0-9]{64}$/.test(pinned.sha256)||
    !['B1','B2','B3','B4'].includes(pinned.id))
    throw Error('STYLE_BIBLE_STYLE_PIN_INVALID');
  const characters:BibleCharacter[]=analysis.continuity_catalog.characters.map(char=>{
    const inherited=structuredClone(char);
    const source_definition_hash=contentHash({inherited,styleId:pinned.id,styleSha:pinned.sha256});
    // Merely naming a character is NOT a source-grounded appearance.
    // Require some visual/physical evidence before asking a generator to draw
    // an individual. Underspecified actors may instead use a real owner image.
    // Alias, name and generic presence are narrative identity, NOT appearance.
    // Physical action constraints alone also cannot establish how someone looks.
    return{...inherited,source_definition_hash,
      visual_readiness:char.explicit_visual_traits.length?
        'READY_FOR_REFERENCE' as const:'NEEDS_OWNER_DEFINITION' as const};
  });
  const base={schema:'stickman-project-style-bible-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),analysis_sha256:contentHash(analysis),
    style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
    style_guidance_sha256:hash(pinned.guidance),characters};
  const bible={...base,style_bible_sha256:contentHash(base)};
  return validateWithSchema<StyleBible>(loadSchema('bible'),bible);
}
export function validateStyleBibleCurrent(bible:StyleBible,
  analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,pinned:PinnedStyle){
  const current=compileStyleBible(analysis,script,pinned);
  if(canonical(current)!==canonical(bible))throw Error('STYLE_BIBLE_SOURCE_STALE');
  return true;
}
/** Print view labels only in prompt instructions; generated pixels must have NO text. */
export function referencePromptForCharacter(bible:StyleBible,
  charId:string,pinned:PinnedStyle,ownerDefinition?:OwnerVisualDefinition){
  if(bible.style_profile_sha256!==pinned.sha256||bible.style_profile_id!==pinned.id)
    throw Error('STYLE_BIBLE_STYLE_STALE');
  const row=bible.characters.find(c=>c.char_id===charId);
  if(!row)throw Error('STYLE_BIBLE_CHARACTER_NOT_FOUND');
  if(ownerDefinition&&(ownerDefinition.charId!==charId||
    ownerDefinition.styleBibleSha!==bible.style_bible_sha256||
    ownerDefinition.approvedByOwner!==true))
    throw Error('STYLE_BIBLE_OWNER_DEFINITION_STALE');
  if(row.visual_readiness!=='READY_FOR_REFERENCE'&&!ownerDefinition)
    throw Error('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
  const format=row.entity_kind==='human_group'?[
    'ONE GROUP OVERVIEW. One coherent approved group in a single image.',
    'Do not render four copies or invent new group members. No printed labels.'
  ].join('\n'):[
    'ONE SQUARE 1:1 IMAGE. Exactly FOUR edge-to-edge panels in a 2×2 sheet:',
    'Upper-left: front close-up face and shoulders.',
    'Upper-right: front full body, head to feet.',
    'Lower-left: left profile full body, head to feet.',
    'Lower-right: back full body, head to feet.',
    'Same ONE identity and proportions in all panels. NO gutters, frames, captions,',
    'letters, labels, numbers, logos, watermark, cropping or extra people.'
  ].join('\n');
  const lines=[
    'SOURCE-GROUNDED CANONICAL STYLE BIBLE REFERENCE',
    'Character ID: '+row.char_id,
    // Freeform label, description and narrative role are never visual input:
    // they can carry unreviewed appearance despite being useful to authors.
    'EXACT source-verified visual traits: '+JSON.stringify(row.explicit_visual_traits),
    ...(ownerDefinition?[
      'Explicit owner-approved visual definition SHA: '+ownerDefinition.definitionSha,
      'Owner-verified visual traits: '+JSON.stringify(ownerDefinition.traits),
      'Visual definition provenance: '+ownerDefinition.provenance,
      'This addendum is explicitly approved by owner; do NOT infer other traits.'
    ]:[]),
    // Physical/narrative metadata is not source-approved visual authority.
    // Never send unchecked narrative text to the image generator.
    'EXACT B'+pinned.id.slice(-1)+' VISUAL STYLE / SHA '+pinned.sha256,pinned.guidance,
    format,'No invented clothing, features, people, props or story actions.',
    'Do not include text anywhere in generated image.'
  ];
  const prompt=lines.join('\n\n');
  return{anchor_type:'character' as const,anchor_id:row.char_id,
    source_definition_hash:row.source_definition_hash,
    aspect_ratio:'1:1' as const,prompt,prompt_sha256:hash(prompt)};
}
