import element from 'virtual-element'

import DocumentEditor from './doc-editor'
import DocumentList from './doc-list'
import DocumentToolbar from './doc-toolbar'
import Import from './import'
import Chat from './chat'


export default {
  render: () =>
    <div class="ui container">
      <DocumentToolbar />
      <Chat />
      <DocumentList title="documents" />
      <Import />
    </div>
}
