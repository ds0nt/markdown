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

export default {
  name: 'DocumentList',
  initialState(props) {
    return {
      documents: [],
      selected: null,
      loading: false,
      docsHandler: { off : () => {}}
    }
  },
  afterMount(component, el, setState) {
    let { documents=[] } = DocumentStore.getState()
    setState({
      documents: documents,
      docsHandler: DocumentStore.onAction('update', data => {
        setState({
          documents: DocumentStore.getState().documents,
          selected: data.selected ? data.selected.id : null,
          loading: false,
        })
      })
    })
  },
  beforeUnmount (component, el) {
    let {props, state, id} = component
    state.docsHandler.off()
  },
  render({ props, state }, setState) {
    let { documents } = state

    let list = documents.map(item => <DocumentItem active={item.id === state.selected} item={item} />)

    return <div id="document-list" class="ui left fixed vertical menu">
      <div class="ui horizontal divider">NotePad</div>
      <Loader active={state.loading}>Loading</Loader>
        {list}
    </div>
  }
}
