import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {AppStateProvider} from '../../src/renderer/app/AppState';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';
describe('External workspace never offers a fake frozen prompt',()=>{
  // Explicit isolation: both tests mount their own AppState/ExternalSession trees.
  afterEach(cleanup);

  it('REG-TAB-11 renders Script/Native navigation from the array, not the keyed session-state object',()=>{
    render(<AppStateProvider><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></AppStateProvider>);
    const script=screen.getByRole('button',{name:'Script'});
    const native=screen.getByRole('button',{name:'Native'});
    expect(script).toBeInTheDocument();
    expect(native).toBeInTheDocument();
    fireEvent.click(native);
    expect(screen.getByTestId('external-task-prompt')).toHaveAttribute('data-active-prompt','Native');
    fireEvent.click(script);
    expect(screen.getByTestId('external-task-prompt')).toHaveAttribute('data-active-prompt','Script');
  });
  it('keeps Build, Copy, Export and Open ChatGPT in one task toolbar above a fixed-height scrolling prompt',()=>{
    render(<AppStateProvider><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></AppStateProvider>);
    const toolbar=screen.getByRole('toolbar',{name:'External task controls'});
    for(const name of ['Build Task','Copy prompt','Export .md','Open ChatGPT']){
      expect(within(toolbar).getByRole('button',{name})).toBeInTheDocument();
    }
    expect(within(toolbar).getByRole('button',{name:'Copy prompt'})).toBeDisabled();
    expect(within(toolbar).getByRole('button',{name:'Export .md'})).toBeDisabled();
    expect(screen.getAllByRole('button',{name:'Open ChatGPT'})).toHaveLength(1);
    const prompt=screen.getByTestId('external-task-prompt');
    expect(prompt).toHaveClass('prompt','external-task-prompt');
    expect(toolbar.compareDocumentPosition(prompt)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const css=fs.readFileSync(path.resolve('src/renderer/styles/global.css'),'utf8');
    expect(css).toMatch(/\.external-task-prompt\{[^}]*height:360px;[^}]*overflow:auto/);
    for(const name of ['Author','Review','Correct','Recheck'])
      expect(screen.getByRole('button',{name})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Media review'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Export actual media pack'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Review media scope')).not.toBeInTheDocument();
  });
  it('shows EMPTY and disables import/copy/export without a real opened project',()=>{
    render(<AppStateProvider><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></AppStateProvider>);
    expect(screen.getByText(/EMPTY — Create\/open a project/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Import .json'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Copy prompt'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Export .md'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
    expect(screen.queryByText('FROZEN script')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Approve exact Script candidate'})).not.toBeInTheDocument();
  });
});
