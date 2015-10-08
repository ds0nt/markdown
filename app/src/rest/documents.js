import axios from 'axios'
import { API_URL } from '../core/constants'
import validator from 'validator'

function validate(data) {
}

let endpoint = API_URL + '/documents'
export default {
  read   : (id)       => typeof id === 'undefined'
                       ? axios.get( endpoint )
                       : axios.get( endpoint + `/${id}` ),
  create : (data)     => axios.post( endpoint, data ),
  update : (id, data) => axios.put( endpoint + `/${id}`, data ),
  delete : (id)       => axios.delete( endpoint + `/${id}` ),
}
