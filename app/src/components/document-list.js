import element from 'virtual-element'

import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';
import DocumentStore from '../stores/document'

let Loader = {
  render({props}) {
    return <div class={`ui ${props.active ? "active" : ""} dimmer`}>
      <div class="ui text loader">Loading</div>
    </div>
  }
}

let DocumentItem = {
  render: c => {
    let _item = c.props.item
    let select = () => Dispatcher.dispatch({
      actionType: ACTIONS.SELECT_DOCUMENT,
      id: _item.id
    })
    let Wrap = {
      render ({props}) {
        if (c.props.active)
          return <div class="active item">{props.children}</div>
        return <a class="item" onClick={select}>{props.children}</a>
      }
    }

    return <Wrap>{_item.name}</Wrap>
  }
}

let initialState = (props) => ({
  loading: true,
  selected: null,
  items: DocumentStore.getState(),
  adding: false
})

function updateItems(setState) {
  return () => setState({
    loading: false,
    items: DocumentStore.getState()
  })
}

let afterMount = (c, el, setState) => {
  // document sync listener
  let onSync = updateItems(setState)
  DocumentStore.on('sync:success', onSync)
  setState({ onSync })

  // document selected listener
  Dispatcher.register(action => {
    if (action.actionType == ACTIONS.SELECT_DOCUMENT) {
      setState({
        selected: action.id
      })
    }
  })
}

let beforeUnmount = (c) => {
  DocumentStore.removeListener('sync:success', c.state.onSync)
}

let render = ({ props, state }, setState) => {
  let { items=[] } = state

  let add = () => {
    Dispatcher.dispatch({
      actionType : ACTIONS.CREATE_DOCUMENT,
    });
  }

  let list = items.map(item => <DocumentItem active={item.id === state.selected} item={item} onClick="false" />)

  return <div class="ui link list">
    <Loader active={state.loading}>Loading</Loader>
      {
        state.adding
        ?
          <div>
            <input type="text" class="ui tiny basic input" onChange={ e => setState({ adding: e.target.value }) } />
            <div class="ui tiny basic button" onClick={add}>
              <i class="icon add"></i>
            </div>
          </div>
        :
          <div class="ui basic button" onClick={() => setState({ adding: '' })}>
            New
          </div>
      }
    {list}

  </div>
}
let DocumentList = {
  initialState,
  afterMount,
  beforeUnmount,
  render,
}
export default DocumentList
