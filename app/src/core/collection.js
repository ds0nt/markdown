import { Collection } from 'backbone';
import { assign } from 'underscore';

export default Collection.extend({
  getAsync: function ( id ) {
    return new Promise(( resolve, reject ) => {
      let model = this.get( id );
      if ( model ) {
        resolve( model );
      } else {
        this.fetch().then(() => {
          let model = this.get( id );
          if ( model ) {
            resolve( model );
          } else {
            reject();
          }
        }).catch( reject );
      }
    });
  },

  fetch: function ( options ) {
    return new Promise(( resolve, reject ) => {
      options = assign({}, {
        success: resolve,
        error: reject
      }, options);
      Collection.prototype.fetch.call( this, options );
    });
  }
});
