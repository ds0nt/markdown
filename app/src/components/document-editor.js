import element from 'virtual-element'
import { render, tree } from 'deku'


let DocumentEditor = {
  initialState(props) {
    return {
      loaded: false
    }
  },

  async afterMount(c, el, setState) {
    var editor = new EpicEditor({
      basePath: 'epiceditor'
    }).load();
    setState({ loaded: true })
  },

  render({ props, state }, setState) {
    return <div id="epiceditor">

    </div>
  }
}
export default DocumentEditor
