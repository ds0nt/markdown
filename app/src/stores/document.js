import { ACTIONS, AUTH_HEADER, AUTH_DATA_KEY } from '../core/constants'
import Dispatcher from '../core/dispatcher'
import documents from '../rest/documents'

import { EventEmitter } from 'events'


class DocumentStore extends EventEmitter {

  constructor() {
    super()
    this.state = []
  }
  async list() {
    try {
      let docs = await documents.read()
      this.state = docs.data
      this.emit('changed', this.state)
      this.emit('list:success')
    } catch (e) {
      this.emit('list:failed')
    }
  }
}
export default new DocumentStore()
