import element from 'virtual-element'
import { render, tree } from 'deku'

export default {
  render: () =>
    <div class="ui attached inverted menu">
      <div class="ui container">
        <div class="header item">
           NotePad
        </div>
        <div class="ui right simple dropdown item">
          <i class="settings icon"></i>
          <div class="menu">
            <a class="item"><i class="edit icon"></i> Edit Profile</a>
            <a class="item"><i class="globe icon"></i> Choose Language</a>
          </div>
        </div>
      </div>
    </div>
}
