import {useEffect} from 'react';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const keys=['portrait','square','landscape','offratio','second-shot'] as const;
const shapes=[[768,1365],[1024,1024],[1280,720],[768,1376],[768,1365]] as const;
const targets=keys.map((layerId,index)=>{
  const shotId=index===4?'shot-2':'shot-1',shotIndex=index===4?1:0;
  return{key:'image:'+shotIndex+':'+layerId,kind:'image' as const,shotId,layerId,
    path:'assets/images/'+layerId+'.png',boundPath:'assets/images/'+layerId+'.png',
    managed:true,fulfilled:false};
});
const shots=[{id:'shot-1',start:0,end:4,layers:targets.slice(0,4).map(t=>({
  id:t.layerId,type:'image',path:t.path
}))},{id:'shot-2',start:4,end:6,layers:targets.slice(4).map(t=>({
  id:t.layerId,type:'image',path:t.path
}))}];
const project=(id:string,revision=1):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,title:id,style:'B2',root:'C:/projects/'+id,
    projectFile:'C:/projects/'+id+'/project.json',updatedAt:'now'},
  brief:{topic:'Gallery Native source',ratio:'9:16',language:'English'},
  external:{},
  nativeDraft:{context:'DRAFT',token:'token-'+id,authorTaskId:'native-'+id,
    revision,artifactSha256:'a'.repeat(64),reviewStatus:'REVIEWED_WITH_FINDINGS',
    unresolvedFindings:1,readyForMedia:false},
  projection:{shots:[],duration:0,demo:false}
});
const prepared=(id:string)=>({
  status:'PRE_MEDIA_PROJECTION',style:'B2',revision:1,token:'token-'+id,
  shotCount:2,imageOccurrences:5,uniquePaths:5,
  jobs:targets.map((target,index)=>({
    targetKey:target.key,assetKey:target.key,targetKeys:[target.key],
    expectedPaths:[target.path],shotId:target.shotId,layerId:target.layerId,
    path:target.path,assetKind:'other',state:'READY',reason:'',
    prompt:'APPROVED B2 STYLE. Exact verified source for '+target.layerId,
    promptSha256:'e'.repeat(64),sourceDescription:'Verified source '+target.layerId,
    sourceRows:[target],sourceLedger:'',references:[],styleAnchors:[],
    styleProfileRef:{id:'B2',path:'references/b2-colorful-handdrawn.md',
      sha256:'c'.repeat(64)},
    draftIdentity:{projectId:id,authorTaskId:'native-'+id,
      token:'token-'+id,revision:1,creativeFingerprint:String(index+1).repeat(64)},
    occurrencesAtPath:1,ownerEdited:false
  }))
});
const job=(index:number)=>({
  id:'job-'+index,projectId:'A',token:'token-A',
  targetKey:targets[index].key,shotId:targets[index].shotId,
  layerId:targets[index].layerId,targetPath:targets[index].path,
  status:'VALIDATED',model:'nano_banana_2',aspectRatio:'9:16',
  authorTaskId:'native-A',targetCreativeSha256:String(index+1).repeat(64),
  styleProfileId:'B2',styleProfileSha256:'c'.repeat(64),
  prompt:'Source verified image for '+targets[index].layerId,
  staged:{path:'assets/images/candidate-'+index+'.png',
    sha256:String(index+1).repeat(64),width:shapes[index][0],height:shapes[index][1]}
});
function Harness(){
  const {setNative}=useAppState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(project('A'));},[]);
  return <><button onClick={()=>setNative(project('B'))}>Switch project B</button>
    <button onClick={()=>setNative(project('A',2))}>Revise Native DRAFT</button>
    <StoryboardWorkspace/></>;
}
function install({initial=4,rejectIndex=-1,superseded=false}:{
  initial?:number;rejectIndex?:number;superseded?:boolean
}={}){
  let records=targets.slice(0,initial).map((_target,index)=>job(index));
  if(superseded){
    const former={...job(0),status:'APPROVED',targetCreativeSha256:'9'.repeat(64)};
    records=[former,...records];
  }
  let fulfilled=new Set<string>();
  const pendingMedia=vi.fn(async(id:string)=>id==='A'?{
    token:'token-A',status:'WAITING_FOR_MEDIA',missing:targets.filter(t=>!fulfilled.has(t.key)),
    after:{shots,captions:[]},fulfillments:Object.fromEntries(
      [...fulfilled].map(key=>[key,{relative:'assets/images/approved.png'}]))
  }:null);
  const galleryImages=vi.fn(async(id:string)=>id==='A'?{
    token:'token-A',shots:[{id:'shot-1',index:0,imageCount:4},
      {id:'shot-2',index:1,imageCount:1}],
    targets:targets.map(target=>({...target,fulfilled:fulfilled.has(target.key),
      boundPath:fulfilled.has(target.key)?'assets/images/approved.png':target.path}))
  }:{token:null,shots:[],targets:[]});
  const glabsJobs=vi.fn(async(id:string)=>id==='A'?[...records]:[]);
  const approve=vi.fn(async(id:string,jobId:string,_rights?:string)=>{
    if(id!=='A')throw new Error('Cross-project approval');
    const current=records.find(record=>record.id===jobId);
    if(!current)throw new Error('Target not found');
    const index=targets.findIndex(t=>t.key===current.targetKey);
    if(index===rejectIndex)throw new Error('Injected backend approval failure');
    if(current.status!=='VALIDATED')return{job:current};
    fulfilled.add(current.targetKey);
    const approved={rights:'owner-authorized test binding',
      path:'assets/images/approved.png',sha256:current.staged.sha256};
    records=records.map(record=>record.id===jobId?
      {...record,status:'APPROVED',approved}:record);
    return{job:{...current,status:'APPROVED',approved}};
  });
  const generate=vi.fn(async(_id:string,input:{targetKey:string})=>{
    const index=targets.findIndex(t=>t.key===input.targetKey);
    const current={...job(index),id:'generated-'+index,status:'RUNNING'};
    records=[current,...records];
    return current;
  });
  const read=vi.fn(async(id:string,path:string)=>'studio-media://'+id+'/'+path);
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia,galleryImages,glabsJobs,prepareImages:async(id:string)=>prepared(id),
    glabsSettings:async()=>({config:{model:'nano_banana_2',aspectRatio:'9:16'},
      credential:{configured:true,secureStorageAvailable:true}}),
    glabsApprove:approve,glabsGenerate:generate,mediaUrl:read,
    projectState:async(id:string)=>project(id)
  }});
  return{approve,generate,read,glabsJobs,galleryImages,pendingMedia,
    records:()=>records,fulfilled:()=>new Set(fulfilled)};
}
async function shotCards(count:number){
  await waitFor(()=>expect(screen.getAllByTestId('shot-image-card')).toHaveLength(count));
  return screen.getAllByTestId('shot-image-card');
}
async function load(card:HTMLElement){
  const image=await within(card).findByRole('img');
  Object.defineProperty(image,'complete',{configurable:true,value:true});
  Object.defineProperty(image,'naturalWidth',{configurable:true,value:768});
  Object.defineProperty(image,'naturalHeight',{configurable:true,value:1365});
  fireEvent.load(image);
}
afterEach(()=>{
  cleanup();vi.restoreAllMocks();
  Object.defineProperty(window,'studio',{configurable:true,value:undefined});
});
describe('F09–F11 Native Shot gallery + explicit bulk approval',()=>{
  it('F09-INT-01 all four image Layers are visible immediately without clicking a Layer',async()=>{
    install();render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    expect(cards.map(el=>el.getAttribute('data-layer-id'))).toEqual(keys.slice(0,4));
    for(let i=0;i<4;i++){
      const image=await within(cards[i]).findByRole('img');
      expect(image).toHaveAttribute('width',String(shapes[i][0]));
      expect(image).toHaveAttribute('height',String(shapes[i][1]));
      expect(image).toHaveStyle({objectFit:'contain'});
    }
    expect(screen.getByRole('button',{name:'Generate All in Shot (0 paid attempts)'})).toBeDisabled();
  });
  it('F11-INT-02 one click approves exactly one loaded candidate without a rights/source field',async()=>{
    const {approve,fulfilled}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    await load(cards[0]);
    fireEvent.click(within(cards[0]).getByRole('button',{name:'Approve Image'}));
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith('A','job-0');
    await waitFor(()=>expect(fulfilled().has(targets[0].key)).toBe(true));
    await waitFor(()=>expect(within(cards[0]).getByText('Approved')).toBeInTheDocument());
    expect(approve).not.toHaveBeenCalledWith('A','job-1');
  });
  it('F11-INT-03 selected approval binds two inspected candidates but not a third',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    for(const card of cards.slice(0,3))await load(card);
    fireEvent.click(within(cards[0]).getByRole('checkbox',{name:'Select portrait'}));
    fireEvent.click(within(cards[1]).getByRole('checkbox',{name:'Select square'}));
    const button=screen.getByRole('button',{name:'Approve Selected (2)'});
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(2));
    expect(approve.mock.calls.map(call=>call[1])).toEqual(['job-0','job-1']);
    expect(approve).not.toHaveBeenCalledWith('A','job-2');
  });
  it('F11-INT-04 all-ready in Shot approves only loaded VALIDATED candidates',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    for(const card of cards.slice(0,3))await load(card);
    const action=screen.getByRole('button',{name:'Approve All Inspected Ready in Shot (3)'});
    fireEvent.click(action);
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(3));
    expect(approve.mock.calls.map(call=>call[1])).toEqual(['job-0','job-1','job-2']);
  });
  it('F11-INT-05 global all-ready includes inspected candidates in more than one Shot',async()=>{
    const {approve}=install({initial:5});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    let cards=await shotCards(4);
    for(const card of cards)await load(card);
    fireEvent.click(screen.getByRole('button',{name:/shot-2 1 images/}));
    cards=await shotCards(1);
    await load(cards[0]);
    fireEvent.click(screen.getByRole('button',{name:/shot-1 4 images/}));
    await shotCards(4);
    const action=screen.getByRole('button',{name:'Approve All Inspected Ready (5)'});
    fireEvent.click(action);
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(5));
    expect(new Set(approve.mock.calls.map(call=>call[1]))).toEqual(
      new Set(keys.map((_key,index)=>'job-'+index)));
  });
  it('F11-INT-06 second approval failure keeps first bound and reports independent failure',async()=>{
    const {approve,fulfilled}=install({rejectIndex:1});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    await load(cards[0]);await load(cards[1]);
    fireEvent.click(screen.getByRole('button',{name:'Approve All Inspected Ready in Shot (2)'}));
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(screen.getByTestId('bulk-approval-results')).toHaveTextContent('1 approved'));
    expect(screen.getByTestId('bulk-approval-results')).toHaveTextContent('1 failed');
    expect(fulfilled().has(targets[0].key)).toBe(true);
    expect(fulfilled().has(targets[1].key)).toBe(false);
  });
  it('F10-INT-07 Generate All in Shot sends only this Shot targets, sequentially',async()=>{
    const {generate}=install({initial:0});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await shotCards(4);
    fireEvent.click(screen.getByRole('button',{name:'Generate All in Shot (4 paid attempts)'}));
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(4));
    expect(generate.mock.calls.map(call=>call[1].targetKey)).toEqual(
      targets.slice(0,4).map(item=>item.key));
    expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('4 / 4 requests submitted');
  });
  it('F10-INT-08 stop after current request prevents any additional paid POST',async()=>{
    install({initial:0});
    let complete!:(value:ReturnType<typeof job>)=>void;
    const gate=new Promise<ReturnType<typeof job>>(resolve=>{complete=resolve;});
    const generating=vi.fn(async()=>gate);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:generating
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await shotCards(4);
    fireEvent.click(screen.getByRole('button',{name:'Generate All in Shot (4 paid attempts)'}));
    await waitFor(()=>expect(generating).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'Stop after current request'}));
    complete({...job(0),status:'RUNNING'});
    await waitFor(()=>expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('Batch stopped'));
    expect(generating).toHaveBeenCalledTimes(1);
  });
  it('F10-INT-11 repeated Generate All in Shot clicks cannot submit a second paid request while first is pending',async()=>{
    install({initial:0});
    let finish!:(value:ReturnType<typeof job>)=>void;
    const gate=new Promise<ReturnType<typeof job>>(resolve=>{finish=resolve;});
    const generate=vi.fn(async()=>gate);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:generate
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await shotCards(4);
    const action=screen.getByRole('button',{name:'Generate All in Shot (4 paid attempts)'});
    fireEvent.click(action);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    fireEvent.click(action);
    expect(generate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Stop after current request'}));
    finish({...job(0),status:'RUNNING'});
    await waitFor(()=>expect(screen.getByTestId('image-batch-progress'))
      .toHaveTextContent('Batch stopped'));
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('F10-INT-12 Native DRAFT revision change cancels remaining Shot paid requests',async()=>{
    install({initial:0});
    let finish!:(value:ReturnType<typeof job>)=>void;
    const gate=new Promise<ReturnType<typeof job>>(resolve=>{finish=resolve;});
    const generate=vi.fn(async()=>gate);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:generate
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await shotCards(4);
    fireEvent.click(screen.getByRole('button',{name:'Generate All in Shot (4 paid attempts)'}));
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'Revise Native DRAFT'}));
    finish({...job(0),status:'RUNNING'});
    // The pending session was invalidated by revision change. No new paid POST
    // may leave the client even if the old provider request completes later.
    await waitFor(()=>expect(screen.getByRole('button',{name:'Generate All in Shot (4 paid attempts)'}))
      .toBeInTheDocument());
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('F09-INT-09 bound Approved card remains visible after fulfillment removes missing target',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    await load(cards[0]);
    fireEvent.click(within(cards[0]).getByRole('button',{name:'Approve Image'}));
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getAllByTestId('shot-image-card')).toHaveLength(4));
    const approved=screen.getAllByTestId('shot-image-card')[0];
    expect(approved).toHaveAttribute('data-layer-id','portrait');
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
  });
  it('F09-INT-13 Shot navigation counts the complete frozen gallery after successful binding',async()=>{
    const {approve}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    expect(screen.getByRole('button',{name:/shot-1 4 images/})).toBeInTheDocument();
    await load(cards[0]);
    fireEvent.click(within(cards[0]).getByRole('button',{name:'Approve Image'}));
    await waitFor(()=>expect(approve).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByRole('button',{name:/shot-1 4 images/}))
      .toBeInTheDocument());
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(4);
    expect(within(screen.getAllByTestId('shot-image-card')[0])
      .getByText('Approved')).toBeInTheDocument();
  });
  it('F13-INT-01 an APPROVED candidate from older creative instructions is history, not current binding; regeneration is deliberate',async()=>{
    const {generate}=install({initial:0,superseded:true});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    expect(within(cards[0]).getByText('Needs Regeneration')).toBeInTheDocument();
    expect(within(cards[0]).queryByText('Approved')).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
    const button=within(cards[0]).getByRole('button',{
      name:'Regenerate for Current Draft · portrait'
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:targets[0].key,regenerate:true,authorized:true,
      preparedFingerprint:'1'.repeat(64)
    }));
    expect(generate).not.toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:targets[1].key
    }));
  });
  it('F13-INT-02 old-token APPROVED and UNKNOWN are historical only; new-token regeneration remains explicit and unblocked',async()=>{
    const {generate}=install({initial:0});
    const existing=window.studio!;
    const olderApproved={...job(0),token:'token-before-correction',
      status:'APPROVED',targetCreativeSha256:'9'.repeat(64),
      id:'historical-approved',createdAt:'2026-01-01T00:00:00Z'};
    const olderUnknown={...job(0),token:'token-before-correction',
      status:'UNKNOWN',targetCreativeSha256:'9'.repeat(64),
      id:'historical-unknown',createdAt:'2026-01-02T00:00:00Z'};
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...existing,glabsJobs:async(id:string)=>id==='A'?[olderUnknown,olderApproved]:[]
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4),first=cards[0];
    expect(within(first).getByText('Needs Regeneration')).toBeInTheDocument();
    expect(within(first).queryByRole('button',{name:'Review UNKNOWN'})).not.toBeInTheDocument();
    expect(within(first).getByRole('button',{
      name:'Regenerate for Current Draft · portrait'
    })).toBeEnabled();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(within(first).getByText(
      'Prompt · references · candidate history · diagnostics'));
    expect(await within(first).findByText('Historical APPROVED image is superseded',
      {exact:false})).toBeInTheDocument();
    expect(within(first).getByText('Candidate History')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button',{
      name:'Regenerate for Current Draft · portrait'
    }));
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:targets[0].key,authorized:true,regenerate:false
    }));
  });
  it('F09-INT-10 project switch clears previous cards and approval selection',async()=>{
    install({initial:5});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const cards=await shotCards(4);
    await load(cards[0]);
    fireEvent.click(within(cards[0]).getByRole('checkbox',{name:'Select portrait'}));
    fireEvent.click(screen.getByRole('button',{name:'Switch project B'}));
    await waitFor(()=>expect(screen.queryAllByTestId('shot-image-card')).toHaveLength(0));
    expect(screen.getByRole('button',{name:'Approve Selected (0)'})).toBeDisabled();
  });
});
