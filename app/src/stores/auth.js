/**
 * AuthStore
 * a store that uses api calls and local storage to manage token based user authentication
 *
 * dispatches:
 *
 * handles:
 *   ACTIONS.LOGIN
 *   ACTIONS.LOGOUT
 *
 * emits:
 *   - login:success, login:failure, login:activate
 *   - logout:success
 */
import {
  ACTIONS,
  AUTH_HEADER,
  AUTH_DATA_KEY,
} from '../core/constants'
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../core/errors'
import Store from '../core/store'
import auth from '../rest/auth'
import Dispatcher from '../core/dispatcher'

class AuthStore extends Store {
  constructor() {
    super()
    Dispatcher.onAction(ACTIONS.LOGIN, () => this.loginAction())
    Dispatcher.onAction(ACTIONS.LOGOUT, () => this.logoutAction())
  }
  getInitialState() {
    let {
      token = null,
      user = null,
    } = JSON.parse( sessionStorage.getItem(AUTH_DATA_KEY)) || {}
    return { token, user }
  }
  setAuth(data) {
    this.setState({
      token : data.token,
      user : data.user,
    })
    sessionStorage.setItem(AUTH_DATA_KEY, JSON.stringify(data))
  }
  clearAuth() {
    this.setState({
      token: null,
      user: null,
    })
    sessionStorage.removeItem(AUTH_DATA_KEY)
  }
  isAuthenticated() {
    return typeof this.getState()["token"] === 'string'
  }

  async loginAction(data) {
    try {
      let res = await auth.login(data)
      this.setAuth(res.data)
      this.dispatch('login:success')
    } catch(e) {
      if ( e instanceof UnauthorizedError ) {
        this.dispatch('login:failure', "Incorrect username or password")
      } else if ( e instanceof ForbiddenError ) {
        this.dispatch('login:activate')
      } else if ( e instanceof NotFoundError ) {
        this.dispatch('login:failure', "Incorrect username or password")
      } else {
        console.error( e.stack )
      }
    }
  }

  logoutAction() {
    this.clearAuth()
    this.dispatch('logout:success')
  }
}
export default new AuthStore()
