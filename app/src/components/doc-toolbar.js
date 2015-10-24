import element from 'virtual-element'
import Dispatcher from '../core/dispatcher';
import Dropdown from './dropdown'
let Toolbar = {
  initialState() {
    return {
      preview: false,
    }
  },
  afterRender(component, el) {
    $(el).find(".dropdown").dropdown()
  },
  afterMount(component, el, setState) {
    Dispatcher.onAction(ACTIONS.PREVIEW_DOCUMENT, () => {
      setState({
        preview: true
      })
    })
    Dispatcher.onAction(ACTIONS.EDIT_DOCUMENT, () => {
      setState({
        preview: false
      })
    })
  },
  render(component) {
    let { state, props } = component
    let newDocument = () => Dispatcher.dispatchAction(ACTIONS.CREATE_DOCUMENT)
    let removeDocument = () => Dispatcher.dispatchAction(ACTIONS.REMOVE_DOCUMENT)
    let saveDocument = () => Dispatcher.dispatchAction(ACTIONS.SAVE_DOCUMENT)
    let previewDocument = () => Dispatcher.dispatchAction(ACTIONS.PREVIEW_DOCUMENT)
    let editDocument = () => Dispatcher.dispatchAction(ACTIONS.EDIT_DOCUMENT)
    let fullScreenDocument = () => Dispatcher.dispatchAction(ACTIONS.FULLSCREEN_DOCUMENT)

    return <div id="toolbar" class="ui stacking icon basic buttons">
      <button class="ui button" onClick={newDocument}>
        <i class="plus icon"></i>
      </button>
      <button class="ui button" onClick={removeDocument}><i class="trash icon"></i></button>
      <button class="ui button" onClick={saveDocument}><i class="save icon"></i></button>
      { ! state.preview ? <button class="ui button" onClick={previewDocument}><i class="unhide icon"></i></button> : <button class="ui button" onClick={editDocument}><i class="edit icon"></i></button> }
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
