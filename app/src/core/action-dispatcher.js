import Flux from 'flux';

function stackFrom() {
    var err = new Error();
    return window.printFrom ? err.stack.split('\n')[3] : ""
}

class Dispatcher extends Flux.Dispatcher {
  dispatchAction(actionType, data) {
    console.log("Dispatching", actionType, JSON.stringify(data, false, 4), stackFrom())
    this.dispatch({
      actionType,
      ...(typeof data !== 'undefined' ? data : {})
    })
  }
  onAction(type, callback) {
    console.log("Registered handler", type, stackFrom())
    let id = this.register(({ actionType, ...data }) => {
      if (type == actionType) {
        console.log("Firing handler for ", type, stackFrom())
        callback(data)
      }
    })
    return {
      off: () => {
        console.log("Unregister", type, stackFrom())
        this.unregister(id)
      }
    }
  }
}

export default Dispatcher
