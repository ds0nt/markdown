import { Router } from 'director'
import AuthStore from '../stores/auth'
import Layout from '../components/layout'
import { ACTIONS } from '../core/constants'
import AppView from '../components/app-view'
import LoginView from '../components/login-view'
import RegisterView from '../components/register-view'
import Dispatcher from '../core/dispatcher'

class Application {
  constructor() {
    Layout.init()
    this.router = Router({
      '/': [this.authed, this.app],
      '/login': [this.unauthed, this.login],
      '/register': [this.unauthed, this.register],
      '/logout': [this.authed, this.logout],
    })
    this.router.init()
    let route = window.location.hash.slice(2)
    this.router.setRoute(route)
    Dispatcher.onAction(ACTIONS.SET_ROUTE, (data) => this.router.setRoute(data.route))
    AuthStore.onAction('update', (state) => this.router.setRoute( state.token ? '/' : '/login') )
  }

  start() {
  }

  authed() {
    if (!AuthStore.isAuthenticated()) {
      console.log("UnAuthed: redirecting to /login");
      this.setRoute('/login')
    }
  }

  unauthed() {
    if (AuthStore.isAuthenticated()) {
      Dispatcher.dispatch({
        actionType: ACTIONS.LOGOUT
      })
    }
  }

  app() {
    Dispatcher.dispatch({
      actionType: ACTIONS.SYNC_DOCUMENTS
    })
    Dispatcher.dispatch({
      actionType : ACTIONS.SET_VIEW,
      view   : AppView
    })
  }

  login() {
    Dispatcher.dispatch({
      actionType : ACTIONS.SET_VIEW,
      view   : LoginView
    })
  }
  logout() {
    Dispatcher.dispatch({
      actionType: ACTIONS.LOGOUT
    })
  }

  register() {
    Dispatcher.dispatch({
      actionType : ACTIONS.SET_VIEW,
      view   : RegisterView
    })
  }
}

export default new Application
