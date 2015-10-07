require("babelify/polyfill")

import $ from 'jquery'
import Backbone from 'backbone'
Backbone.$ = window.$ = $
import BackboneRelational from 'backbone-relational'
import Application from './core/app'

import { ACTIONS } from './core/constants'
import Dispatcher from './core/dispatcher'

window.ACTIONS = ACTIONS
window.Dispatcher = Dispatcher

let app = new Application()
app.start()
