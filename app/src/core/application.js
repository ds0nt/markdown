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
      '/signup': [this.unauthed, this.signup],
      '/logout': [this.authed, this.logout],
    })
    this.router.init()
    this.router.setRoute('/')
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
      console.log("Already Authed: redirecting to /");
      this.setRoute('/')
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

  signup() {
    Dispatcher.dispatch({
      actionType : ACTIONS.SET_VIEW,
      view   : RegisterView
    })
  }
}

export default new Application
