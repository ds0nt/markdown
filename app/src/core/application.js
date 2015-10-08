import { Router } from 'director'
import AuthStore from '../stores/auth'
import Layout from '../components/layout'
import { ACTIONS } from '../core/constants'
import AppView from '../components/app-view'
import LoginView from '../components/login-view'
import Dispatcher from '../core/dispatcher'

class Application {
  constructor() {
    Layout.init()
    this.router = Router({
      '/': [this.authed, this.app],
      '/login': [this.unauthed, this.login],
      '/signup': [this.unauthed, this.signup],
      '/logout': [this.authed, this.logout],
    })
    this.router.init()
    AuthStore.on('login:success', () => this.router.setRoute('/') )
  }

  start() {
  }

  authed() {
    if (!AuthStore.isAuthenticated()) {
      this.setRoute('/login')
    }
  }

  unauthed() {
    if (AuthStore.isAuthenticated()) {
      this.setRoute('/')
    }
  }

  app() {
    Dispatcher.dispatch({
      actionType: ACTIONS.SYNC_DOCUMENTS
    })
    Dispatcher.dispatch({
      actionType : ACTIONS.NAVIGATE,
      view   : AppView
    })
  }

  login() {
    Dispatcher.dispatch({
      actionType : ACTIONS.NAVIGATE,
      view   : LoginView
    })
  }
  logout() {
    Dispatcher.dispatch({
      actionType: ACTIONS.LOGOUT
    })
  }

  signup() {
    Dispatcher.dispatch({
      actionType : ACTIONS.NAVIGATE,
      view   : 'signup'
    })
  }
}

export default new Application
