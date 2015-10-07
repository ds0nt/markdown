import { RelationalModel } from 'backbone';
import {
  isEmail,
  isAlphanumeric,
  isLength
} from 'validator';

import { API_URL } from '../core/constants';

let passwordRE = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/;

export default RelationalModel.extend({
  url         : API_URL + '/users',
  idAttribute : 'username',

  validate: function ( attrs, options ) {
    if ( !isAlphanumeric( attrs.username ) )
      return 'Username can only be alphanumeric characters.';
    if ( !isLength( attrs.username, 3, 20 ) )
      return 'Username must be 3 to 20 characters long.';

    if ( !isEmail( attrs.email ) )
      return 'Not a valid email address.';

    if ( attrs.password && !passwordRE.test( attrs.password ) )
      return 'Password must be at least 8 characters long and contain at least one lower case letter, upper case letter, digit, and special character.';
  }
});