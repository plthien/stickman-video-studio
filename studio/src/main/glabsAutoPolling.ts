/**
 * Read-only G-Labs reconciliation coordinator.
 *
 * Unlike renderer setInterval polling this survives tab navigation and resumes
 * persisted provider jobs when a project is opened. The journal in glabs.ts is
 * the source of truth; this scheduler never re-POSTs, auto-regenerates or
 * approves media. Each job has at most one concurrent GET poll and only a
 * bounded number of polls may be in flight across projects.
 */
import type {GLabsJob} from './glabs.js';

export type PollJob=(projectId:string,jobId:string)=>Promise<GLabsJob>;
export interface PollCoordinatorOptions{
  intervalMs?:number;concurrency?:number;
  onJob:(projectId:string,job:GLabsJob)=>void;
  poll:PollJob;
  onError?:(projectId:string,jobId:string,error:unknown)=>void;
}
interface Entry{
  projectId:string;id:string;due:number;failures:number;signature:string;
}
const shouldPoll=(job:GLabsJob)=>
  ['SUBMITTED','RUNNING','DOWNLOADED'].includes(job.status)||
  (job.status==='UNKNOWN'&&Boolean(job.providerTaskId));
const keyFor=(projectId:string,id:string)=>projectId+'|'+id;
const signatureOf=(job:GLabsJob)=>JSON.stringify([
  job.status,job.providerTaskId??'',job.staged?.sha256??'',
  job.reason??'',job.approved?.sha256??''
]);

export function createGlabsAutoPolling(options:PollCoordinatorOptions){
  const interval=Math.max(1000,options.intervalMs??2500);
  const concurrency=Math.max(1,Math.min(3,options.concurrency??2));
  const entries=new Map<string,Entry>();
  const active=new Map<string,Promise<GLabsJob>>();
  let stopped=false;
  let timer:ReturnType<typeof setTimeout>|null=null;
  function clearSchedule(){
    if(timer){clearTimeout(timer);timer=null;}
  }
  function schedule(){
    if(stopped)return;
    clearSchedule();
    if(active.size>=concurrency)return;
    let earliest=Infinity;
    for(const [key,entry] of entries){
      if(active.has(key))continue;
      earliest=Math.min(earliest,entry.due);
    }
    if(!Number.isFinite(earliest))return;
    timer=setTimeout(()=>{timer=null;void runDue();},Math.max(0,earliest-Date.now()));
  }
  function observe(projectId:string,job:GLabsJob,reset=false){
    const key=keyFor(projectId,job.id);
    if(!shouldPoll(job)){
      entries.delete(key);
      schedule();
      return;
    }
    const current=entries.get(key);
    if(!current)entries.set(key,{projectId,id:job.id,
      due:Date.now()+(reset?interval:0),failures:0,signature:signatureOf(job)});
    schedule();
  }
  function observeAll(projectId:string,jobs:GLabsJob[]){
    const activeIds=new Set(jobs.filter(shouldPoll).map(job=>keyFor(projectId,job.id)));
    for(const key of entries.keys()){
      if(key.startsWith(projectId+'|')&&!activeIds.has(key))entries.delete(key);
    }
    for(const job of jobs)observe(projectId,job);
    schedule();
  }
  function runOne(projectId:string,id:string):Promise<GLabsJob>{
    const key=keyFor(projectId,id);
    const inflight=active.get(key);
    if(inflight)return inflight;
    // Reserve synchronously before asynchronous network polling starts.
    const operation=(async()=>{
      try{
        const result=await options.poll(projectId,id);
        if(stopped)return result;
        const previous=entries.get(key),signature=signatureOf(result);
        if(shouldPoll(result)){
          entries.set(key,{projectId,id,due:Date.now()+interval,failures:0,signature});
        }else entries.delete(key);
        // One event per actual provider transition, not hundreds of repeated
        // RUNNING events and React rerenders during large batches.
        if(!previous||previous.signature!==signature)options.onJob(projectId,result);
        return result;
      }catch(error){
        if(!stopped){
          const previous=entries.get(key);
          if(previous){
            const failures=Math.min(5,previous.failures+1);
            entries.set(key,{...previous,failures,
              due:Date.now()+Math.min(60_000,interval*2**failures)});
          }
          options.onError?.(projectId,id,error);
        }
        throw error;
      }finally{
        active.delete(key);
        schedule();
      }
    })();
    active.set(key,operation);
    return operation;
  }
  async function runDue(){
    if(stopped)return;
    for(const entry of [...entries.values()].sort((a,b)=>a.due-b.due)){
      if(active.size>=concurrency)break;
      if(entry.due>Date.now())break;
      const key=keyFor(entry.projectId,entry.id);
      if(active.has(key))continue;
      // Background failures are retained and retried as GET only with backoff.
      // Never leave an unhandled promise rejection.
      void runOne(entry.projectId,entry.id).catch(()=>undefined);
    }
    schedule();
  }
  function pollNow(projectId:string,id:string){
    if(stopped)return Promise.reject(new Error('GLABS_POLL_COORDINATOR_STOPPED'));
    return runOne(projectId,id);
  }
  function close(){
    stopped=true;clearSchedule();entries.clear();
  }
  function snapshot(){
    return{tracked:entries.size,inFlight:active.size};
  }
  return{observe,observeAll,pollNow,close,snapshot};
}
