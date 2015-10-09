import ActionDispatcher from '../core/action-dispatcher'

import assign from 'object-assign'

class Store extends ActionDispatcher {
  constructor() {
    super()
    this._state = {}
    this.setState(this.getInitialState())
  }
  getInitialState() {
    return {}
  }
  getState() {
    return this._state
  }
  setState(applyState) {
    this._state = assign(this._state, applyState)
    this.dispatch({
      actionType: "update",
      ... this._state
    })
    console.log("state", this._state)
  }
}
export default Store
