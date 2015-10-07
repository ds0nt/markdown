import Backbone from 'backbone';
import { extend } from 'lodash';

import { ACTIONS, TOOLS, TOOL_MAX_SIZE } from '../core/constants';
import Dispatcher from '../core/dispatcher';

let ToolbarStore = Backbone.Model.extend({
  defaults: function () {
    return {
      selectedTool: 'pencil',
      colors: [
        '#000000',
        '#ffffff'
      ],
      toolSize: 1
    };
  },

  _handleAction: function ( payload ) {
    let colors;
    switch ( payload.actionType ) {
      case ACTIONS.SELECT_TOOL:
        if ( TOOLS.indexOf( payload.toolName ) > -1 ) {
          this.set( 'selectedTool', payload.toolName );
        }
        break;

      case ACTIONS.SELECT_TOOL_COLOR:
        colors = this.get( 'colors' );
        colors[ payload.slot ] = payload.color;
        this.set( 'colors', colors );
        break;

      case ACTIONS.TOOL_COLOR_SWAP:
        colors = this.get( 'colors' );
        this.set('colors', [ colors[ 1 ], colors[ 0 ] ]);
        break;

      case ACTIONS.SELECT_TOOL_SIZE:
        if ( payload.size > 0 && payload.size < TOOL_MAX_SIZE ) {
          this.set( 'toolSize', parseInt( payload.size, 10 ) );
        }
        break;
    }
  },

  initialize: function ( attributes, options ) {
    Backbone.Model.prototype.initialize.call( this, attributes, options );
    Dispatcher.register( this._handleAction.bind( this ) );
  }
});

export default new ToolbarStore();