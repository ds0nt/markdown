import Dispatcher from '../core/dispatcher'
import {ACTIONS} from '../core/constants'
import element from 'virtual-element'
import { render, tree } from 'deku'

export default {
  afterMount(component, el, setState) {
  },
  beforeUnmount(component, el) {

  },
  render() {
    function logout(e) {
      Dispatcher.dispatch({
        actionType: ACTIONS.LOGOUT
      })
    }
    return <div class="menu">
        <a class="item" onClick={logout}><i class="globe icon"></i> Logout</a>
      </div>
  }
}
