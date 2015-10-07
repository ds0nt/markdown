import { render, tree } from 'deku'
import element from 'virtual-element'

import Forkme from './forkme'
import Header from './app-header'
import AppView from './app-view'
import Footer from './app-footer'

let App = {
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
    return <main class="ui layout container">
      <Forkme repo="ds0nt/mdpad" />
      <Header />
      <View />
      <Footer />
    </main>
  }
}

let init = () => {
  render(tree(<App />), document.getElementById('app'))
}

export default {
  App,
  init
}
