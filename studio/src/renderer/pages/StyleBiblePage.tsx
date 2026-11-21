import {PageHeader} from '../components/layout/PageHeader';
import {StyleBibleWorkspace} from '../features/external/StyleBibleWorkspace';
export function StyleBiblePage(){
  return <div className="page">
    <PageHeader eyebrow="SOURCE-GROUNDED IDENTITY" title="Style Bible & Visual References"
      description="Approved Script Analysis → inherited B1–B4 Style Bible → owner-inspected canonical references."/>
    <StyleBibleWorkspace/>
  </div>;
}
