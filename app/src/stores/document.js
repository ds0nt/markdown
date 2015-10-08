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
import Dispatcher from '../core/dispatcher'
import documents from '../rest/documents'

import { EventEmitter } from 'events'


class DocumentStore extends EventEmitter {

  constructor() {
    super()
    this.state = []
    Dispatcher.register(action => {
      switch (action.actionType) {
        case ACTIONS.SYNC_DOCUMENTS:
          return this.sync(action)
      }
    })
  }
  async sync() {
    console.log('syncing documents')
    try {
      let { data } = await documents.sync()
      this.state = data
      console.log('sync:success', data)
      this.emit('sync:success')
    } catch (e) {
      this.emit('sync:failure')
    }
  }
  getState() {
    return this.state
  }
}
export default new DocumentStore()
