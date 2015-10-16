import element from 'virtual-element'
import {ACTIONS} from '../core/constants';
import Dispatcher from '../core/dispatcher';
import DocumentStore from '../stores/document'
import debounce from 'lodash.debounce'

let trailingSave = debounce((documentId, body) => {
  console.log('debounce save')
  DocumentStore.save(documentId, { body })
}, 500, { leading: false, maxWait: 5000,  trailing: true, })


let DocumentEditor = {
  initialState(props) {
    return {
      loaded: false,
      doc: null,
      saveHandler: () => {},
      offSave: { off: () => {} },
    }
  },
  shouldUpdate(component, nextProps, nextState) {
    let {props, state, id} = component
    return state.doc !== nextState.doc
  },

  beforeUpdate(component, nextProps, nextState) {
    let {props, state, id} = component
    state.editor.removeListener("update")
    state.offSave.off()
  },

  afterUpdate(component, prevProps, prevState, setState) {
    let {props, state, id} = component
    state.editor.importFile(state.doc.id, state.doc.body)

    state.editor.on("update", () => {
      // immediately cache the html bodyz
      let body = state.editor.exportFile()
      let documentId = state.doc.id
      trailingSave(documentId, body)
    })
    // document selected listener
    setState({
      offSave: Dispatcher.onAction(ACTIONS.SAVE_DOCUMENT, async () => {
        let body = state.editor.exportFile()
        let documentId = state.doc.id
        await DocumentStore.save(documentId, { body })
        await DocumentStore.sync()
      })
    })
  },

  async afterMount(c, el, setState) {
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
    setState({
      editor: editor
    })
    DocumentStore.onAction('update', async(data) => {
      try {
        let doc = DocumentStore.getState().selected
        setState({
          loaded: true,
          doc: doc,
        })
      } catch (e) {
        console.error(e)
      }
    })
  },
  render({ props, state }, setState) {
    return <div id="epiceditor"></div>
  }
}
export default DocumentEditor
