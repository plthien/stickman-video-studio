import {useState} from 'react';
import fs from 'node:fs';
import path from 'node:path';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ShotImageGallery,type GalleryCard} from '../../src/renderer/features/storyboard/ShotImageGallery';

const images=[
  {layerId:'portrait',width:768,height:1365,status:'VALIDATED'},
  {layerId:'square',width:1024,height:1024,status:'VALIDATED'},
  {layerId:'landscape',width:1280,height:720,status:'VALIDATED'},
  {layerId:'offratio',width:768,height:1376,status:'VALIDATED'},
  {layerId:'missing',width:0,height:0,status:'NONE'}
] as const;
const cards:GalleryCard[]=images.map((item,index)=>{
  const job=item.status==='NONE'?null:{
    id:'candidate-'+index,projectId:'A',token:'token-A',status:item.status,
    targetKey:'image:0:'+item.layerId,shotId:'shot-1',
    layerId:item.layerId,targetPath:'assets/images/'+item.layerId+'.png',
    model:'nano_banana_2',aspectRatio:'9:16',
    prompt:'Verified exact frozen image target',
    staged:{path:'assets/images/glabs-'+item.layerId+'.png',
      sha256:String(index+1).repeat(64),width:item.width,height:item.height}
  } as NonNullable<GalleryCard['job']>;
  return{
    target:{key:'image:0:'+item.layerId,shotId:'shot-1',
      layerId:item.layerId,path:'assets/images/'+item.layerId+'.png',
      boundPath:'assets/images/'+item.layerId+'.png',fulfilled:false,managed:true},
    job,history:job?[job]:[],spec:null
  };
});
const urls=Object.fromEntries(cards.filter(card=>card.job).map(card=>
  [card.job!.id,'studio-media://A/'+card.job!.staged!.path]));
/** Complete source-backed Native image spec; no partial fixture type assertions. */
function preparedSpec(layerId:string):NonNullable<GalleryCard['spec']>{
  const target=cards.find(card=>card.target.layerId===layerId)!.target;
  const prompt='Verified source-grounded image instructions';
  return{
    assetKey:target.key,targetKeys:[target.key],expectedPaths:[target.path],
    shotId:target.shotId,layerId,targetKey:target.key,path:target.path,
    assetKind:'other',state:'READY',reason:'',prompt,
    promptSha256:'d'.repeat(64),effectivePrompt:prompt,
    effectivePromptSha256:'d'.repeat(64),sourceDescription:'verified source',
    sourceLedger:'',sourceRows:[],
    references:[],styleAnchors:[],
    styleProfileRef:{id:'B1',sha256:'b'.repeat(64),path:'references/b1-minimal-handdrawn.md'},
    draftIdentity:{projectId:'A',authorTaskId:'author-A',token:'token-A',revision:1,
      creativeFingerprint:'a'.repeat(64)},
    occurrencesAtPath:1,ownerEdited:false
  };
}
function Harness({approve=vi.fn(),generate=vi.fn(),shown=cards}:{
  approve?:(id:string)=>void;generate?:(key:string)=>void;shown?:GalleryCard[]
}){
  const [ready,setReady]=useState<Record<string,string>>({});
  const [checked,setChecked]=useState<Set<string>>(new Set());
  const identity=(job:NonNullable<GalleryCard['job']>)=>job.id+':'+job.staged?.sha256;
  return <ShotImageGallery projectId="A" shotId="shot-1" cards={shown} urls={urls}
    previewIdentity={identity} previewReady={ready} previewErrors={{}}
    busy={false} selectedIds={checked}
    onLoaded={(job,ok)=>{
      if(ok)setReady(previous=>({...previous,[job.id]:identity(job)}));
    }}
    onSelect={(id,on)=>setChecked(previous=>{
      const next=new Set(previous);if(on)next.add(id);else next.delete(id);
      return next;
    })}
    onGenerate={generate} onApprove={approve}
    onCheck={vi.fn()} onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>;
}
function loaded(image:HTMLElement){
  Object.defineProperty(image,'complete',{configurable:true,value:true});
  Object.defineProperty(image,'naturalWidth',{configurable:true,value:768});
  Object.defineProperty(image,'naturalHeight',{configurable:true,value:1376});
  fireEvent.load(image);
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('F09 Native Shot full-card gallery without selecting Layers',()=>{
  it('F09-01 shows all five frozen Layers simultaneously with accurate job statuses',()=>{
    render(<Harness/>);
    const all=screen.getAllByTestId('shot-image-card');
    expect(all).toHaveLength(5);
    for(const image of images)
      expect(screen.getByText(image.layerId,{selector:'strong'})).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(4);
    expect(screen.getAllByText('Not Generated').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('shot-image-gallery')).toHaveTextContent('5 Native image Layers');
  });
  it('F09-02 uses equal-height thumbnail stages for 9:16, 1:1, 16:9 and off-ratio images',()=>{
    render(<Harness/>);
    const stages:HTMLElement[]=[];
    for(const item of images.slice(0,4)){
      const card=screen.getAllByTestId('shot-image-card')
        .find(node=>node.getAttribute('data-layer-id')===item.layerId)!;
      const stage=within(card).getByTestId('shot-image-stage');
      stages.push(stage);
      // No dynamic ratio, width or height is set by the provider output.
      expect(stage).not.toHaveAttribute('style');
      const image=within(card).getByRole('img') as HTMLImageElement;
      expect(image).toHaveAttribute('width',String(item.width));
      expect(image).toHaveAttribute('height',String(item.height));
      expect(image).toHaveStyle({objectFit:'contain'});
    }
    expect(new Set(stages.map(stage=>stage.className))).toEqual(new Set(['shot-image-card-stage']));
  });
  it('F11-01 approval requires actual decoded preview before one owner click',()=>{
    const approve=vi.fn();render(<Harness approve={approve}/>);
    const card=screen.getAllByTestId('shot-image-card')[0];
    const action=within(card).getByRole('button',{name:'Approve Image'});
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(approve).not.toHaveBeenCalled();
    loaded(within(card).getByRole('img'));
    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith('candidate-0');
  });
  it('F11-02 selected candidate checkboxes do not select or approve a third Layer',()=>{
    const approve=vi.fn();render(<Harness approve={approve}/>);
    const all=screen.getAllByTestId('shot-image-card');
    for(const card of all.slice(0,3))loaded(within(card).getByRole('img'));
    fireEvent.click(within(all[0]).getByRole('checkbox',{name:'Select portrait'}));
    fireEvent.click(within(all[1]).getByRole('checkbox',{name:'Select square'}));
    expect(within(all[0]).getByRole('checkbox')).toBeChecked();
    expect(within(all[1]).getByRole('checkbox')).toBeChecked();
    expect(within(all[2]).getByRole('checkbox')).not.toBeChecked();
    expect(approve).not.toHaveBeenCalled();
  });
  it('F13-UI-01 superseded APPROVED history does not appear as currently approved',()=>{
    const old=cards[0].job!,base=preparedSpec('portrait');
    const superseded:GalleryCard={
      ...cards[0],target:{...cards[0].target,fulfilled:false},
      job:null,history:[{...old,status:'APPROVED'}],
      superseded:true,currentlyBound:false,spec:{
        ...base,prompt:'Verified creative target prompt',
        draftIdentity:{...base.draftIdentity,creativeFingerprint:'f'.repeat(64)}
      }
    };
    render(<ShotImageGallery projectId="A" shotId="shot-1" cards={[superseded]} urls={{}}
      previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const card=screen.getByTestId('shot-image-card');
    expect(card).toHaveTextContent('Needs Regeneration');
    expect(within(card).queryByText('Approved')).not.toBeInTheDocument();
    expect(within(card).getByRole('button',{
      name:'Regenerate for Current Draft (Paid) · portrait'
    })).toBeEnabled();
  });
  it('F15-UI-01 extreme generated ratio remains intrinsic with contain and uncropped expansion',()=>{
    const base=cards[0].job!;
    const extreme:GalleryCard={
      ...cards[0],
      job:{...base,id:'extreme-ratio',staged:{
        path:'assets/images/extreme.png',sha256:'e'.repeat(64),
        width:2000,height:125
      }},
      history:[],
    };
    render(<ShotImageGallery projectId="A" shotId="shot-1" cards={[extreme]}
      urls={{'extreme-ratio':'studio-media://A/extreme'}}
      previewIdentity={job=>job.id+':'+job.staged?.sha256}
      previewReady={{'extreme-ratio':'extreme-ratio:'+extreme.job!.staged!.sha256}}
      previewErrors={{}} busy={false} selectedIds={new Set()}
      onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const stage=screen.getByTestId('shot-image-stage');
    expect(stage).not.toHaveAttribute('style');
    expect(within(stage).getByRole('img')).toHaveStyle({objectFit:'contain'});
    fireEvent.click(within(stage).getByRole('button',{name:'Expand image shot-1/portrait'}));
    expect(within(screen.getByRole('dialog',{name:'Expanded generated image'}))
      .getByRole('img')).toHaveStyle({objectFit:'contain'});
  });
  it('F14-UI-01 card details edit only its source prompt and B4 approved reference',async()=>{
    const save=vi.fn();
    const base=preparedSpec('portrait');
    const prepared:NonNullable<GalleryCard['spec']>={
      ...base,prompt:'Verified creative illustration request',
      effectivePrompt:'Verified creative illustration request',
      styleProfileRef:{id:'B4',sha256:'b'.repeat(64),path:'references/b4-approved.md'},
      styleAnchors:[{id:'b4-approved-1',label:'Approved B4 illustration',
        sha256:'b'.repeat(64)}],
      draftIdentity:{...base.draftIdentity,creativeFingerprint:'c'.repeat(64)}
    };
    render(<ShotImageGallery projectId="A" shotId="shot-1"
      cards={[{...cards[0],spec:prepared}]} urls={urls}
      previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}
      onSavePrompt={save}/>);
    const card=screen.getByTestId('shot-image-card');
    fireEvent.click(within(card).getByText(/Prompt · references · candidate history/));
    const edit=await within(card).findByLabelText('Edit image prompt portrait');
    fireEvent.change(edit,{target:{value:'Owner authored exact image description'}});
    fireEvent.change(within(card).getByLabelText('Verified B4 reference portrait'),{
      target:{value:'@modeb/b4/b4-approved-1'}
    });
    fireEvent.click(within(card).getByRole('button',{name:'Save Image Prompt & References'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith(cards[0].target.key,
      'Owner authored exact image description',['@modeb/b4/b4-approved-1']));
    expect(screen.queryByLabelText('Owner-confirmed rights/source')).not.toBeInTheDocument();
    expect(screen.queryByText(/Layer Inspector/)).not.toBeInTheDocument();
  });
  it('F20-UI-01 VALIDATED unbound candidate offers approve and explicit paid regeneration from its Shot card',()=>{
    const generate=vi.fn(),approve=vi.fn();
    const spec=preparedSpec('portrait');
    const old={...cards[0],spec};
    const original=old.job!;
    const view=render(<ShotImageGallery projectId="A" shotId="shot-1"
      cards={[old]} urls={{[original.id]:'studio-media://A/original.png'}}
      previewIdentity={job=>job.id+':'+job.staged?.sha256} previewReady={{}}
      previewErrors={{}} busy={false} selectedIds={new Set()} onLoaded={vi.fn()}
      onSelect={vi.fn()} onGenerate={generate} onApprove={approve} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const card=screen.getByTestId('shot-image-card');
    expect(within(card).getByRole('button',{name:'Approve Image'})).toBeDisabled();
    const regenerate=within(card).getByRole('button',{name:'Regenerate Image (Paid) · portrait'});
    expect(regenerate).toBeEnabled();
    fireEvent.load(within(card).getByRole('img'));
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(regenerate);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('image:0:portrait');
    expect(approve).not.toHaveBeenCalled();
    const newer={...original,id:'new-validated',staged:{...original.staged!,sha256:'f'.repeat(64)}};
    view.rerender(<ShotImageGallery projectId="A" shotId="shot-1"
      cards={[{...old,job:newer,history:[newer,original]}]}
      urls={{[newer.id]:'studio-media://A/new.png'}}
      previewIdentity={job=>job.id+':'+job.staged?.sha256}
      previewReady={{[original.id]:original.id+':'+original.staged?.sha256}}
      previewErrors={{}} busy={false} selectedIds={new Set()} onLoaded={vi.fn()}
      onSelect={vi.fn()} onGenerate={generate} onApprove={approve} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'Approve Image'})).toBeDisabled();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('F20-UI-02 currently bound APPROVED output cannot be replaced via ordinary Generate',()=>{
    const original=cards[0].job!;
    const approved:GalleryCard={...cards[0],
      target:{...cards[0].target,fulfilled:true},
      job:{...original,status:'APPROVED'},history:[{...original,status:'APPROVED'}],
      currentlyBound:true};
    render(<ShotImageGallery projectId="A" shotId="shot-1" cards={[approved]}
      urls={{}} previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Regenerate|Generate Image/})).not.toBeInTheDocument();
  });
  it('F21/F22-UI provider status GET failures expose GET-only recovery with no paid CTA',()=>{
    const current={...cards[0],job:{...cards[0].job!,status:'RUNNING' as const,
      providerTaskId:'ab12cd34',syncPhase:'provider' as const,
      lastSyncError:{stage:'provider',code:'GLABS_TRANSPORT_UNKNOWN',at:'2026-11-21T00:00:00Z'}}};
    const check=vi.fn(),generate=vi.fn();
    render(<ShotImageGallery projectId="A" shotId="shot-1" cards={[current]}
      urls={{}} previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={generate} onApprove={vi.fn()} onCheck={check}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const card=screen.getByTestId('shot-image-card');
    expect(card).toHaveTextContent('Provider status unavailable');
    expect(within(card).getByTestId('glabs-sync-evidence')).toHaveTextContent('ab12cd34');
    expect(within(card).getByTestId('glabs-sync-evidence')).toHaveTextContent('GLABS_TRANSPORT_UNKNOWN');
    expect(within(card).queryByRole('button',{name:/Regenerate Image/})).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button',{name:'Retry Sync (GET only)'}));
    expect(check).toHaveBeenCalledWith(current.job!.id);
    expect(generate).not.toHaveBeenCalled();
  });
  it('F21-UI completed ingestion failure retains read-only Retry Sync, blocks paid fallback',()=>{
    const current={...cards[0],job:{...cards[0].job!,status:'DOWNLOADED' as const,
      providerTaskId:'ab12cd34',providerCompletedAt:'2026-11-21T00:00:00Z',
      lastSyncError:{stage:'download',code:'GLABS_DECLARED_MIME_UNSUPPORTED',at:'2026-11-21T00:00:01Z'}}};
    const check=vi.fn(),generate=vi.fn();
    render(<ShotImageGallery projectId="A" shotId="shot-1" cards={[current]}
      urls={{}} previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={generate} onApprove={vi.fn()} onCheck={check}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const card=screen.getByTestId('shot-image-card');
    expect(within(card).getByTestId('glabs-ingestion-regenerate-blocked'))
      .toHaveTextContent('Paid regeneration blocked');
    expect(within(card).getByRole('button',{name:'Retry Sync (GET only)'})).toBeEnabled();
    expect(within(card).queryByRole('button',{name:/Regenerate Image/})).not.toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });
  it('F09-03 expands a current candidate without switching Shot and keeps details collapsed',()=>{
    render(<Harness/>);
    const card=screen.getAllByTestId('shot-image-card')[3];
    expect(within(card).getByText(/Prompt · references · candidate history/).closest('details'))
      .not.toHaveAttribute('open');
    loaded(within(card).getByRole('img'));
    const trigger=within(card).getByRole('button',{name:'Expand image shot-1/offratio'});
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    const modal=screen.getByRole('dialog',{name:'Expanded generated image'});
    expect(modal).toHaveTextContent('shot-1 / offratio');
    expect(within(modal).getByRole('img')).toHaveStyle({objectFit:'contain'});
    fireEvent.click(within(modal).getByRole('button',{name:'Close Preview'}));
    expect(screen.queryByRole('dialog',{name:'Expanded generated image'})).not.toBeInTheDocument();
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(5);
  });
});


describe('F25 compact fixed-card thumbnail gallery and accessible original-size lightbox',()=>{
  const css=fs.readFileSync(path.resolve('src/renderer/styles/global.css'),'utf8');
  function openPortrait(){
    const portrait=screen.getAllByTestId('shot-image-card')[0];
    const trigger=within(portrait).getByRole('button',{name:'Expand image shot-1/portrait'});
    loaded(within(portrait).getByRole('img'));
    expect(trigger).toBeEnabled();
    trigger.focus();
    fireEvent.click(trigger);
    return{portrait,trigger,dialog:screen.getByRole('dialog',{name:'Expanded generated image'})};
  }
  it('F25-TEST-01 one card and five cards both use non-stretch 200px grid tracks and 160px stages',()=>{
    render(<Harness shown={[cards[0]]}/>);
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(1);
    const grid=screen.getByTestId('shot-image-card').parentElement!;
    const oneStage=screen.getByTestId('shot-image-stage');
    expect(grid).toHaveClass('shot-image-gallery-grid');
    expect(oneStage).not.toHaveAttribute('style');
    cleanup();
    render(<Harness/>);
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(5);
    expect(screen.getAllByTestId('shot-image-stage')).toHaveLength(5);
    const style=document.createElement('style');
    style.textContent=css.slice(css.indexOf('/* F25 compact Native Shot gallery.'));
    document.head.appendChild(style);
    try{
      const computed=window.getComputedStyle(screen.getAllByTestId('shot-image-card')[0]);
      expect(computed.maxWidth).toBe('200px');
      for(const stage of screen.getAllByTestId('shot-image-stage')){
        expect(window.getComputedStyle(stage).height).toBe('160px');
        expect(window.getComputedStyle(stage).minHeight).toBe('160px');
        expect(stage).not.toHaveAttribute('style');
      }
      const layout=window.getComputedStyle(screen.getAllByTestId('shot-image-card')[0].parentElement!);
      expect(layout.display).toBe('grid');
      expect(layout.gap).toBe('12px');
    }finally{style.remove();}
  });
  it('F25-TEST-02 mixed image ratios and empty state keep image dimensions without cropping or reflow',()=>{
    render(<Harness/>);
    for(const item of images){
      const card=screen.getAllByTestId('shot-image-card')
        .find(node=>node.getAttribute('data-layer-id')===item.layerId)!;
      const stage=within(card).getByTestId('shot-image-stage');
      expect(stage.className).toContain('shot-image-card-stage');
      expect(stage).not.toHaveAttribute('style');
      if(item.status==='NONE'){
        expect(stage).toHaveClass('is-placeholder');
        expect(stage).toHaveTextContent('Not Generated');
      }else{
        const image=within(stage).getByRole('img');
        expect(image).toHaveAttribute('width',String(item.width));
        expect(image).toHaveAttribute('height',String(item.height));
        expect(image).toHaveStyle({objectFit:'contain'});
      }
    }
  });
  it('F25-TEST-03 a verified thumbnail opens the exact candidate; missing/unloaded URL is not actionable',()=>{
    const generate=vi.fn(),approve=vi.fn();
    render(<Harness generate={generate} approve={approve}/>);
    const card=screen.getAllByTestId('shot-image-card')[2];
    const trigger=within(card).getByRole('button',{name:'Expand image shot-1/landscape'});
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    loaded(within(card).getByRole('img'));
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    const modal=screen.getByRole('dialog',{name:'Expanded generated image'});
    expect(within(modal).getByRole('img')).toHaveAttribute('src',urls['candidate-2']);
    expect(within(modal).getByRole('img')).toHaveAttribute('width','1280');
    expect(within(modal).getByRole('img')).toHaveAttribute('height','720');
    expect(modal).toHaveAttribute('aria-modal','true');
    expect(generate).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    const missing=screen.getAllByTestId('shot-image-card')[4];
    expect(within(missing).queryByRole('button',{name:/Expand image/})).not.toBeInTheDocument();
  });
  it('F25-TEST-04 Fit Screen is default and Original is exact CSS pixel size with scrollable viewport',()=>{
    render(<Harness/>);
    const {dialog}=openPortrait();
    const fit=within(dialog).getByRole('button',{name:'Fit Screen'});
    const original=within(dialog).getByRole('button',{name:'100% Original'});
    const image=within(dialog).getByRole('img');
    expect(fit).toHaveAttribute('aria-pressed','true');
    expect(original).toHaveAttribute('aria-pressed','false');
    expect(image).toHaveStyle({width:'auto',height:'auto',maxWidth:'100%',maxHeight:'100%'});
    expect(within(dialog).getByTestId('shot-image-preview-viewport')).toHaveClass('is-fit');
    fireEvent.click(original);
    expect(original).toHaveAttribute('aria-pressed','true');
    expect(image).toHaveStyle({
      width:'768px',height:'1365px',maxWidth:'none',maxHeight:'none',objectFit:'contain'
    });
    expect(within(dialog).getByTestId('shot-image-preview-viewport')).toHaveClass('is-original');
    fireEvent.click(fit);
    expect(image).toHaveStyle({width:'auto',height:'auto',maxWidth:'100%',maxHeight:'100%'});
    expect(within(dialog).getByTestId('shot-image-preview-viewport')).toHaveClass('is-fit');
  });
  it('F25-TEST-05 ESC, Close and backdrop dismiss and restore focus without event fallthrough',()=>{
    const approve=vi.fn(),generate=vi.fn();
    render(<Harness approve={approve} generate={generate}/>);
    let {trigger,dialog}=openPortrait();
    const close=within(dialog).getByRole('button',{name:'Close Preview'});
    const fit=within(dialog).getByRole('button',{name:'Fit Screen'});
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document,{key:'Tab'});
    expect(document.activeElement).toBe(fit);
    fireEvent.keyDown(document,{key:'Tab',shiftKey:true});
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document,{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'Expanded generated image'})).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    dialog=screen.getByRole('dialog',{name:'Expanded generated image'});
    fireEvent.click(within(dialog).getByRole('button',{name:'Close Preview'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    dialog=screen.getByRole('dialog',{name:'Expanded generated image'});
    fireEvent.click(within(dialog).getByRole('button',{name:'Fit Screen'}));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    expect(generate).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
  it('F25-TEST-06/07 loading and navigating preview never approves, generates or regenerates',()=>{
    const approve=vi.fn(),generate=vi.fn();render(<Harness approve={approve} generate={generate}/>);
    const card=screen.getAllByTestId('shot-image-card')[0];
    const approveButton=within(card).getByRole('button',{name:'Approve Image'});
    expect(approveButton).toBeDisabled();
    loaded(within(card).getByRole('img'));
    expect(approveButton).toBeEnabled();
    const {dialog}=openPortrait();
    fireEvent.click(within(dialog).getByRole('button',{name:'100% Original'}));
    fireEvent.click(within(dialog).getByRole('button',{name:'Fit Screen'}));
    fireEvent.click(within(dialog).getByRole('button',{name:'Close Preview'}));
    expect(approve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(5);
  });
  it('F25-TEST-09 responsive grid uses a bounded track with no fractional expansion',()=>{
    render(<Harness/>);
    const grid=screen.getAllByTestId('shot-image-card')[0].parentElement!;
    expect(grid).toHaveClass('shot-image-gallery-grid');
    expect(css).toMatch(/\.shot-image-gallery-grid\{[^}]*grid-template-columns:repeat\(auto-fill,min\(200px, 100%\)\)/);
    expect(css).not.toMatch(/\.shot-image-gallery-grid\{[^}]*grid-template-columns:[^;}]*1fr/);
    expect(css).toMatch(/\.shot-image-card\{[^}]*max-width:200px/);
    expect(css).toMatch(/\.shot-image-card-stage\{[^}]*height:160px/);
    expect(css).toMatch(/\.shot-image-lightbox-viewport\.is-original\{[^}]*overflow:auto/);
  });
});
