import element from 'virtual-element'
import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';
import Dropdown from './dropdown'
let Toolbar = {
  afterRender(component, el) {
    $(el).find(".dropdown").dropdown()
  },
  render() {
    let newDocument = () => Dispatcher.dispatch({
      actionType: ACTIONS.CREATE_DOCUMENT,
    })
    let removeDocument = () => Dispatcher.dispatch({
      actionType: ACTIONS.REMOVE_DOCUMENT,
    })
    let saveDocument = () => Dispatcher.dispatch({
      actionType: ACTIONS.SAVE_DOCUMENT,
    })

    return <div id="toolbar" class="ui stacking icon basic buttons">
      <button class="ui button" onClick={newDocument}>
        <i class="plus icon"></i>
      </button>
      <button class="ui button" onClick={removeDocument}><i class="trash icon"></i></button>
      <button class="ui button" onClick={saveDocument}><i class="save icon"></i></button>
      <div class="ui dropdown button">
        <div class="text">Settings</div>
        <i class="dropdown icon"></i>
        <Dropdown name="Settings" items={[
          { name: "Import", icon: "import", description:"Import documents", onClick: () => Dispatcher.dispatch({ actionType: ACTIONS.OPEN_IMPORT }) },
          { name: "Logout", icon: "sign out", description:"Go back to login", onClick: () => Dispatcher.dispatch({ actionType: ACTIONS.SET_ROUTE, route: '/logout' }) },
        ]} />
      </div>
    </div>
  }
}

export default Toolbar
