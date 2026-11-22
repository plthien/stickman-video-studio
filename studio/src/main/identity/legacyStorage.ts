/** Read-only validation of immutable F24 on-disk snapshots and frozen jobs.
 * NEVER accept this schema for new External Author/Correct imports or publish
 * legacy fields into a newly compiled Style Bible. No storage rewriting. */
import {canonical,contentHash,hash,loadSchema,validateWithSchema,
  type ScriptAnalysis,type StyleBible,type BibleCharacter} from './contracts.js';
import {validateScriptAnalysis,verifiedVisualTraits,
  type ApprovedScriptSnapshot} from './scriptAnalysis.js';
import type {PinnedStyle} from './styleBible.js';
import type {OwnerVisualDefinition} from './visualDefinitions.js';

function oldDiskSchema(kind:'analysis'|'bible'){
  const schema=loadSchema(kind),row=schema.$defs?.character;
  if(!row?.properties||!row.required)throw Error('IDENTITY_LEGACY_SCHEMA_UNAVAILABLE');
  // This retired enum exists ONLY at the immutable storage boundary.
  row.required=[...row.required,'entity_kind'];
  row.properties.entity_kind={enum:['human_character','human_group']};
  return schema;
}
export function isFrozenLegacyAnalysis(analysis:ScriptAnalysis):boolean{
  return analysis.continuity_catalog.characters.some(row=>
    Object.hasOwn(row,'entity_kind'));
}
export function validateHistoricalPublishedBible(analysis:ScriptAnalysis,
  script:ApprovedScriptSnapshot,pinned:PinnedStyle,stored:StyleBible):StyleBible{
  if(!isFrozenLegacyAnalysis(analysis))
    throw Error('IDENTITY_LEGACY_FORMAT_NOT_PRESENT');
  validateScriptAnalysis(analysis,script,oldDiskSchema('analysis'));
  if(!pinned.guidance.trim()||!/^[a-f0-9]{64}$/.test(pinned.sha256)||
    !['B1','B2','B3','B4'].includes(pinned.id))
    throw Error('STYLE_BIBLE_STYLE_PIN_INVALID');
  // Recompute the original v1 derivation in-memory, with the original field
  // included in each old source_definition_hash. Never write derived bytes.
  const characters:BibleCharacter[]=analysis.continuity_catalog.characters.map(char=>{
    const inherited=structuredClone(char);
    const source_definition_hash=contentHash({inherited,
      styleId:pinned.id,styleSha:pinned.sha256});
    inherited.explicit_visual_traits=verifiedVisualTraits(char);
    inherited.visual_trait_evidence=(char.visual_trait_evidence??[]).filter(row=>
      inherited.explicit_visual_traits.includes(row.trait));
    return {...inherited,source_definition_hash,
      visual_readiness:inherited.explicit_visual_traits.length?
        'READY_FOR_REFERENCE' as const:'NEEDS_OWNER_DEFINITION' as const};
  });
  const base={schema:'stickman-project-style-bible-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),
    analysis_sha256:contentHash(analysis),
    style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
    style_guidance_sha256:hash(pinned.guidance),characters};
  const oldDerived={...base,style_bible_sha256:contentHash(base)};
  validateWithSchema<StyleBible>(oldDiskSchema('bible'),stored);
  if(canonical(oldDerived)!==canonical(stored))
    throw Error('IDENTITY_LEGACY_PUBLISHED_BIBLE_TAMPERED');
  return stored;
}
/** Reproduce ONLY frozen pre-removal job prompts for SHA verification/sync.
 * Historical group layout is selected from the archived field, never from
 * current character metadata; this function never authorizes a new POST. */
export function frozenLegacyReferencePrompt(bible:StyleBible,charId:string,
  pinned:PinnedStyle,ownerDefinition?:OwnerVisualDefinition){
  if(bible.style_profile_sha256!==pinned.sha256||
    bible.style_profile_id!==pinned.id)throw Error('STYLE_BIBLE_STYLE_STALE');
  const row=bible.characters.find(c=>c.char_id===charId);
  if(!row)throw Error('STYLE_BIBLE_CHARACTER_NOT_FOUND');
  const kind=(row as BibleCharacter&{entity_kind?:unknown}).entity_kind;
  if(!['human_character','human_group'].includes(String(kind)))
    throw Error('IDENTITY_LEGACY_FORMAT_NOT_PRESENT');
  if(ownerDefinition&&(ownerDefinition.charId!==charId||
    ownerDefinition.styleBibleSha!==bible.style_bible_sha256||
    ownerDefinition.approvedByOwner!==true))
    throw Error('STYLE_BIBLE_OWNER_DEFINITION_STALE');
  if(row.visual_readiness!=='READY_FOR_REFERENCE'&&!ownerDefinition)
    throw Error('STYLE_BIBLE_NEEDS_OWNER_DEFINITION');
  const format=kind==='human_group'?[
    'ONE GROUP OVERVIEW. One coherent approved group in a single image.',
    'Do not render four copies or invent new group members. No printed labels.'
  ].join('\\n'):[
    'ONE SQUARE 1:1 IMAGE. Exactly FOUR edge-to-edge panels in a 2×2 sheet:',
    'Upper-left: front close-up face and shoulders.',
    'Upper-right: front full body, head to feet.',
    'Lower-left: left profile full body, head to feet.',
    'Lower-right: back full body, head to feet.',
    'Same ONE identity and proportions in all panels. NO gutters, frames, captions,',
    'letters, labels, numbers, logos, watermark, cropping or extra people.'
  ].join('\\n');
  const lines=[
    'SOURCE-GROUNDED CANONICAL STYLE BIBLE REFERENCE',
    'Character ID: '+row.char_id,
    'EXACT source-verified visual traits: '+JSON.stringify(row.explicit_visual_traits),
    ...(ownerDefinition?[
      'Explicit owner-approved visual definition SHA: '+ownerDefinition.definitionSha,
      'Owner-verified visual traits: '+JSON.stringify(ownerDefinition.traits),
      'Visual definition provenance: '+ownerDefinition.provenance,
      'This addendum is explicitly approved by owner; do NOT infer other traits.'
    ]:[]),
    'EXACT B'+pinned.id.slice(-1)+' VISUAL STYLE / SHA '+pinned.sha256,pinned.guidance,
    format,'No invented clothing, features, people, props or story actions.',
    'Do not include text anywhere in generated image.'
  ];
  const prompt=lines.join('\\n\\n');
  return{anchor_type:'character' as const,anchor_id:row.char_id,
    source_definition_hash:row.source_definition_hash,
    aspect_ratio:'1:1' as const,prompt,prompt_sha256:hash(prompt)};
}
