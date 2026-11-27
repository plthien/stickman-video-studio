/** Shared local JSON selection: syntax only, no import or approval side effect. */
export function readExternalJsonFile(file:File,handlers:{
  current:()=>boolean;clearSelection:()=>void;
  accept:(contents:string)=>void;error:(message:string)=>void;
}){
  let settled=false,cleared=false;
  const clear=()=>{
    if(cleared)return;
    cleared=true;
    if(handlers.current())handlers.clearSelection();
  };
  const fail=(message:string)=>{
    if(settled||!handlers.current())return;
    settled=true;handlers.error(message);
  };
  if(!/\.json$/i.test(file.name)){fail('Choose a .json file.');clear();return;}
  const reader=new FileReader();
  const acceptRead=()=>{
    if(settled||!handlers.current()||typeof reader.result!=='string')return;
    const contents=reader.result;
    try{JSON.parse(contents);}catch{fail('Selected file is not valid JSON.');return;}
    settled=true;
    handlers.accept(contents);
  };
  // Electron/DOM bridges may emit load, loadend, or both. Never reset
  // the selection before the asynchronous reader has consumed the File.
  reader.onload=()=>{acceptRead();if(settled)clear();};
  reader.onloadend=()=>{
    acceptRead();
    if(!settled)fail('Unable to read the selected JSON file.');
    clear();
  };
  reader.onerror=()=>{fail('Unable to read the selected JSON file.');clear();};
  try{reader.readAsText(file);}catch(reason){
    fail('Unable to read the selected JSON file: '+String(reason));clear();
  }
}
