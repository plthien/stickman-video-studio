import {useEffect} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppStateProvider,useAppState} from '../../src/renderer/app/AppState';
import {StoryboardWorkspace} from '../../src/renderer/features/storyboard/StoryboardWorkspace';
import type {NativeStudioState} from '../../src/renderer/types/app';

const targets=[
  {key:'image:0:layer-a',kind:'image',path:'assets/images/a.png',shotId:'sh-a',layerId:'layer-a'},
  {key:'image:1:layer-b',kind:'image',path:'assets/images/b.png',shotId:'sh-b',layerId:'layer-b'}
];
const state=(id:string):NativeStudioState=>({
  schema:'mode-b-studio-state-v1',
  project:{id,title:id,root:'C:/projects/'+id,projectFile:'C:/projects/'+id+'/project.json',
    style:'B2',updatedAt:'now'},
  brief:{topic:'Two source-approved images',ratio:'9:16',language:'English'},
  external:{},nativeDraft:{context:'DRAFT',token:'token-'+id,authorTaskId:'native-'+id,
    revision:1,artifactSha256:'a'.repeat(64),reviewStatus:'REVIEWED_WITH_FINDINGS',
    unresolvedFindings:1,readyForMedia:false},
  projection:{shots:[],duration:0,demo:false}
});
const pending=(id:string)=>({
  token:'token-'+id,status:'WAITING_FOR_MEDIA',
  missing:targets,fulfillments:{},after:{shots:targets.map((t,index)=>({
    id:t.shotId,start:index,end:index+1,
    layers:[{id:t.layerId,type:'image',path:t.path}]
  })),captions:[]},assetNeeds:[],shotLedger:[]
});
const prepared=(id:string)=>({
  status:'PRE_MEDIA_PROJECTION',style:'B2',token:'token-'+id,
  revision:1,shotCount:2,imageOccurrences:2,uniquePaths:2,
  jobs:targets.map((t,index)=>({
    targetKey:t.key,assetKey:t.key,targetKeys:[t.key],expectedPaths:[t.path],
    shotId:t.shotId,layerId:t.layerId,path:t.path,assetKind:'other',
    state:'READY',reason:'',prompt:'APPROVED B2 STYLE\\n\\n'+t.shotId+' exact image',
    promptSha256:'e'.repeat(64),sourceDescription:t.shotId+' exact image',
    sourceLedger:'',sourceRows:[t],styleProfileRef:{
      id:'B2',path:'references/b2-colorful-handdrawn.md',sha256:'c'.repeat(64)
    },references:[],styleAnchors:[],occurrencesAtPath:1,ownerEdited:false,
    draftIdentity:{projectId:id,authorTaskId:'native-'+id,token:'token-'+id,
      revision:1,creativeFingerprint:(index===0?'a':'b').repeat(64)}
  }))
});
type ImageJob={id:string;projectId:string;token:string;targetKey:string;shotId:string;
  layerId:string;targetPath:string;status:string;model:string;aspectRatio:string;
  prompt:string;reason?:string;journalRevision?:number;
  targetCreativeSha256?:string;styleProfileSha256?:string;
  staged?:{path:string;sha256:string;width:number;height:number}};
const job=(id:string,targetIndex:number,status='RUNNING'):ImageJob=>{
  const t=targets[targetIndex];
  return{id,projectId:'A',token:'token-A',targetKey:t.key,shotId:t.shotId,
    layerId:t.layerId,targetPath:t.path,status,model:'nano_banana_2',
    aspectRatio:'9:16',prompt:'APPROVED B2 STYLE'};
};
function Harness(){
  const {setNative}=useAppState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setNative(state('A'));},[]);
  return <><button onClick={()=>setNative(state('B'))}>Switch B</button>
    <StoryboardWorkspace/></>;
}
function install(previous:ImageJob[]=[]){
  let records=[...previous],serial=0;
  const generate=vi.fn(async(_id:string,input:{targetKey:string})=>{
    const index=targets.findIndex(t=>t.key===input.targetKey);
    const next=job('submitted-'+(++serial),index);
    records=[next,...records];
    return next;
  });
  const mediaUrl=vi.fn(async(_id:string,path:string)=>'studio-media://A/'+path);
  Object.defineProperty(window,'studio',{configurable:true,value:{
    pendingMedia:async(id:string)=>pending(id),
    prepareImages:async(id:string)=>prepared(id),
    glabsJobs:async(id:string)=>id==='A'?records:[],
    glabsSettings:async()=>({config:{model:'nano_banana_2',aspectRatio:'9:16'},
      credential:{configured:true,secureStorageAvailable:true}}),
    glabsGenerate:generate,
    mediaUrl,
    projectState:async(id:string)=>state(id)
  }});
  return{generate,mediaUrl,records:()=>records};
}
afterEach(()=>{
  cleanup();vi.restoreAllMocks();
  Object.defineProperty(window,'studio',{configurable:true,value:undefined});
});
describe('Phase-1 Storyboard viewport and owner-started safe bulk generation',()=>{
  it('BULK-01 shows eligible request count and starts no paid request on mount or refresh',async()=>{
    const {generate}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    expect(await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'})).toBeEnabled();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Refresh Images'}));
    await screen.findByTestId('shot-image-gallery');
    expect(generate).not.toHaveBeenCalled();
    expect(screen.getByTestId('shot-image-gallery')).toHaveTextContent('Not Generated');
  });
  it('BULK-02 explicit Generate All queues only two exact unattempted targets sequentially',async()=>{
    const {generate,records}=install();
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const button=await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'});
    fireEvent.click(button);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls.map(call=>call[1].targetKey)).toEqual(targets.map(t=>t.key));
    for(const call of generate.mock.calls){
      expect(call[0]).toBe('A');
      expect(call[1]).toMatchObject({authorized:true,regenerate:false,acknowledgeUnknown:false,
        model:'nano_banana_2',aspectRatio:'9:16'});
    }
    expect(records()).toHaveLength(2);
    expect(await screen.findByTestId('image-batch-progress')).toHaveTextContent('2 / 2 requests submitted');
    expect(screen.getByRole('button',{name:'Generate All Ready (0 paid attempts)'})).toBeDisabled();
  });
  it('F23-BULK-01 two superseded same-token image attempts regenerate in an owner-started paid batch',async()=>{
    const prior=[
      {...job('old-approved-a',0,'APPROVED'),targetCreativeSha256:'9'.repeat(64),
        styleProfileSha256:'c'.repeat(64)},
      {...job('old-stale-b',1,'STALE'),targetCreativeSha256:'8'.repeat(64),
        styleProfileSha256:'c'.repeat(64)}
    ];
    const {generate}=install(prior);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const button=await screen.findByRole('button',{
      name:'Generate All Ready (2 paid attempts · 2 regenerations)'
    });
    expect(button).toBeEnabled();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls.map(call=>call[1].targetKey)).toEqual(targets.map(item=>item.key));
    for(const call of generate.mock.calls){
      expect(call[1]).toMatchObject({authorized:true,acknowledgeUnknown:false,regenerate:true});
    }
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('F23-BULK-02 current VALIDATED and active/UNKNOWN images never enter ordinary Generate All',async()=>{
    const current=[
      {...job('validated-a',0,'VALIDATED'),targetCreativeSha256:'a'.repeat(64),
        styleProfileSha256:'c'.repeat(64)},
      {...job('running-b',1,'RUNNING'),targetCreativeSha256:'b'.repeat(64),
        styleProfileSha256:'c'.repeat(64)}
    ];
    const {generate}=install(current);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    expect(await screen.findByRole('button',{name:'Generate All Ready (0 paid attempts)'}))
      .toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('BULK-03 a prior UNKNOWN attempt is excluded from bulk and never acknowledged',async()=>{
    const {generate}=install([job('uncertain-1',0,'UNKNOWN')]);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const button=await screen.findByRole('button',{name:'Generate All Ready (1 paid attempts)'});
    fireEvent.click(button);
    await waitFor(()=>expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:targets[1].key,acknowledgeUnknown:false,regenerate:false
    }));
    fireEvent.click(screen.getByRole('button',{name:'Review UNKNOWN'}));
    expect(screen.getByTestId('unknown-attempt-evidence')).toHaveTextContent('uncertain-1');
  });
  it('BULK-04 Stop after current request never posts a second image',async()=>{
    const {generate}=install();
    let finish!:(value:ImageJob)=>void;
    const first=new Promise<ImageJob>(resolve=>{finish=resolve;});
    const delayed=vi.fn(async()=>first);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:delayed
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'}));
    await waitFor(()=>expect(delayed).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('sh-a/layer-a');
    fireEvent.click(screen.getByRole('button',{name:'Stop after current request'}));
    finish(job('completed-first',0));
    await waitFor(()=>expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('Batch stopped'));
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
  it('BULK-05 project switch cancels outstanding bulk without posting on project B',async()=>{
    install();
    let finish!:(value:ImageJob)=>void;
    const gate=new Promise<ImageJob>(resolve=>{finish=resolve;});
    const delayed=vi.fn(async()=>gate);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:delayed
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'}));
    await waitFor(()=>expect(delayed).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    finish(job('completed-a',0));
    await waitFor(()=>expect(screen.getByText(/Current Project Style:/).closest('div')).toHaveTextContent('B2'));
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('image-batch-progress')).not.toBeInTheDocument();
  });
  it('BULK-07 a newly UNKNOWN provider outcome stops the batch before billing another target',async()=>{
    install();
    const generate=vi.fn(async()=>job('uncertain-first',0,'UNKNOWN'));
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:generate
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'}));
    await waitFor(()=>expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('Batch stopped'));
    expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('UNKNOWN');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('A',expect.objectContaining({
      targetKey:targets[0].key,acknowledgeUnknown:false,regenerate:false
    }));
  });
  it('BULK-08 changing Native DRAFT token stops the next paid POST',async()=>{
    install();
    let reads=0;
    const before=window.studio!;
    const read=vi.fn(async(id:string)=>{
      reads++;
      return reads>=3?{...pending(id),token:'corrected-new-token'}:pending(id);
    });
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...before,pendingMedia:read
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Generate All Ready (2 paid attempts)'}));
    await waitFor(()=>expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('Batch stopped'));
    expect(screen.getByTestId('image-batch-progress')).toHaveTextContent('Native DRAFT changed');
    expect(read).toHaveBeenCalled();
    // Only one submission happened. The second target is never authorized
    // against the corrected Native source identity.
    expect(vi.mocked(before.glabsGenerate)).toHaveBeenCalledTimes(1);
  });
  it('BULK-06 while one paid submission is unresolved, UI shows progress and Shot navigation stays usable',async()=>{
    install();
    let finish!:(value:ImageJob)=>void;
    const gate=new Promise<ImageJob>(resolve=>{finish=resolve;});
    const delayed=vi.fn(async()=>gate);
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,glabsGenerate:delayed
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'Generate Image · layer-a'}));
    expect(await screen.findByTestId('image-submitting')).toHaveTextContent('Submitting image sh-a/layer-a');
    fireEvent.click(screen.getByRole('button',{name:/sh-b 1 images/}));
    expect(screen.getByTestId('shot-image-gallery')).toHaveTextContent('layer-b');
    expect(delayed).toHaveBeenCalledTimes(1);
    finish(job('single-finished',0));
    await waitFor(()=>expect(screen.queryByTestId('image-submitting')).not.toBeInTheDocument());
    expect(delayed).toHaveBeenCalledTimes(1);
  });
  it('AUTO-UI-01 provider completion event displays the generated image without a manual Check Now click',async()=>{
    const running=job('provider-running',0,'RUNNING');
    const {generate,mediaUrl}=install([running]);
    let notify!: (change:{projectId:string;job:ImageJob})=>void;
    const unsubscribe=vi.fn();
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,onGlabsJobChanged:(listener:typeof notify)=>{
        notify=listener;
        return unsubscribe;
      }
    }});
    const view=render(<AppStateProvider><Harness/></AppStateProvider>);
    await screen.findByText('Auto-checking provider…');
    const completed={...running,status:'VALIDATED',staged:{
      path:'assets/images/completed.png',sha256:'f'.repeat(64),width:768,height:1376
    }};
    await act(async()=>{notify({projectId:'A',job:completed});});
    const image=await screen.findByRole('img',{name:'Shot gallery sh-a/layer-a'});
    await waitFor(()=>expect(image).toHaveAttribute(
      'src','studio-media://A/assets/images/completed.png'));
    expect(screen.getByTestId('shot-image-gallery')).toHaveTextContent('Ready to approve');
    expect(mediaUrl).toHaveBeenCalledWith('A','assets/images/completed.png');
    expect(generate).not.toHaveBeenCalled();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('AUTO-UI-03 an early completed provider event survives an older initial jobs snapshot and delayed preparation',async()=>{
    const running=job('early-completion',0);
    install([running]);
    let finishPrepare!:(result:ReturnType<typeof prepared>)=>void;
    const slowPrepare=new Promise<ReturnType<typeof prepared>>(resolve=>{finishPrepare=resolve;});
    let notify!: (change:{projectId:string;job:ImageJob})=>void;
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,prepareImages:()=>slowPrepare,
      onGlabsJobChanged:(listener:typeof notify)=>{notify=listener;return()=>undefined;}
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await waitFor(()=>expect(typeof notify).toBe('function'));
    const complete={...running,status:'VALIDATED',staged:{
      path:'assets/images/early-completed.png',sha256:'f'.repeat(64),width:768,height:1376
    }};
    await act(async()=>{notify({projectId:'A',job:complete});});
    finishPrepare(prepared('A'));
    const image=await screen.findByRole('img',{name:'Shot gallery sh-a/layer-a'});
    await waitFor(()=>expect(image).toHaveAttribute(
      'src','studio-media://A/assets/images/early-completed.png'));
    expect(screen.getByTestId('shot-image-gallery')).toHaveTextContent('Ready to approve');
  });
  it('AUTO-UI-02 a late image event from project A cannot appear in project B',async()=>{
    install([job('running-a',0)]);
    let notify!: (change:{projectId:string;job:ImageJob})=>void;
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,onGlabsJobChanged:(listener:typeof notify)=>{
        notify=listener;return()=>undefined;
      }
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await screen.findByText('Auto-checking provider…');
    fireEvent.click(screen.getByRole('button',{name:'Switch B'}));
    await waitFor(()=>expect(screen.getByTestId('shot-image-gallery')).toBeInTheDocument());
    await act(async()=>{notify({projectId:'A',job:{
      ...job('running-a',0,'VALIDATED'),staged:{
        path:'assets/images/old-A.png',sha256:'a'.repeat(64),width:768,height:1376
      }
    }});});
    expect(screen.queryByRole('img',{name:'Shot gallery sh-a/layer-a'})).not.toBeInTheDocument();
    expect(screen.getByTestId('shot-image-gallery')).toBeInTheDocument();
  });
  it('F17-UI-01 a late lower-revision RUNNING event never replaces journal-validated image',async()=>{
    const ready={...job('revision-ordered',0,'VALIDATED'),journalRevision:9,
      staged:{path:'assets/images/verified.png',sha256:'a'.repeat(64),
        width:768,height:1376}};
    const {generate}=install([ready]);
    let notify!:(change:{projectId:string;job:ImageJob})=>void;
    Object.defineProperty(window,'studio',{configurable:true,value:{
      ...window.studio,onGlabsJobChanged:(listener:typeof notify)=>{
        notify=listener;return()=>undefined;
      }
    }});
    render(<AppStateProvider><Harness/></AppStateProvider>);
    const card=(await screen.findAllByTestId('shot-image-card'))[0];
    const image=await screen.findByRole('img',{name:'Shot gallery sh-a/layer-a'});
    expect(image).toHaveAttribute('src','studio-media://A/assets/images/verified.png');
    await act(async()=>{notify({projectId:'A',job:{
      ...job('revision-ordered',0,'RUNNING'),journalRevision:8
    }});});
    expect(card).toHaveTextContent('Ready to approve');
    expect(screen.getByRole('img',{name:'Shot gallery sh-a/layer-a'}))
      .toHaveAttribute('src','studio-media://A/assets/images/verified.png');
    expect(generate).not.toHaveBeenCalled();
  });
  it('PERF-01 on-demand preview URL resolves only selected candidate, not every staged job',async()=>{
    const a={...job('candidate-a',0,'VALIDATED'),staged:{
      path:'assets/images/a-staged.png',sha256:'a'.repeat(64),width:90,height:160
    }};
    const b={...job('candidate-b',1,'VALIDATED'),staged:{
      path:'assets/images/b-staged.png',sha256:'b'.repeat(64),width:90,height:160
    }};
    const {mediaUrl}=install([a,b]);
    render(<AppStateProvider><Harness/></AppStateProvider>);
    await screen.findByRole('img',{name:'Shot gallery sh-a/layer-a'});
    await waitFor(()=>expect(mediaUrl).toHaveBeenCalledTimes(1));
    expect(mediaUrl).toHaveBeenLastCalledWith('A','assets/images/a-staged.png');
    fireEvent.click(screen.getByRole('button',{name:/sh-b 1 images/}));
    await screen.findByRole('img',{name:'Shot gallery sh-b/layer-b'});
    await waitFor(()=>expect(mediaUrl).toHaveBeenCalledTimes(2));
    expect(mediaUrl).toHaveBeenLastCalledWith('A','assets/images/b-staged.png');
  });
});
