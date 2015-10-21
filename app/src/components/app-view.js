import element from 'virtual-element'

import DocumentEditor from './doc-editor'
import DocumentList from './doc-list'
import DocumentToolbar from './doc-toolbar'
import Import from './import'

export default {
  render: () =>
    <div class="ui container">
      <DocumentToolbar />
      <DocumentList title="documents" />
      <DocumentEditor />
      <Import />
    </div>
}
