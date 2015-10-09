import { render, tree } from 'deku'
import element from 'virtual-element'

import Forkme from './forkme'
import Header from './app-header'
import AppView from './app-view'
import { ACTIONS } from '../core/constants'
import Dispatcher from '../core/dispatcher'

let Layout = {
  initialState: () => ({
    view: AppView
  }),
  afterMount: (c, el, update) => {
    let onNavigate = data => {
      data.actionType != ACTIONS.NAVIGATE || update({'view': data.view})
    }

    Dispatcher.register( onNavigate )
  },
  render: c => {
    let View = c.state.view
    return <main>
      <Forkme repo="ds0nt/mdpad" />
      <section class="ui grid">
        <div class="sixteen column row">
          <Header />
        </div>
        <div class="sixteen column row">
          <View />
        </div>
      </section>
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
