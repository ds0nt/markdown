import { ACTIONS } from './core/constants'
import Dispatcher from './core/dispatcher'
import Application from './core/app'

Application.start()

import UserStore from './stores/user'
import DocumentStore from './stores/document'

// UserStore.on('login:success', () => {
  console.dir(DocumentStore)
// })
