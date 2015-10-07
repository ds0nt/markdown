import Backbone from 'backbone'
import assign from 'assign'
import axios from 'axios'

import { API_URL, ACTIONS, AUTH_HEADER } from '../core/constants'
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  errorFromXHR
} from '../core/errors'

import Dispatcher from '../core/dispatcher'

import UserCollection from '../collections/users'
import User from '../models/user'

const AUTH_DATA_KEY        = 'authData'
const LOGIN_ERROR_MESSAGE  = 'Invalid username or password.'
const SIGNUP_ERROR_MESSAGE = 'Invalid username or password.'

let getAuthData = () => JSON.parse( sessionStorage.getItem( AUTH_DATA_KEY ) )
let setAuthData = data => sessionStorage.setItem( AUTH_DATA_KEY, JSON.stringify( data ) )
let clearAuthData = () => sessionStorage.removeItem( AUTH_DATA_KEY )

let UserStore = UserCollection.extend({
  _authToken         : null,
  _authenticatedUser : null,

  async _login(data) {
    try {
      let data = await axios.post(`${API_URL}/auth/login`, data)
      setAuthData(data)
      this._authToken = data.token
      this._authenticatedUser = new User(data.user)
    } catch(e) {
      throw errorFromXHR(e)
    }
    return
  },

  async _signup(details) {
    try {
      axios.post(`${API_URL}/users`, details)
    } catch (e) {
      throw errorFromXHR(err)
    }
  },

  async _handleAction( payload ) {
    switch ( payload.actionType ) {
      case ACTIONS.LOGIN:
        try {
          let { username, password } = payload
          let res = await this._login({
            username: payload.username,
            password: payload.password,
          })
          this.trigger( 'login:success' )
        } catch(e) {
          if ( e instanceof UnauthorizedError ) {
            this.trigger( 'login:failure', LOGIN_ERROR_MESSAGE )
          } else if ( e instanceof ForbiddenError ) {
            this.trigger( 'login:activate' )
          } else if ( e instanceof NotFoundError ) {
            this.trigger( 'login:failure', LOGIN_ERROR_MESSAGE )
          } else {
            console.error( e.stack )
          }
        }
        break

      case ACTIONS.LOGOUT:
        try {
          await this.logout()
          this.trigger( 'logout:success' )
        } catch(e) {
          console.error( e.stack )
        }
        break

      case ACTIONS.SIGNUP:
        try {
          let data = await this._signup({
            email    : payload.email,
            username : payload.username,
            password : payload.password,
            active   : true
          })
          await this._login({
            username: payload.username,
            password: payload.password,
          })
          this.trigger( 'login:success' )

        } catch(e) {
          if ( e instanceof BadRequestError ) {
            this.trigger( 'signup:failure', SIGNUP_ERROR_MESSAGE )
          } else {
            console.error( e )
            this.trigger( 'signup:failure', 'Unknown error occurred.' )
          }
        }
        break
    }
  },

  initialize: function ( models, options ) {
    UserCollection.prototype.initialize.call( this, models, options )

    var data = getAuthData()
    if ( data ) {
      this._authToken = data.token
      this._authenticatedUser = new User( data.user )
      // Should refetch the user from the API here
    }

    Dispatcher.register( this._handleAction.bind( this ) )

    // Add auth token to request headers when logged in.
    Backbone.ajax = ( options ) => {
      if ( this.isAuthenticated() ) {
        let authHeaders = {}
        authHeaders[ AUTH_HEADER ] = this._authToken
        options.headers = assign({}, authHeaders, options.headers)
      }
      return $.ajax( options )
    }
  },

  isAuthenticated: function () {
    return ( typeof this._authToken === 'string' )
  },

  getAuthenticatedUser: function () {
    return this._authenticatedUser
  },

  logout: function () {
    clearAuthData()
    Backbone.Relational.store.reset()
    this._authToken         = null
    this._authenticatedUser = null
    return Promise.resolve()
  }
})

export default new UserStore()
