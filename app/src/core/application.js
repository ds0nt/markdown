import { Router } from 'director'
import AuthStore from '../stores/auth'
import Layout from '../components/layout'
import AppView from '../components/app-view'
import DocView from '../components/doc-view'
import LoginView from '../components/login-view'
import RegisterView from '../components/register-view'
import Dispatcher from './dispatcher'

class Application {
  constructor() {
    Layout.init()
    this.router = Router({
      '/': [this.authed, this.app],
      '/login': [this.unauthed, this.login],
      '/register': [this.unauthed, this.register],
      '/logout': [this.authed, this.logout],
      '/doc/:id': [this.authed, this.document],
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
      Dispatcher.dispatchAction(ACTIONS.LOGOUT, {
      })
    }
  }

  app() {
    Dispatcher.dispatchAction(ACTIONS.SYNC_DOCUMENTS, {
    })
    Dispatcher.dispatchAction(ACTIONS.SET_VIEW, {
      view   : AppView
    })
  }

  document(id) {
    Dispatcher.dispatchAction(ACTIONS.SET_VIEW, {
      view   : DocView,
      documentId: id,
    })
  }

  login() {
    Dispatcher.dispatchAction(ACTIONS.SET_VIEW, {
      view   : LoginView
    })
  }
  logout() {
    Dispatcher.dispatchAction(ACTIONS.LOGOUT, {
    })
  }

  register() {
    Dispatcher.dispatchAction(ACTIONS.SET_VIEW, {
      view   : RegisterView
    })
  }
}

export default new Application
