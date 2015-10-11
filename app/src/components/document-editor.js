import element from 'virtual-element'
import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';
import DocumentStore from '../stores/document'


let DocumentEditor = {
  initialState(props) {
    return {
      loaded: false,
      body: "I have document powers!",
    }
  },

  async afterMount(c, el, setState) {
    // document selected listener

    let editor = new EpicEditor({
      basePath: 'epiceditor',
      autogrow: true,
      minHeight: () => Math.max(
          document.body.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.clientHeight,
          document.documentElement.scrollHeight,
          document.documentElement.offsetHeight)
    })
    editor.load()
    editor.on("update", () => {
      // DocumentStore.save()
    })
    Dispatcher.register(action => {
      if (action.actionType == ACTIONS.SELECT_DOCUMENT) {
        editor.getElement('editor').body.innerHTML = DocumentStore.getState()[action.id].body
      }
    })

    setState({ loaded: true })
  },

  render({ props, state }, setState) {
    return <div id="epiceditor"></div>
  }
}
export default DocumentEditor
