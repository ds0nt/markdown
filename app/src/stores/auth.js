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

import { ACTIONS, AUTH_HEADER, AUTH_DATA_KEY } from '../core/constants'
import Dispatcher from '../core/dispatcher'
import Errors from '../core/errors'
import users from '../rest/auth'
import { EventEmitter } from 'events'

class AuthStore extends EventEmitter {

  constructor() {
    super()
    this._authToken = null
    this._authenticatedUser = null
    let data = this.getAuthData()
    if (data && data.token && data.user)
      this.authenticate(data)

    Dispatcher.register(action => {
      switch (action.actionType) {
        case ACTIONS.LOGIN:
          return this.loginAction(action)
        case ACTIONS.LOGOUT:
          return this.logoutAction(action)
      }
    })
  }
  // Save authentication data in local storage
  getAuthData(){
    return JSON.parse( sessionStorage.getItem(AUTH_DATA_KEY))
  }
  setAuthData(data) {
    sessionStorage.setItem(AUTH_DATA_KEY, JSON.stringify(data))
  }
  clearAuthData() {
    sessionStorage.removeItem(AUTH_DATA_KEY)
  }
  isAuthenticated() {
    return typeof this._authToken === 'string'
  }

  authenticate(data) {
    this.setAuthData(data)
    this._authToken = data.token
    this._authenticatedUser = data.user
  }

  async loginAction(action) {
    try {
      let {data} = await users.login({
        username: action.username,
        password: action.password,
      })
      this.authenticate(data)
      this.emit( 'login:success', data )
    } catch(e) {
      if ( e instanceof Errors.UnauthorizedError ) {
        this.emit( 'login:failure', "Incorrect username or password" )
      } else if ( e instanceof Errors.ForbiddenError ) {
        this.emit( 'login:activate' )
      } else if ( e instanceof Errors.NotFoundError ) {
        this.emit( 'login:failure', "Incorrect username or password" )
      } else {
        console.error( e.stack )
      }
    }
  }

  async logoutAction(action) {
    console.log('logoutAction', action)
    this.clearAuthData()
    this._authToken         = null
    this._authenticatedUser = null
    this.emit( 'logout:success' )
  }
}
export default new AuthStore()
