import element from 'virtual-element'

import DocumentEditor from './document-editor'
import DocumentList from './document-list'

export default {
  render: () =>
    <div class="ui container">
      <DocumentList title="documents" />
      <DocumentEditor />
    </div>
}
