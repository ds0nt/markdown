import Backbone from 'backbone'
import UserStore from '../stores/user'
import Applcation from '../components/app-page'

import AppView from '../components/app-view'
import LoginView from '../components/login-view'

export default Backbone.Router.extend({
  routes: {
    ''         : 'app',
    'login'    : 'login',
    'logout'   : 'logout',
    'signup'   : 'signup',
    // 'room/:id' : 'room'
  },

  initialize: function ( options ) {
    Backbone.Router.prototype.initialize.call( this, options )
    Applcation.init()
    UserStore.on('login:success', () => {
      this.navigate('', { trigger: true })
    })
    // RoomStore.on('room:create:success', ( room ) => {
    //   this.navigate('room/' + room.get( 'id' ), { trigger: true })
    // })
  },
  app: function() {
    if ( !UserStore.isAuthenticated() ) {
      this.navigate('login', { trigger: true })
    } else {
      Dispatcher.dispatch({
        actionType : ACTIONS.NAVIGATE,
        view   : AppView
      })
    }
  },
  login: function () {
    if ( UserStore.isAuthenticated() ) {
      this.navigate('', { trigger: true })
    } else {
      Dispatcher.dispatch({
        actionType : ACTIONS.NAVIGATE,
        view   : LoginView
      })
    }
  },
  logout: function () {
    UserStore.logout().then(() => {
      this.navigate('login', { trigger: true })
    })
  },

  signup: function () {
    if ( UserStore.isAuthenticated() ) {
      this.navigate('', { trigger: true })
    } else {
      Dispatcher.dispatch({
        actionType : ACTIONS.NAVIGATE,
        view   : 'signup'
      })
    }
  },
})
