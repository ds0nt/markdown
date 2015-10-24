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

import Store from '../core/store'
import api from '../http/api'
import Dispatcher from '../core/dispatcher'

class DocumentStore extends Store {
  constructor() {
    super()
    Dispatcher.onAction(ACTIONS.SYNC_DOCUMENTS, () => this.sync())
    Dispatcher.onAction(ACTIONS.SELECT_DOCUMENT, (data) => this.select(data))
    Dispatcher.onAction(ACTIONS.CREATE_DOCUMENT, () => this.create())
    Dispatcher.onAction(ACTIONS.REMOVE_DOCUMENT, () => this.remove())
  }
  getInitialState() {
    return {
      documents: [],
      selected: null,
    }
  }
  async create() {
    try {
      let {data} = await api.createDocument({
        body: "# Untitled"
      })
      await this.sync()
      this.select(data)
    } catch (e) {
      this.dispatch({
        actionType: 'create:failure'
      })
    }
  }
  async remove() {
    try {
      let {data} = await api.deleteDocument(this.getState().selected.id)
      await this.sync()
      this.select(this.getState().documents[0])
    } catch (e) {
      this.dispatch({
        actionType: 'create:failure'
      })
    }
  }
  async sync() {
    try {
      let { data } = await api.syncDocuments()
      this.setState({
        documents: data
      })
    } catch (e) {
      this.dispatch({
        actionType: 'sync:failure'
      })
    }
  }
  async select({ id }) {
    try {
      let { data } = await api.fetchDocument(id)
      this.setState({
        selected: data,
      })
      await this.sync()
    } catch (e) {
      this.dispatch({
        actionType: 'select:failure'
      })
    }
  }
  async save(id, data) {
    try {
      let res = await api.updateDocuments(id, data)
    } catch (e) {
      this.dispatch({
        actionType: 'save:failure'
      })
    }
  }
}
export default new DocumentStore()
