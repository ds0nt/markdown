import element from 'virtual-element'
import { render, tree } from 'deku'

import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';

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

let DocumentList = {
  initialState(props) {
    return {
      loading: true,
      item: null,
      items: [],
      adding: false
    }
  },

  async afterMount(c, el, setState) {
    let items = await c.props.items()
    setState({
      items: items.data,
      loading: false
    })
  },

  render({ props, state }, setState) {
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
}
export default DocumentList
