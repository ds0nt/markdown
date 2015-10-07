import { API_URL } from '../core/constants';
import Collection from '../core/collection';
import Room from '../models/room';

export default Collection.extend({
  model : Document,
  url   : API_URL + '/documents',
});
