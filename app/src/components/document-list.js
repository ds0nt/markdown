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
    let { documents=[] } = DocumentStore.getState()
    return {
      documents,
      selected: null,
      loading: true,
      docsHandler: { off : () => {}}
    }
  },
  afterMount(component, el, setState) {
    setState({
      docsHandler: DocumentStore.onAction('update', state => {
        setState({
          documents: state.documents,
          loading: false,
        })
      })
    })

    // document selected listener
    Dispatcher.register(action => {
      if (action.actionType == ACTIONS.SELECT_DOCUMENT) {
        setState({
          selected: action.id
        })
      }
    })
  },
  beforeUnmount (component, el) {
    let {props, state, id} = component
    state.docsHandler.off()
  },
  render({ props, state }, setState) {
    let { documents } = state


    let list = documents.map(item => <DocumentItem active={item.id === state.selected} item={item} onClick="false" />)

    return <div class="ui vertical menu">
        <div class="ui inverted search item">
          <div class="ui icon input">
            <input type="text" placeholder="Search documents..." />
            <i class="search link icon"></i>
          </div>
          <div class="results"></div>
        </div>
      <div class="item">

        <div class="header">Documents</div>
        <Loader active={state.loading}>Loading</Loader>
        <div class="menu">{list}</div>
      </div>
    </div>
  }
}
