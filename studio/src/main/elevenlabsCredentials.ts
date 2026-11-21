/** Electron main-process-only ElevenLabs credential store.
 * No key is returned to the renderer or written to project files.
 * The encryption adapter is Electron safeStorage in production (OS protected).
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export interface CredentialCipher {
  isEncryptionAvailable():boolean;
  encryptString(plainText:string):Buffer;
  decryptString(encrypted:Buffer):string;
}
export interface ElevenLabsCredentialStatus{
  configured:boolean;
  source:'secure-storage'|'environment'|'none';
  secureStorageAvailable:boolean;
}
const filename='elevenlabs-key.enc';
function secretFile(userData:string){
  if(!path.isAbsolute(userData))throw new Error('ElevenLabs secret store needs an absolute application data path.');
  return path.join(userData,filename);
}
function assertRegularFile(file:string){
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile())throw new Error('ElevenLabs secret storage is not a regular file.');
}
export function elevenLabsStatus(userData:string,cipher:CredentialCipher,environmentKey=process.env.ELEVENLABS_API_KEY):ElevenLabsCredentialStatus{
  const file=secretFile(userData),stored=fs.existsSync(file);
  if(stored)assertRegularFile(file);
  return {
    configured:stored||Boolean(environmentKey?.trim()),
    source:stored?'secure-storage':environmentKey?.trim()?'environment':'none',
    secureStorageAvailable:cipher.isEncryptionAvailable()
  };
}
export function saveElevenLabsKey(userData:string,cipher:CredentialCipher,key:string):ElevenLabsCredentialStatus{
  if(typeof key!=='string'||!key.trim()||key.length>2048||/[\r\n\x00-\x1f\x7f]/.test(key))
    throw new Error('Enter a valid non-empty ElevenLabs API key.');
  if(!cipher.isEncryptionAvailable())throw new Error('OS-protected encryption is unavailable. The API key was not saved.');
  const file=secretFile(userData),folder=path.dirname(file);
  fs.mkdirSync(folder,{recursive:true});
  if(fs.existsSync(file))assertRegularFile(file);
  const encrypted=cipher.encryptString(key.trim());
  if(!Buffer.isBuffer(encrypted)||encrypted.length<1)throw new Error('ElevenLabs API key encryption failed.');
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(temporary,encrypted,{flag:'wx',mode:0o600});
    fs.renameSync(temporary,file);
  }finally{
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
  return elevenLabsStatus(userData,cipher);
}
export function clearElevenLabsKey(userData:string,cipher:CredentialCipher):ElevenLabsCredentialStatus{
  const file=secretFile(userData);
  if(fs.existsSync(file)){assertRegularFile(file);fs.unlinkSync(file);}
  return elevenLabsStatus(userData,cipher);
}
export function resolveElevenLabsKey(userData:string,cipher:CredentialCipher,environmentKey=process.env.ELEVENLABS_API_KEY):string{
  const file=secretFile(userData);
  if(fs.existsSync(file)){
    assertRegularFile(file);
    if(!cipher.isEncryptionAvailable())throw new Error('OS-protected ElevenLabs API key cannot be decrypted.');
    const key=cipher.decryptString(fs.readFileSync(file));
    if(!key.trim())throw new Error('Stored ElevenLabs API key is empty.');
    return key;
  }
  if(environmentKey?.trim())return environmentKey.trim();
  throw new Error('Configure ElevenLabs API key in Settings or set ELEVENLABS_API_KEY in the Electron main-process environment.');
}
