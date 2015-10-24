import element from 'virtual-element'
import Dispatcher from '../core/dispatcher';

let Dropdown = {

  afterRender(component, el) {
    $(el).dropdown()
  },

  render(component) {
    let { state, props } = component
    let {
      items = []
    } = props

    let newDocument = () => Dispatcher.dispatch({
      actionType: ACTIONS.CREATE_DOCUMENT,
    })

    items = items.map(child => {
      return <div class="item" onClick={child.onClick}>
        { ! child.icon        ? '' : <i class={`${child.icon} icon`}></i> }
        { ! child.description ? '' : <span class="description">{child.description}</span> }
        {child.name}
      </div>
    })


    return <div class="menu">
        {items}
    </div>
  }
}

export default Dropdown
