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
  render: c =>
    <a class="item" onClick={c.props.onClick}>
      <i class="file icon"></i>
      <div class="content">
        <div class="description">{c.props.item.title}</div>
      </div>
    </a>
}

let initialState = (props) => ({
  loading: true,
  item: null,
  items: [],
  adding: false
})
function onDocumentChanged(items) {
  console.log('document changed')
  this.setState({
    loading : false,
    items   : items
  })
}
let afterMount = async (c, el, setState) => {
  DocumentStore.list()
  DocumentStore.on('changed',  onDocumentChanged.bind(null, { setState }))
  return {
    loading : true,
    items   : [],
  }
}

let beforeUnmount = (c) => {
  DocumentStore.removeListener('changed', onDocumentChanged)
}

let render = ({ props, state }, setState) => {
  let { items=[] } = state

  let add = async(e, c) => {
    Dispatcher.dispatch({
      actionType : ACTIONS.CREATE_DOCUMENT,
      toolName   : c.state.adding
    });
  }

  let select = (e, c, u) => {
    Dispatcher.dispatch({
      actionType : ACTIONS.SELECT_DOCUMENT,
      toolName   : c.props.item
    });
  }

  let list = []
  for (let item of items) {
    list.push(<DocumentItem active="false" item={item} onClick="false" />)
  }

  return <div class="ui list">
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
