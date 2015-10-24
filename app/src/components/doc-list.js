import element from 'virtual-element'

import Dispatcher from '../core/dispatcher';
import DocumentStore from '../stores/document'


let Loader = {
  render({props}) {
    return <div class={`ui ${props.active ? "active" : ""} dimmer`}>
      <div class="ui text loader">Loading</div>
    </div>
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

    function selectItem(id) {
      return () => Dispatcher.dispatchAction(ACTIONS.SET_ROUTE, { route: `/doc/${id}` })
    }

    let list = []
    for (let item of documents) {
      // if (item.id === state.selected) {
      //   list.push(<div class="active item">{item.name}</div>)
      // } else {
      //   list.push(<a class="item" onClick={selectItem(item.id)}>{item.name}</a>)
      // }
      list.push(<div class="ui card" onClick={selectItem(item.id)}>
        <div class="content">
          <div class="header">{item.name}</div>
          <div class="meta">{item.email}</div>
          <div class="meta">{item.updated_at}</div>
          <div class="description">
            {item.description}
          </div>
        </div>
      </div>
      )
    }

    let create = () => Dispatcher.dispatchAction(ACTIONS.CREATE_DOCUMENT)

    return <div id="document-list" class="ui cards">
      <Loader active={state.loading}>Loading</Loader>
        {list.length != 0 ? list : <a class="item" onClick={create}>Create a document.</a>}
    </div>
  }
}
