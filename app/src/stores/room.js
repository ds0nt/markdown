import $ from 'jquery';
import { assign } from 'lodash';
import Promise from 'bluebird';

import { API_URL, ACTIONS } from '../core/constants';
import Dispatcher from '../core/dispatcher';

import RoomCollection from '../collections/rooms';
import Room from '../models/room';

let RoomStore = RoomCollection.extend({
  _createRoom: function ( details ) {
    return Promise.resolve($.ajax({
      url         : API_URL + '/rooms',
      method      : 'POST',
      contentType : 'application/json',
      data        : JSON.stringify( details )
    })).then(( data ) => {
      let room = new Room( data );
      this.add( room );
      return room;
    }).catch(( err ) => {
      throw errorFromXHR( err );
    });
  },

  _handleAction: function ( payload ) {
    switch ( payload.actionType ) {
      case ACTIONS.CREATE_ROOM:
        this._createRoom({
          name     : payload.name,
          maxUsers : payload.maxUsers
        }).then(( room ) => {
          this.trigger( 'room:create:success', room );
        }).catch(( err ) => {
          this.trigger( 'room:create:error', err.name );
        });
        break;
    }
  },

  initialize: function ( models, options ) {
    RoomCollection.prototype.initialize.call( this, models, options );
    Dispatcher.register( this._handleAction.bind( this ) );
  }
});

export default new RoomStore();