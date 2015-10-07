import element from 'virtual-element'
import { render, tree } from 'deku'

export default {
  render: () =>
   <div class="ui pointing inverted menu">
      <a class="active item">
          <i class="inverted blue home icon"></i> Documents
      </a>
      <div class="right menu">
          <a class="item">
              <i class="inverted blue settings icon"></i> Settings
          </a>
          <a class="item">
              <i class="inverted blue user icon"></i> Login
          </a>
      </div>
    </div>
}
