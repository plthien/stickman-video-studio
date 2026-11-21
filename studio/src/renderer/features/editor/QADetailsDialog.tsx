import { useEffect, useRef } from 'react';
import { Badge, Button } from '../../components/ui';
import { useAppState } from '../../app/AppState';
export function QADetailsDialog({ open, onClose }: { open:boolean; onClose:()=>void }) {
  const {native}=useAppState(),ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close()},[open]);
  const gates=[
    {name:'Encoded sample exists',pass:Boolean(native?.preview)},
    {name:'Exact preview fingerprint verified',pass:Boolean(native?.preview?.sha256)},
    {name:'Human preview approval recorded',pass:Boolean(native?.approval)},
    {name:'Final film report and file recorded',pass:Boolean(native?.render)}
  ];
  return <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="qa-title"><header><div><small>NATIVE EVIDENCE</small><h2 id="qa-title">QA Details</h2></div><Button aria-label="Close QA Details" onClick={onClose}>×</Button></header>
    {!native&&<p>No native project is open. All evidence is NOT_READY.</p>}
    {gates.map(gate=><div className="qa-row" key={gate.name}><strong>{gate.name}</strong><Badge tone={gate.pass?'mint':'amber'}>{gate.pass?'RECORDED':'NOT_READY'}</Badge></div>)}
    <div className="info">These labels are exposed only after main-process verification against current project bytes, native reports and output hashes.</div><Button variant="primary" onClick={onClose}>Close details</Button>
  </dialog>;
}
