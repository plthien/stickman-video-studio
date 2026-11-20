import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createGlabsAutoPolling} from '../../src/main/glabsAutoPolling';
import type {GLabsJob} from '../../src/main/glabs';

const fakeJob=(id:string,status:GLabsJob['status']='RUNNING',providerTaskId='ab12cd34')=>({
  id,projectId:'A',status,providerTaskId
}) as GLabsJob;
const deferred=<T,>()=>{
  let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;
  const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});
  return{promise,resolve,reject};
};
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});

describe('Electron G-Labs read-only background polling coordinator',()=>{
  it('AUTO-POLL-01 polls an existing job after owner submits; COMPLETED/VALIDATED event stops polling',async()=>{
    const poll=vi.fn(async()=>fakeJob('task-1','VALIDATED'));
    const onJob=vi.fn();
    const manager=createGlabsAutoPolling({poll,onJob,intervalMs:2000});
    manager.observe('A',fakeJob('task-1'));
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith('A','task-1');
    expect(onJob).toHaveBeenCalledWith('A',expect.objectContaining({status:'VALIDATED'}));
    await vi.advanceTimersByTimeAsync(8000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(manager.snapshot()).toMatchObject({tracked:0,inFlight:0});
    manager.close();
  });
  it('AUTO-POLL-02 caps 200 pending jobs at two in-flight GETs',async()=>{
    const gates=Array.from({length:200},()=>deferred<GLabsJob>());
    const poll=vi.fn((_project:string,id:string)=>gates[Number(id.slice(2))].promise);
    const manager=createGlabsAutoPolling({poll,onJob:vi.fn(),concurrency:2});
    manager.observeAll('A',gates.map((_v,index)=>fakeJob('id'+index)));
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(manager.snapshot()).toMatchObject({tracked:200,inFlight:2});
    gates[0].resolve(fakeJob('id0','VALIDATED'));
    gates[1].resolve(fakeJob('id1','VALIDATED'));
    await Promise.resolve();await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(4);
    // Closing does not initiate more polling or provider submissions.
    manager.close();
    expect(manager.snapshot().tracked).toBe(0);
    gates[2].resolve(fakeJob('id2','VALIDATED'));
    gates[3].resolve(fakeJob('id3','VALIDATED'));
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(4);
  });
  it('AUTO-POLL-03 restarting the poller resumes persisted running jobs from the journal',async()=>{
    const first=createGlabsAutoPolling({poll:vi.fn(),onJob:vi.fn()});
    first.observe('A',fakeJob('persisted-1'));
    first.close();
    const poll=vi.fn(async()=>fakeJob('persisted-1','VALIDATED'));
    const next=createGlabsAutoPolling({poll,onJob:vi.fn()});
    next.observeAll('A',[fakeJob('persisted-1')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledWith('A','persisted-1');
    next.close();
  });
  it('AUTO-POLL-04 UNKNOWN without provider ID is never automatically retried; task-owned UNKNOWN is GET-only',async()=>{
    const poll=vi.fn(async()=>fakeJob('unknown-with-provider','VALIDATED'));
    const manager=createGlabsAutoPolling({poll,onJob:vi.fn()});
    manager.observeAll('A',[
      fakeJob('unknown-no-provider','UNKNOWN',''),
      fakeJob('unknown-with-provider','UNKNOWN','ab12cd34')
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith('A','unknown-with-provider');
    manager.close();
  });
  it('AUTO-POLL-05 manual Check Now joins the current in-flight GET, never a duplicate request',async()=>{
    const gate=deferred<GLabsJob>(),poll=vi.fn(()=>gate.promise);
    const manager=createGlabsAutoPolling({poll,onJob:vi.fn()});
    manager.observe('A',fakeJob('same'));
    await vi.advanceTimersByTimeAsync(0);
    const manual=manager.pollNow('A','same');
    expect(poll).toHaveBeenCalledTimes(1);
    gate.resolve(fakeJob('same','VALIDATED'));
    expect((await manual).status).toBe('VALIDATED');
    manager.close();
  });
  it('AUTO-POLL-06 a failed GET only backs off; no paid POST or automatic retry is performed',async()=>{
    const onError=vi.fn(),poll=vi.fn(async()=>{throw new Error('GET network failure');});
    const manager=createGlabsAutoPolling({poll,onJob:vi.fn(),onError,intervalMs:2000});
    manager.observe('A',fakeJob('retry-get'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3999);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    manager.close();
  });
  it('AUTO-POLL-07 project identity is preserved for every callback and inactive records are never polled',async()=>{
    const poll=vi.fn(async(projectId:string,id:string)=>({
      ...fakeJob(id,'VALIDATED'),projectId
    }));
    const onJob=vi.fn();
    const manager=createGlabsAutoPolling({poll,onJob});
    manager.observeAll('A',[fakeJob('image-a'),fakeJob('finished-a','VALIDATED')]);
    manager.observeAll('B',[{...fakeJob('image-b'),projectId:'B'}]);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).not.toHaveBeenCalledWith('A','finished-a');
    expect(onJob).toHaveBeenCalledWith('A',expect.objectContaining({id:'image-a'}));
    expect(onJob).toHaveBeenCalledWith('B',expect.objectContaining({id:'image-b'}));
    manager.close();
  });
});
