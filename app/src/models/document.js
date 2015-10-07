import { RelationalModel } from 'backbone';

import { API_URL } from '../core/constants';

export default RelationalModel.extend({
  url : API_URL + '/documents',

  defaults: {
    name     : 'Some Notes',
  },

  validate: function ( attrs, options ) {
    if ( attrs.name.length < 4 )
      return 'Name must have at least 4 characters.';
  }
});
