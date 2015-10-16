import element from 'virtual-element'
import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';

let Toolbar = {
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
    return <div id="toolbar" class="ui small basic icon buttons">
      <button class="ui button" onClick={newDocument}>
        <i class="plus icon"></i>
      </button>
      <button class="ui button" onClick={removeDocument}><i class="trash icon"></i></button>
      <button class="ui button" onClick={saveDocument}><i class="save icon"></i></button>
      <button class="ui button"><i class="upload icon"></i></button>
      <button class="ui button"><i class="download icon"></i></button>
    </div>
  }
}

export default Toolbar
