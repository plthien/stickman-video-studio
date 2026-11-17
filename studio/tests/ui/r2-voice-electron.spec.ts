import {test,expect,chromium,type Browser} from '@playwright/test';
import {createRequire} from 'node:module';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

const electronPath=createRequire(import.meta.url)('electron') as string;
const exec=promisify(execFile);
const onWindows=process.platform==='win32'&&!process.env.ELECTRON_RUN_AS_NODE;
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const acceptedWav=()=>{
  const sampleRate=24000,frames=sampleRate*3,bytes=Buffer.alloc(44+frames*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);
  bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)
    bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/sampleRate)*6000),44+i*2);
  return bytes;
};
async function stop(child:ChildProcess){
  if(child.pid)try{await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F']);}catch{/*already exited*/}
}
test('PB-01 real Windows Electron Chromium decodes and plays accepted 24-kHz PCM16 WAV',async()=>{
  test.skip(!onWindows,'Requires real Windows Electron GUI (not CI or browser-only emulation).');
  test.setTimeout(180_000);
  const parent=await mkdtemp(join(tmpdir(),'r2-voice-playback-'));
  const env={...process.env,MODE_B_STUDIO_DISABLE_GPU:'1',
    MODE_B_STUDIO_USER_DATA:resolve('test-results-electron','voice-media-e2e'),
    MODE_B_SKILL_ROOT:resolve('..','skills','directing-stickman-videos')};
  delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
  let output='',browser:Browser|undefined;
  const child=spawn(electronPath,['--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9342','--autoplay-policy=no-user-gesture-required','--no-sandbox','.'],
    {cwd:process.cwd(),env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout?.on('data',chunk=>output+=String(chunk));
  child.stderr?.on('data',chunk=>output+=String(chunk));
  try{
    let page;
    for(let attempt=0;attempt<120;attempt++){
      if(child.exitCode!==null)throw new Error('Electron exited: '+output);
      try{
        browser??=await chromium.connectOverCDP('http://127.0.0.1:9342',{timeout:700});
        page=browser.contexts().flatMap(context=>context.pages())
          .find(value=>!value.url().startsWith('devtools:'));
        if(page&&await page.locator('#root').count())break;
      }catch{/* waiting for actual renderer */}
      await new Promise(done=>setTimeout(done,500));
    }
    if(!page)throw new Error('Electron renderer unavailable: '+output);
    await page.locator('#project-parent').fill(parent);
    await page.getByPlaceholder('New project folder').fill('VoiceMedia');
    await page.getByLabel('Project title').fill('Voice Media E2E');
    await page.getByLabel('Topic / core idea').fill('Local accepted narration test');
    await page.getByLabel('Duration (seconds)').fill('60');
    await page.getByRole('button',{name:'Create native project'}).click();
    await expect(page.getByText(join(parent,'VoiceMedia'))).toBeVisible({timeout:90_000});
    const project=join(parent,'VoiceMedia'),statePath=join(project,'.studio','state.json');
    const bytes=acceptedWav(),wavPath=join(project,'assets','audio','narration.wav');
    await mkdir(join(project,'assets','audio'),{recursive:true});
    await writeFile(wavPath,bytes);
    const state=JSON.parse(await readFile(statePath,'utf8')) as Record<string,unknown>;
    const transcript='Hello test';
    state.approvedScript={sections:[{id:'a',text:transcript}],text:transcript,
      sha256:digest(transcript),revision:1,approvedAt:new Date().toISOString()};
    state.voice={path:'assets/audio/narration.wav',sha256:digest(bytes),duration:3,
      generatedAt:new Date().toISOString(),stale:false,origin:'IMPORTED_WAV'};
    await writeFile(statePath,JSON.stringify(state));
    await page.getByRole('button',{name:'Save project setup'}).click();
    await page.evaluate(()=>{location.hash='#/voice';});
    await expect(page.getByLabel('Accepted narration audio')).toBeVisible();
    await expect.poll(()=>page.getByLabel('Accepted narration audio')
      .evaluate(element=>(element as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
    const result=await page.getByLabel('Accepted narration audio').evaluate(async element=>{
      const audio=element as HTMLAudioElement;
      await audio.play();
      await new Promise(done=>setTimeout(done,650));
      return{currentTime:audio.currentTime,duration:audio.duration,
        errorCode:audio.error?.code??null,readyState:audio.readyState};
    });
    expect(result.errorCode).toBe(null);
    expect(result.readyState).toBeGreaterThanOrEqual(2);
    expect(result.currentTime).toBeGreaterThan(.2);
    expect(result.duration).toBeCloseTo(3,1);
  }finally{
    if(browser)await browser.close();
    await stop(child);
    await rm(parent,{recursive:true,force:true});
  }
});
