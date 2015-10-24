import { render, tree } from 'deku'
import element from 'virtual-element'

import Forkme from './forkme'
import AppView from './app-view'
import Dispatcher from '../core/dispatcher'

let Layout = {
  initialState: () => ({
    view: AppView,
    props: {},
  }),
  afterMount: (c, el, update) => {
    Dispatcher.onAction(ACTIONS.SET_VIEW,  (data) => update({ 'view': data.view, props: data }))
  },
  render: c => {
    let View = c.state.view
    return <main>
      <Forkme repo="ds0nt/mdpad" />
        <View {...c.state.props} />
    </main>
  }
}

let init = () => {
  render(tree(<Layout />), document.getElementById('app'))
}

export default {
  Layout,
  init
}
