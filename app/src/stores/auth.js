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
  ConflictError,
  NotFoundError,
} from '../core/errors'
import Store from '../core/store'
import auth from '../http/auth'
import Dispatcher from '../core/dispatcher'

class AuthStore extends Store {
  constructor() {
    super()
    Dispatcher.onAction(ACTIONS.LOGIN, (data) => this.loginAction(data))
    Dispatcher.onAction(ACTIONS.REGISTER, (data) => this.registerAction(data))
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
    let { token, user } = this.getState()
    console.log(token, user)
    if (token != null)
      return true
    return false
  }

  async loginAction(data) {
    try {
      console.log(data)
      let res = await auth.login(data)
      this.setAuth({
        token: res.data.access_token
      })
      this.dispatch('login:success')
    } catch(e) {
      if ( e instanceof UnauthorizedError ) {
        this.dispatch({actionType: 'login:failure', error: "Incorrect username or password" })
      } else if ( e instanceof ForbiddenError ) {
        this.dispatch({actionType: 'login:activate'})
      } else if ( e instanceof NotFoundError ) {
        this.dispatch({actionType: 'login:failure',  error: "Incorrect username or password" })
      } else {
      }
        console.error( e.stack )
    }
  }
  async registerAction(data) {
    try {
      console.log(data)
      let res = await auth.register(data)
      this.setAuth(res.data)
      this.dispatch('login:success')
    } catch(e) {
      if ( e instanceof ConflictError ) {
        this.dispatch({actionType: 'register:failure',  error: "That account already exists" })
      } else {
        this.dispatch({actionType: 'register:failure', error: e.Error })
      }
    }
  }


  logoutAction() {
    this.clearAuth()
    this.dispatch('logout:success')
  }
}
export default new AuthStore()
