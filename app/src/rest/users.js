import axios from 'axios'
import { API_URL } from '../core/constants'
import validator from 'validator'

function validate(data) {
  if ( !validator.isAlphanumeric( data.username ) )
    return 'Username can only be alphanumeric characters.'

  if ( !validator.isLength( data.username, 3, 20 ) )
    return 'Username must be 3 to 20 characters long.'

  if ( !validator.isEmail( data.email ) )
    return 'Not a valid email address.'

  if ( data.password && !data.password.length < 8 )
    return 'Password must be at least 8 characters long'
}

let endpoint = API_URL + '/users'
export default {
  read   : (id)       => typeof id === 'undefined'
                       ? axios.get( endpoint )
                       : axios.get( endpoint + `/${id}` ),
  create : (data)     => axios.post( endpoint, data ),
  update : (id, data) => axios.put( endpoint + `/${id}`, data ),
  delete : (id)       => axios.delete( endpoint + `/${id}` ),
}
