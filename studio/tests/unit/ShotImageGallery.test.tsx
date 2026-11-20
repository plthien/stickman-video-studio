import {useState} from 'react';
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
function Harness({approve=vi.fn(),generate=vi.fn()}:{
  approve?:(id:string)=>void;generate?:(key:string)=>void
}){
  const [ready,setReady]=useState<Record<string,string>>({});
  const [checked,setChecked]=useState<Set<string>>(new Set());
  const identity=(job:NonNullable<GalleryCard['job']>)=>job.id+':'+job.staged?.sha256;
  return <ShotImageGallery projectId="A" shotId="shot-1" cards={cards} urls={urls}
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
  it('F09-02 uses 9:16, 1:1, 16:9 and off-ratio dimensions without cropping',()=>{
    render(<Harness/>);
    for(const item of images.slice(0,4)){
      const card=screen.getAllByTestId('shot-image-card')
        .find(node=>node.getAttribute('data-layer-id')===item.layerId)!;
      expect(within(card).getByTestId('shot-image-stage')).toHaveStyle({
        aspectRatio:item.width+' / '+item.height
      });
      const image=within(card).getByRole('img') as HTMLImageElement;
      expect(image).toHaveAttribute('width',String(item.width));
      expect(image).toHaveAttribute('height',String(item.height));
      expect(image).toHaveStyle({objectFit:'contain'});
    }
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
    const old=cards[0].job!;
    const superseded:GalleryCard={
      ...cards[0],target:{...cards[0].target,fulfilled:false},
      job:null,history:[{...old,status:'APPROVED'}],
      superseded:true,currentlyBound:false,spec:{
        targetKey:cards[0].target.key,state:'READY',prompt:'Verified creative target prompt',
        references:[],draftIdentity:{creativeFingerprint:'f'.repeat(64)}
      } as GalleryCard['spec']
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
      name:'Regenerate for Current Draft · portrait'
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
      previewIdentity={()=>''} previewReady={{}} previewErrors={{}}
      busy={false} selectedIds={new Set()} onLoaded={vi.fn()} onSelect={vi.fn()}
      onGenerate={vi.fn()} onApprove={vi.fn()} onCheck={vi.fn()}
      onRetryPreview={vi.fn()} onInspectUnknown={vi.fn()}/>);
    const stage=screen.getByTestId('shot-image-stage');
    expect(stage).toHaveStyle({aspectRatio:'2000 / 125'});
    expect(within(stage).getByRole('img')).toHaveStyle({objectFit:'contain'});
    fireEvent.click(screen.getByRole('button',{name:'Expand Preview'}));
    expect(within(screen.getByRole('dialog',{name:'Expanded generated image'}))
      .getByRole('img')).toHaveStyle({objectFit:'contain'});
  });
  it('F14-UI-01 card details edit only its source prompt and B4 approved reference',async()=>{
    const save=vi.fn();
    const prepared={
      targetKey:cards[0].target.key,shotId:'shot-1',layerId:'portrait',
      state:'READY',reason:'',prompt:'Verified creative illustration request',
      promptSha256:'d'.repeat(64),sourceDescription:'verified source',
      sourceRows:[],references:[],styleProfileRef:{
        id:'B4',sha256:'b'.repeat(64),path:'references/b4-approved.md'
      },styleAnchors:[{id:'b4-approved-1',label:'Approved B4 illustration'}],
      draftIdentity:{token:'token-A',creativeFingerprint:'c'.repeat(64)}
    } as NonNullable<GalleryCard['spec']>;
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
  it('F09-03 expands a current candidate without switching Shot and keeps details collapsed',()=>{
    render(<Harness/>);
    const card=screen.getAllByTestId('shot-image-card')[3];
    expect(within(card).getByText(/Prompt · references · candidate history/).closest('details'))
      .not.toHaveAttribute('open');
    fireEvent.click(within(card).getByRole('button',{name:'Expand Preview'}));
    const modal=screen.getByRole('dialog',{name:'Expanded generated image'});
    expect(modal).toHaveTextContent('shot-1 / offratio');
    expect(within(modal).getByRole('img')).toHaveStyle({objectFit:'contain'});
    fireEvent.click(within(modal).getByRole('button',{name:'Close Preview'}));
    expect(screen.queryByRole('dialog',{name:'Expanded generated image'})).not.toBeInTheDocument();
    expect(screen.getAllByTestId('shot-image-card')).toHaveLength(5);
  });
});
