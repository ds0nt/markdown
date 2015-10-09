/**
 * AuthStore
 * a store that uses api calls and local storage to manage token based user authentication
 *
 * dispatches:
 *
 * handles:
 *   ACTIONS.SYNC_DOCUMENTS
 *
 * emits:
 *   - sync:success, sync:failure
 */

 import { ACTIONS } from '../core/constants'
import Store from '../core/store'
import documents from '../rest/documents'
import Dispatcher from '../core/dispatcher'

class DocumentStore extends Store {
  constructor() {
    super()
    Dispatcher.onAction(ACTIONS.SYNC_DOCUMENTS, () => this.sync())
  }
  getInitialState() {
    return {
      documents: []
    }
  }
  async sync() {
    try {
      let { data } = await documents.sync()
      this.setState({
        documents: data
      })
    } catch (e) {
      this.emit('sync:failure')
    }
  }
}
export default new DocumentStore()
