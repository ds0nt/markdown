import $ from 'jquery';
import Backbone from 'backbone';
import { assign } from 'underscore';

import { API_URL, ACTIONS, AUTH_HEADER } from '../core/constants';
import Dispatcher from '../core/dispatcher';
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  errorFromXHR
} from '../core/errors';
import UserCollection from '../collections/users';
import User from '../models/user';

const AUTH_DATA_KEY        = 'authData';
const LOGIN_ERROR_MESSAGE  = 'Invalid username or password.';
const SIGNUP_ERROR_MESSAGE = 'Invalid username or password.';

function getAuthData() {
  return JSON.parse( sessionStorage.getItem( AUTH_DATA_KEY ) );
}

function setAuthData( data ) {
  sessionStorage.setItem( AUTH_DATA_KEY, JSON.stringify( data ) );
}

function clearAuthData() {
  sessionStorage.removeItem( AUTH_DATA_KEY );
}

let UserStore = UserCollection.extend({
  _authToken         : null,
  _authenticatedUser : null,

  _login: function ( username, password ) {
    return Promise.resolve($.ajax({
      url         : API_URL + '/auth/login',
      method      : 'POST',
      contentType : 'application/json',
      data        : JSON.stringify({
        username : username,
        password : password
      })
    })).then(( data ) => {
      setAuthData( data );
      this._authToken         = data.token;
      this._authenticatedUser = new User( data.user );
      return this._authenticatedUser;
    }).catch(( err ) => {
      throw errorFromXHR( err );
    });
  },

  _signup: function ( details ) {
    return Promise.resolve($.ajax({
      url         : API_URL + '/users',
      method      : 'POST',
      contentType : 'application/json',
      data        : JSON.stringify( details )
    })).catch(( err ) => {
      throw errorFromXHR( err );
    });
  },

  _handleAction: function ( payload ) {
    switch ( payload.actionType ) {
      case ACTIONS.LOGIN:
        this._login( payload.username, payload.password ).then(() => {
          this.trigger( 'login:success' );
        }).catch(( err ) => {
          if ( err instanceof UnauthorizedError ) {
            this.trigger( 'login:failure', LOGIN_ERROR_MESSAGE );
          } else if ( err instanceof ForbiddenError ) {
            this.trigger( 'login:activate' );
          } else if ( err instanceof NotFoundError ) {
            this.trigger( 'login:failure', LOGIN_ERROR_MESSAGE );
          } else {
            console.error( err.stack );
          }
        });
        break;

      case ACTIONS.LOGOUT:
        this.logout().then(() => {
          this.trigger( 'logout:success' );
        }).catch(( err ) => {
          console.error( err.stack );
        });
        break;

      case ACTIONS.SIGNUP:
        this._signup({
          email    : payload.email,
          username : payload.username,
          password : payload.password,
          active   : true // TODO: Should have email activation
        }).then(( data ) => {
          // this.trigger( 'signup:success', data );
          // TEMPORARY until email activation is done
          this._login( payload.username, payload.password ).then(() => {
            this.trigger( 'login:success' );
          });
        }).catch(( err ) => {
          if ( err instanceof BadRequestError ) {
            this.trigger( 'signup:failure', SIGNUP_ERROR_MESSAGE );
          } else {
            console.error( err );
            this.trigger( 'signup:failure', 'Unknown error occurred.' );
          }
        });
        break;
    }
  },

  initialize: function ( models, options ) {
    UserCollection.prototype.initialize.call( this, models, options );

    var data = getAuthData();
    if ( data ) {
      this._authToken = data.token;
      this._authenticatedUser = new User( data.user );
      // Should refetch the user from the API here
    }

    Dispatcher.register( this._handleAction.bind( this ) );

    // Add auth token to request headers when logged in.
    Backbone.ajax = ( options ) => {
      if ( this.isAuthenticated() ) {
        let authHeaders = {};
        authHeaders[ AUTH_HEADER ] = this._authToken;
        options.headers = assign({}, authHeaders, options.headers);
      }
      return $.ajax( options );
    };
  },

  isAuthenticated: function () {
    return ( typeof this._authToken === 'string' );
  },

  getAuthenticatedUser: function () {
    return this._authenticatedUser;
  },

  logout: function () {
    clearAuthData();
    Backbone.Relational.store.reset();
    this._authToken         = null;
    this._authenticatedUser = null;
    return Promise.resolve();
  }
});

export default new UserStore();
