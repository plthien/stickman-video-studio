/** A deterministic derived Style Bible. It MUST NOT author characters itself. */
import {canonical,contentHash,hash,loadSchema,validateWithSchema,
  type StyleBible,type ScriptAnalysis,type BibleCharacter} from './contracts.js';
import {validateScriptAnalysis,verifiedVisualTraits,type ApprovedScriptSnapshot} from './scriptAnalysis.js';
import type {OwnerVisualDefinition} from './visualDefinitions.js';
import {validateStyleDesign,validateStyleDesignReview} from './styleBibleAuthoring.js';
import type {StyleDesignCandidate,StyleDesignReview} from './contracts.js';
export interface PinnedStyle {
  id:'B1'|'B2'|'B3'|'B4';guidance:string;sha256:string;
}
export function compileStyleBible(analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,
  pinned:PinnedStyle,design?:StyleDesignCandidate,review?:StyleDesignReview):StyleBible{
  validateScriptAnalysis(analysis,script);
  // loadImageStyleProfile() pins the full installed B1–B4 source (for B4:
  // manifest + lock + anchors), while guidance is an extracted projection.
  // Their SHA values are intentionally different. The caller must obtain the
  // source SHA from that verified loader, and we separately hash guidance.
  if(!pinned.guidance.trim()||!/^[a-f0-9]{64}$/.test(pinned.sha256)||
    !['B1','B2','B3','B4'].includes(pinned.id))
    throw Error('STYLE_BIBLE_STYLE_PIN_INVALID');
  if(design){
    validateStyleDesign(design,analysis,pinned);
    if(!review||!validateStyleDesignReview(review,design).approved)
      throw Error('STYLE_DESIGN_REVIEW_REQUIRED');
  }else if(review)throw Error('STYLE_DESIGN_CANDIDATE_REQUIRED');
  const characters:BibleCharacter[]=analysis.continuity_catalog.characters.map(char=>{
    if(design){
      const ai_design=structuredClone(design.characters.find(row=>row.char_id===char.char_id)!);
      const inherited=structuredClone(char);
      return {...inherited,ai_design,
        source_definition_hash:contentHash({inherited,ai_design,styleId:pinned.id,styleSha:pinned.sha256}),
        visual_readiness:'READY_FOR_REFERENCE' as const};
    }
    const inherited=structuredClone(char);
    // Keep original proposal/evidence in source_definition_hash for invalidation,
    // but only verified stable traits enter drawable Style Bible authority.
    const source_definition_hash=contentHash({inherited,styleId:pinned.id,styleSha:pinned.sha256});
    inherited.explicit_visual_traits=verifiedVisualTraits(char);
    // Do not copy unverified or transient evidence as approved visual authority.
    inherited.visual_trait_evidence=(char.visual_trait_evidence??[]).filter(row=>
      inherited.explicit_visual_traits.includes(row.trait));
    // Merely naming a character is NOT a source-grounded appearance.
    // Require some visual/physical evidence before asking a generator to draw
    // an individual. Underspecified actors may instead use a real owner image.
    // Alias, name and generic presence are narrative identity, NOT appearance.
    // Physical action constraints alone also cannot establish how someone looks.
    return{...inherited,source_definition_hash,
      visual_readiness:inherited.explicit_visual_traits.length?
        'READY_FOR_REFERENCE' as const:'NEEDS_OWNER_DEFINITION' as const};
  });
  const base={schema:'stickman-project-style-bible-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),analysis_sha256:contentHash(analysis),
    style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
    style_guidance_sha256:hash(pinned.guidance),characters,
    ...(design&&review?{design_authority:{version:'ai-style-design-v1' as const,candidate_sha256:contentHash(design),review}}:{})};
  const bible={...base,style_bible_sha256:contentHash(base)};
  return validateWithSchema<StyleBible>(loadSchema('bible'),bible);
}
/** Explicit automatic authority: exact approved data, no generated text or review receipt. */
export function compileAutomaticStyleBible(analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,
  pinned:PinnedStyle):StyleBible{
  validateScriptAnalysis(analysis,script);
  if(!pinned.guidance.trim()||!/^[a-f0-9]{64}$/.test(pinned.sha256)||
    !['B1','B2','B3','B4'].includes(pinned.id))throw Error('STYLE_BIBLE_STYLE_PIN_INVALID');
  const characters:BibleCharacter[]=analysis.continuity_catalog.characters.map(char=>({
    ...structuredClone(char),
    source_definition_hash:contentHash({version:'automatic-reference-authority-v1',
      inherited:char,styleId:pinned.id,styleSha:pinned.sha256}),
    visual_readiness:'READY_FOR_REFERENCE'
  }));
  const base={schema:'stickman-project-style-bible-v1' as const,
    project_id:script.projectId,source_script_sha256:script.sha256,
    source_authoring_sha256:contentHash(script.authoring),analysis_sha256:contentHash(analysis),
    style_profile_id:pinned.id,style_profile_sha256:pinned.sha256,
    style_guidance_sha256:hash(pinned.guidance),characters,
    automatic_authority:{version:'automatic-reference-authority-v1' as const}};
  return validateWithSchema<StyleBible>(loadSchema('bible'),{...base,style_bible_sha256:contentHash(base)});
}
/** Technical authority and historical text approval are distinct, never fabricated. */
export function hasReferenceAuthority(bible:StyleBible,receipt:{sha256:string}|null|undefined){
  return bible.automatic_authority?.version==='automatic-reference-authority-v1'?
    !bible.design_authority&&!receipt:receipt?.sha256===bible.style_bible_sha256;
}
export function validateStyleBibleCurrent(bible:StyleBible,
  analysis:ScriptAnalysis,script:ApprovedScriptSnapshot,pinned:PinnedStyle){
  validateScriptAnalysis(analysis,script);
  validateWithSchema<StyleBible>(loadSchema('bible'),bible);
  const {style_bible_sha256,...body}=bible;
  if(contentHash(body)!==style_bible_sha256||
    bible.project_id!==script.projectId||bible.source_script_sha256!==script.sha256||
    bible.source_authoring_sha256!==contentHash(script.authoring)||
    bible.analysis_sha256!==contentHash(analysis)||bible.style_profile_id!==pinned.id||
    bible.style_profile_sha256!==pinned.sha256||bible.style_guidance_sha256!==hash(pinned.guidance)||
    bible.characters.length!==analysis.continuity_catalog.characters.length)
    throw Error('STYLE_BIBLE_SOURCE_STALE');
  if(bible.automatic_authority){
    if(bible.design_authority||
      canonical(compileAutomaticStyleBible(analysis,script,pinned))!==canonical(bible))
      throw Error('AUTOMATIC_REFERENCE_AUTHORITY_STALE');
  }else if(bible.design_authority){
    const design:StyleDesignCandidate={schema:'stickman-ai-style-design-v1',
      project_id:bible.project_id,analysis_sha256:bible.analysis_sha256,
      style_profile_sha256:bible.style_profile_sha256,
      characters:bible.characters.map(row=>row.ai_design!)};
    // The imported design order is normalized to the catalog order before review.
    if(contentHash(design)!==bible.design_authority.candidate_sha256||
      canonical(compileStyleBible(analysis,script,pinned,design,bible.design_authority.review))!==canonical(bible))
      throw Error('STYLE_DESIGN_AUTHORITY_STALE');
  }else{
    for(const char of analysis.continuity_catalog.characters){
      const row=bible.characters.find(c=>c.char_id===char.char_id);
      if(!row||row.ai_design||row.source_definition_hash!==contentHash({inherited:char,styleId:pinned.id,styleSha:pinned.sha256}))
        throw Error('STYLE_BIBLE_SOURCE_STALE');
    }
  }
  return true;
}
function bibleCharacterData(row:BibleCharacter){
  const data:Partial<BibleCharacter>={...row};
  delete data.source_definition_hash;delete data.visual_readiness;delete data.ai_design;
  return data;
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
  const format=[
    'ONE SQUARE 1:1 IMAGE. Exactly FOUR edge-to-edge panels in a 2×2 sheet:',
    'Upper-left: front close-up/detail of the actual subject.',
    'Upper-right: front full view of the entire subject.',
    'Lower-left: side view of the entire subject.',
    'Lower-right: back view of the entire subject.',
    'Same ONE identity and proportions in all panels. No assumed human anatomy.',
    'NO gutters, frames, captions,',
    'letters, labels, numbers, logos, watermark, cropping or extra people.'
  ].join('\n');
  const lines=bible.automatic_authority?[
    'Create a canonical character reference sheet for the following character from an approved story.',
    'CHARACTER DATA (exact approved Script Analysis):',
    JSON.stringify(bibleCharacterData(row)),
    'VISUAL STYLE / '+pinned.id+' / SHA '+pinned.sha256,pinned.guidance,
    ...(ownerDefinition?['Explicit owner-approved instructions: '+JSON.stringify(ownerDefinition.traits),
      'Owner instruction provenance: '+ownerDefinition.provenance,
      'Owner instruction SHA: '+ownerDefinition.definitionSha]:[]),
    'Design one visually distinctive and coherent character consistent with the approved character information and visual style. Where appearance is unspecified, make appropriate creative visual decisions without contradicting explicitly established traits. Treat story occurrences as context, not additional subjects or separate scenes.',
    format,'Maintain consistent identity, proportions, colors and markers across all four views. No text.'
  ]:row.ai_design&&bible.design_authority?[
    'APPROVED AI CHARACTER REFERENCE PROMPT',
    'Character ID: '+row.char_id,row.ai_design.visual_design,row.ai_design.reference_prompt,
    ...(ownerDefinition?['Explicit owner-approved override: '+JSON.stringify(ownerDefinition.traits),
      'Owner definition SHA: '+ownerDefinition.definitionSha]:[]),
    'EXACT B'+pinned.id.slice(-1)+' VISUAL STYLE / SHA '+pinned.sha256,pinned.guidance,format,
    'Do not include text anywhere in generated image.'
  ]:[
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
