import { API_URL } from '../core/constants';
import Collection from '../core/collection';
import User from '../models/user';

export default Collection.extend({
  model : User,
  url   : API_URL + '/users'
});