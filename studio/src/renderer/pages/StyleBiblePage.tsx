import {PageHeader} from '../components/layout/PageHeader';
import {StyleBibleWorkspace} from '../features/external/StyleBibleWorkspace';
export function StyleBiblePage(){
  return <div className="page">
    <PageHeader eyebrow="SOURCE-GROUNDED IDENTITY" title="Style Bible"
      description="Approved Script Analysis → automatic character references → owner image approval."/>
    <StyleBibleWorkspace/>
  </div>;
}
