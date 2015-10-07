import { render, tree } from 'deku'
import element from 'virtual-element'

import DocumentEditor from './document-editor'
import DocumentList from './document-list'

export default {
  render: () =>
    <section class="view ui grid container">
      <div class="four wide column">
        <DocumentList title="documents" />
      </div>
      <div class="twelve wide column">
        <DocumentEditor />
      </div>
    </section>
}
