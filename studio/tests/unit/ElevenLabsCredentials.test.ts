// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {clearElevenLabsKey,elevenLabsStatus,resolveElevenLabsKey,saveElevenLabsKey,type CredentialCipher} from '../../src/main/elevenlabsCredentials';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
const createRoot=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-elevenlabs-'));roots.push(root);return root};
const cipher:CredentialCipher={
  isEncryptionAvailable:()=>true,
  encryptString:(key)=>Buffer.from('os-sealed:'+Buffer.from(key).toString('base64')),
  decryptString:(bytes)=>Buffer.from(bytes.toString().replace(/^os-sealed:/,''),'base64').toString()
};

describe('Electron main-only ElevenLabs credential management',()=>{
  it('encrypts saved key outside projects, reports configured status without exposing key, and resolves for alignment',()=>{
    const root=createRoot(),key='elevenlabs-test-credential-123';
    const status=saveElevenLabsKey(root,cipher,key);
    expect(status).toEqual({configured:true,source:'secure-storage',secureStorageAvailable:true});
    const bytes=fs.readFileSync(path.join(root,'elevenlabs-key.enc'));
    expect(bytes.toString()).not.toContain(key);
    expect(resolveElevenLabsKey(root,cipher)).toBe(key);
    expect(JSON.stringify(elevenLabsStatus(root,cipher))).not.toContain(key);
    expect(clearElevenLabsKey(root,cipher)).toMatchObject({configured:false,source:'none'});
    expect(fs.existsSync(path.join(root,'elevenlabs-key.enc'))).toBe(false);
  });
  it('never writes plaintext when OS encryption is unavailable',()=>{
    const root=createRoot(),denied:CredentialCipher={...cipher,isEncryptionAvailable:()=>false};
    expect(()=>saveElevenLabsKey(root,denied,'secret-key')).toThrow(/encryption is unavailable/);
    expect(fs.existsSync(path.join(root,'elevenlabs-key.enc'))).toBe(false);
  });
  it('keeps environment key support without exposing or clearing it from the UI',()=>{
    const root=createRoot();
    expect(elevenLabsStatus(root,cipher,'from-environment')).toMatchObject({configured:true,source:'environment'});
    expect(resolveElevenLabsKey(root,cipher,'from-environment')).toBe('from-environment');
    expect(clearElevenLabsKey(root,cipher)).toMatchObject({source:process.env.ELEVENLABS_API_KEY?'environment':'none'});
  });
  it('treats corrupt encrypted store as error, never silently falling back to an environment key',()=>{
    const root=createRoot(),failed:CredentialCipher={...cipher,decryptString:vi.fn(()=>{throw new Error('unreadable encryption')})};
    saveElevenLabsKey(root,cipher,'configured-key');
    expect(()=>resolveElevenLabsKey(root,failed,'alternate-environment-key')).toThrow(/unreadable encryption/);
  });
  it('rejects empty/control-character keys and symlink-backed stores',()=>{
    const root=createRoot();
    expect(()=>saveElevenLabsKey(root,cipher,'  ')).toThrow(/valid/);
    expect(()=>saveElevenLabsKey(root,cipher,'invalid\nkey')).toThrow(/valid/);
    const target=path.join(root,'other.txt');fs.writeFileSync(target,'safe');
    const secret=path.join(root,'elevenlabs-key.enc');
    try{
      fs.symlinkSync(target,secret);
      expect(()=>saveElevenLabsKey(root,cipher,'valid-key')).toThrow(/regular file/);
      expect(fs.readFileSync(target,'utf8')).toBe('safe');
    }catch(error){
      if(!fs.existsSync(secret))return; // Windows non-privileged symlink creation may be denied.
      throw error;
    }
  });
});
