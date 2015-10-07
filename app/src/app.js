require("babelify/polyfill")

import { ACTIONS } from './core/constants'
import Dispatcher from './core/dispatcher'

window.ACTIONS = ACTIONS
window.Dispatcher = Dispatcher

import Backbone from 'backbone'
import BackboneRelational from 'backbone-relational'
import Application from './core/app'

let app = new Application()
app.start()
