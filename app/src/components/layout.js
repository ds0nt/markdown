import { render, tree } from 'deku'
import element from 'virtual-element'

import Forkme from './forkme'
import AppView from './app-view'
import { ACTIONS } from '../core/constants'
import Dispatcher from '../core/dispatcher'

let Layout = {
  initialState: () => ({
    view: AppView
  }),
  afterMount: (c, el, update) => {
    Dispatcher.onAction(ACTIONS.SET_VIEW,  ({view}) => update({'view': view}))
  },
  render: c => {
    let View = c.state.view
    return <main>
      <Forkme repo="ds0nt/mdpad" />
        <View />
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
