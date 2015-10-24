import { ACTIONS } from './core/constants'
import Dispatcher from './core/dispatcher'
import Application from './core/application'

import './stores/auth'
import './stores/document'
import './stores/import'

Application.start()
