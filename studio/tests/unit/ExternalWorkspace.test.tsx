import {render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import {AppStateProvider} from '../../src/renderer/app/AppState';
import {ExternalSessionProvider,ExternalWorkspace} from '../../src/renderer/features/external/ExternalWorkspace';
describe('External workspace never offers a fake frozen prompt',()=>{
  it('shows EMPTY and disables import/copy/export without a real opened project',()=>{
    render(<AppStateProvider><ExternalSessionProvider><ExternalWorkspace/></ExternalSessionProvider></AppStateProvider>);
    expect(screen.getByText(/EMPTY — Create\/open a project/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Copy prompt'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Export .md'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Validate import'})).toBeDisabled();
    expect(screen.queryByText('FROZEN script')).not.toBeInTheDocument();
  });
});
