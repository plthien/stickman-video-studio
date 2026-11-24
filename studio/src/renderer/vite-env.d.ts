/// <reference types="vite/client" />
type StudioStagedImport = {token:string;stage:string;before:unknown;after:unknown;changes:number;status:string;missing:Array<{key:string;kind:'image'|'sfx';path:string;shotId?:string;layerId?:string;track?:string;trackIndex?:number}>;fulfillments?:Record<string,unknown>};
interface Window { studio?: Readonly<{
  platform: string; version: string;
  listRecent: () => Promise<import('./types/app').NativeProjectSummary[]>;
  createProject: (input: unknown) => Promise<import('./types/app').NativeStudioState>; browseProjectParent: () => Promise<string | null>;
  openProjectDialog: () => Promise<string | null>; openProject: (root: string) => Promise<import('./types/app').NativeStudioState>; projectState: (id: string) => Promise<import('./types/app').NativeStudioState>; saveBrief: (id: string, brief: unknown) => Promise<import('./types/app').NativeStudioState>; setNanoEndpoint: (id: string, endpoint: string) => Promise<import('./types/app').NativeStudioState>;
  freezeTask: (id: string, stage: string, rebuild?: boolean) => Promise<{id:string;revision:number;inputSha256:string;promptPath:string;prompt:string}>; exportPrompt: (id: string, stage: string, operation?:string, scope?:Record<string,unknown>) => Promise<string | null>; stageImport: (id: string, stage: string, text: string) => Promise<StudioStagedImport>; confirmImport: (id:string, token: string, options?:{previewSeconds?:number;allowSampleDraft?:boolean}) => Promise<import('./types/app').NativeStudioState>; pendingMedia:(id:string)=>Promise<StudioStagedImport|null>; fulfillMedia:(id:string,token:string,key:string,relative:string,rights:string)=>Promise<unknown>;
  readHistory:(id:string,stage:string,operation:'author'|'review'|'correct'|'recheck'|'media-review',mediaKind?:'voice'|'captions'|'preview'|'film')=>Promise<import('../shared/externalHistory').ExternalHistoryRecord[]>;
  readFrozen:(id:string,stage:string,operation:'author'|'review'|'correct'|'recheck'|'media-review')=>Promise<({id:string;prompt:string;artifactContext?:'DRAFT'|'PUBLISHED';editableIds?:string[];editablePaths?:string[];targetIds?:string[];findingIds?:string[];mediaTransferAttested?:boolean;mediaKind?:'preview'|'film'|'voice'|'captions'})|null>;freezeLifecycle:(id:string,stage:string,operation:'review'|'correct'|'recheck',scope:Record<string,unknown>,rebuild?:boolean)=>Promise<{id:string;prompt:string}>;stageLifecycle:(id:string,stage:string,operation:'review'|'correct'|'recheck',text:string)=>Promise<StudioStagedImport>;confirmLifecycle:(id:string,token:string,options?:{previewSeconds?:number;allowSampleDraft?:boolean})=>Promise<import('./types/app').NativeStudioState>;
  elevenLabsStatus:()=>Promise<{configured:boolean;source:'secure-storage'|'environment'|'none';secureStorageAvailable:boolean}>; elevenLabsSaveKey:(key:string)=>Promise<{configured:boolean;source:'secure-storage'|'environment'|'none';secureStorageAvailable:boolean}>; elevenLabsClearKey:()=>Promise<{configured:boolean;source:'secure-storage'|'environment'|'none';secureStorageAvailable:boolean}>;
  identitySnapshot:(id:string)=>Promise<ReturnType<typeof import('../main/identity/identityWorkflow').identityWorkflowSnapshot>>;
  identityPreviewUpgrade:(id:string)=>Promise<ReturnType<typeof import('../main/identity/identityWorkflow').previewIdentityUpgrade>>;
  identityUpgrade:(id:string,input:{impactSha256:string;ownerConfirmed:true})=>Promise<ReturnType<typeof import('../main/identity/identityWorkflow').previewIdentityUpgrade>>;
  identityFreeze:(id:string,operation:import('../main/identity/contracts').IdentityReviewOperation,
    revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityImport:(id:string,json:string,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityApproveAnalysis:(id:string,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityPrepareBible:(id:string,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityFreezeStyleBible:(id:string,operation:import('../main/identity/contracts').IdentityReviewOperation,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityImportStyleBible:(id:string,json:string,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityApproveBible:(id:string,revision:number)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityApproveVisualDefinition:(id:string,input:{
    expectedRevision:number;anchorId:string;provenance:'SCRIPT_AUTHOR'|'OWNER_BRIEF';
    evidence:string;traits:string[];ownerInspected:true
  })=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityRegisterOwnerReference:(id:string,input:{
    expectedRevision:number;anchorId:string;relativePath:string;ownerSource:string
  })=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityApproveReference:(id:string,input:{
    expectedRevision:number;candidateId:string;ownerInspected:true
  })=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityPreviewReferenceImpact:(id:string,selectedIds:string[])=>Promise<ReturnType<typeof import('../main/identity/impact').previewReferenceSwitchImpact>>;
  identityPublishReferences:(id:string,revision:number,selectedIds:string[],impactSha256?:string)=>Promise<import('../main/identity/identityWorkflow').IdentityWorkflowStore>;
  identityReferenceJobs:(id:string)=>Promise<import('../main/identity/referenceGeneration').ReferenceJob[]>;
  identityGenerateReference:(id:string,input:{anchorId:string;authorized:true;regenerate?:boolean;acknowledgeUnknown?:boolean})=>Promise<import('../main/identity/referenceGeneration').ReferenceJob>;
  identitySyncReference:(id:string,jobId:string)=>Promise<import('../main/identity/referenceGeneration').ReferenceJob>;
  galleryImages?:(id:string)=>Promise<{token:string|null;styleProfileSha256?:string;shots:Array<{id:string;index:number;imageCount:number}>;targets:Array<{
    key:string;shotId:string;layerId:string;path:string;boundPath:string;boundSha256?:string;creativeFingerprint?:string;fulfilled:boolean;managed:boolean
  }>;}>;
  prepareImages:(id:string,persist?:boolean)=>Promise<{status:string;style:string;revision:number;token:string;jobs:import('../main/imagePreparation').ImageJobSpec[];shotCount:number;imageOccurrences:number;uniquePaths:number}>;
  saveImagePrompt:(id:string,input:{targetKey:string;fingerprint:string;styleSha256?:string;prompt:string;references:string[]})=>Promise<Awaited<ReturnType<NonNullable<Window['studio']>['prepareImages']>>>;
  glabsSettings:()=>Promise<{config:{endpoint:string;contract:'legacy';model:string;aspectRatio:string};credential:{configured:boolean;secureStorageAvailable:boolean}}>;
  glabsConfigure:(config:{endpoint:string;contract:'legacy';model:string;aspectRatio:string})=>Promise<unknown>;
  glabsSaveKey:(key:string)=>Promise<unknown>;glabsClearKey:()=>Promise<unknown>;
  glabsProbe:()=>Promise<{ready:false;reachable:boolean;authVerified:boolean;status:'UNREACHABLE'|'REACHABLE'|'AUTH_VERIFIED';modelCapability:'MODEL_CAPABILITY_UNVERIFIED';configuredModel:string;configuredRatio:string;contract:string;version:string;endpoint:string;diagnostic:string}>;
  glabsJobs:(id:string)=>Promise<Array<{id:string;projectId:string;token:string;targetKey:string;shotId:string;layerId:string;targetPath:string;status:string;model:string;aspectRatio:string;prompt:string;promptSha256?:string;styleProfileId?:string;targetCreativeSha256?:string;styleProfileSha256?:string;nativeRevision?:number;draftRevisionAtSubmission?:number;journalRevision?:number;createdAt?:string;updatedAt?:string;syncPhase?:'provider'|'result'|'download'|'decode'|'stage'|'validated';providerCompletedAt?:string;lastSyncError?:{stage:string;code:string;at:string};sourceMime?:'image/png'|'image/jpeg'|'image/webp';mimeDiagnostic?:{declared:string;detected:string;classification:'missing'|'generic'|'alias'|'mismatch'};providerTaskId?:string;staged?:{path:string;sha256:string;width:number;height:number};reason?:string;approved?:{path:string;sha256:string;rights:string;provenance?:{
    source:'G-Labs generated output';projectId:string;jobId:string;providerTaskId:string|null;
    model:string;promptSha256:string;imageSha256:string;nativeToken:string;
    targetKey:string;shotId:string;layerId:string;targetPath:string;
    styleSha256:string;approvedAt:string;ownerAuthorizedProjectUse:true;
    providerLicenseVerified:false
  }}}>>;
  glabsGenerate:(id:string,input:{targetKey:string;prompt:string;model:string;aspectRatio:string;references:string[];authorized:boolean;regenerate?:boolean;acknowledgeUnknown?:boolean;preparedFingerprint?:string})=>Promise<unknown>;
  onGlabsJobChanged?:(listener:(change:{projectId:string;job:Awaited<ReturnType<NonNullable<Window['studio']>['glabsJobs']>>[number]})=>void)=>()=>void;
  glabsPoll:(id:string,jobId:string)=>Promise<unknown>;glabsCancelQueued:(id:string,jobId:string)=>Promise<unknown>;
  glabsApprove:(id:string,jobId:string,rights?:string)=>Promise<unknown>;
  voicePlaybackUrl:(id:string)=>Promise<string>;
  nanoDiscover: (endpoint: string) => Promise<{ ready: boolean; health:unknown; readiness:unknown; profiles:Array<Record<string,unknown>>; capabilities:unknown }>; nanoGenerate: (id: string, input: unknown) => Promise<{ path: string; sha256: string; sampleRate: number; receipt?: unknown }>; align: (id: string, authorized: boolean) => Promise<{ path: string; captionsPath: string; audioSha256: string }>; longformStatus:()=>Promise<{status:string;instructions:string}>; narrationAction:(id:string)=>Promise<{action:'generate'|'regenerate'|'resume'|'retry'|'running'|'blocked';reason:string;completed:number;total:number;currentPart?:number;status:string;detail?:string}>; repairTiming:(id:string)=>Promise<unknown>; timingEvidence:(id:string)=>Promise<boolean>; longformRun:(id:string,input:{voice?:string;resume?:boolean;retryUncertain?:boolean;regenerate?:boolean})=>Promise<unknown>; importWav:(id:string)=>Promise<unknown>; importWords:(id:string)=>Promise<unknown>; captionReview:(id:string)=>Promise<{status:string;workflowStatus:string;error?:string;wordCount:number;cueCount:number;duration:number;words:Array<{word:string;start:number;end:number}>;original:Array<{start:number;end:number;text:string}>;originalBoundaries:number[];approved:null|{revision:number;mode?:'AUTO'|'MANUAL';cues:Array<{start:number;end:number;text:string}>};draft:null|{cues:Array<{start:number;end:number;text:string}>;boundaries:number[]}}> ; captionAuto:(id:string)=>Promise<unknown>; captionDraft:(id:string,boundaries:number[])=>Promise<unknown>; captionApprove:(id:string,note:string)=>Promise<unknown>;
  importMedia: (id: string, mapping: {kind:'image'|'sfx';shotId?:string;layerId?:string;rights:string}) => Promise<{path:string;sha256:string;status:string}|null>; nativeRun: (id: string, command: string, input?: unknown) => Promise<{ code: number; stdout: string; stderr: string; jobId?:string;artifacts?:unknown;state:import('./types/app').NativeStudioState }>; cancelNative:(id:string,jobId:string)=>Promise<{cancelled:boolean}>; mediaUrl: (id: string, relative: string) => Promise<string>; openOutput: (id: string) => Promise<string>;
}> }
