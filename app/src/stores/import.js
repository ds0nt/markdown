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

class ImportStore extends Store {
  constructor() {
    super()
    Dispatcher.onAction(ACTIONS.IMPORT_URL, (data) => this.importUrl(data))
  }
  async importUrl({ url }) {
    try {
      let { data } = await api.importUrl({ url })
      await api.createDocument({ body: data.body })
      await this.sync()
      this.select(data)
    } catch (e) {
      this.dispatch({
        actionType: 'import:failure'
      })
    }
  }
}
export default new ImportStore()
