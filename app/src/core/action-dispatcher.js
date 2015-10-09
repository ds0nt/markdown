import Flux from 'flux';

class Dispatcher extends Flux.Dispatcher {
  onAction(type, callback) {
    let id = this.register(({ actionType, ...data }) => {
      if (type == actionType) {
        callback(data)
      }
    })
    return {
      off: () => this.unregister(id)
    }
  }
}

export default Dispatcher
