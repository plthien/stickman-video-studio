// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {subprocessEnvironment} from '../../src/main/services';

describe('R2 Native CLI subprocess mode',()=>{
  it('forces Node mode when the executable is Electron, without altering the parent environment',()=>{
    const parent={MODE_B_STUDIO_USER_DATA:'C:/test'};
    const child=subprocessEnvironment('C:/electron.exe',parent,'C:/electron.exe',true);
    expect(child.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(child.MODE_B_STUDIO_USER_DATA).toBe(parent.MODE_B_STUDIO_USER_DATA);
    expect(parent).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });
  it('does not force Node mode for ordinary Node or other executables',()=>{
    expect(subprocessEnvironment('C:/node.exe',{},'C:/node.exe',false).ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(subprocessEnvironment('C:/git.exe',{},'C:/electron.exe',true).ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
