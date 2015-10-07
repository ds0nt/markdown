import { render, tree } from 'deku'
import element from 'virtual-element'
import Form from './form'

let login = async({ email, password }, c, update) => {
  alert(JSON.stringify({ email, password }))
  // try {
  //   // let { data } = await api.login({ email, password })
  //   // props.done(data.user)
  // } catch (e) {
  //   return update({ error: e.data.error || e.error })
  // }
}
let LoginView = {
  render: () =>
    <section class="view ui grid container">
      <div class="six wide column">
        <Form onSubmit={login} title="Login">
          <h4>Email</h4>
          <input autofocus type="email" class="email"/>
          <h4>Password</h4>
          <input type="password" class="password" />
          <button type="submit" class="login-btn primary">Login</button>
        </Form>
      </div>
    </section>
}
export default LoginView
