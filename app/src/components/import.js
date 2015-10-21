import element from 'virtual-element'
import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';

let Dropdown = {

  afterMount(component, el, setState) {
    Dispatcher.onAction(ACTIONS.OPEN_IMPORT, () => $(el).modal('show'))
  },

  render(component) {
    let { state, props } = component

    let onChangeField = name => (e, c, setState) => {
      setState({
        [name]: e.target.value
      })
    }

    let submit = () => {
      alert(state.url)
    }

    return <div class="ui basic modal">
      <i class="close icon"></i>
      <div class="header">
        Archive Old Messages
      </div>
      <div class="content">
      <div class="ui form">
        <h4 class="ui dividing header">Give us your feedback</h4>
        <div class="field">
          <label>URL</label>
          <input type="text" onChange={onChangeField("url")} />
        </div>
      </div>
    </div>
      <div class="actions">
        <div class="two fluid ui inverted buttons">
          <div class="ui green basic inverted button" onClick={submit}>
            <i class="checkmark icon"></i>
            Yes
          </div>
        </div>
      </div>
    </div>
  }
}

export default Dropdown
