import element from 'virtual-element'
import Dispatcher from '../core/dispatcher';

let Chat = {
  initialState(props) {
    return {
      chats: [],
    }
  },
  afterMount(component, el, setState) {
  },
  beforeUnmount (component, el) {
  },
  render({ props, state }, setState) {
    let { chats } = state

    let sendChat = (e, component, setState) => {
      e.preventDefault()
      alert('Chat Send')
      return false
    }

    let messages = []
    for (let chat of chats) {
      messages.push(<a class="item">{chat.name}</a>)
    }

    let create = () => Dispatcher.dispatchAction(ACTIONS.CREATE_DOCUMENT)

    return <div id="chat" class="ui left fixed vertical menu">
      <div class="ui horizontal divider">Chat</div>
      {messages.length != 0 ? messages : <a class="item" onClick={create}>Start the conversation.</a>}
      <form id="chat-form" onSubmit={sendChat}>
        <input type="text" placeholder="what do you want to say?" class="input text" on/>
      </form>
    </div>
  }
}

export default Chat
