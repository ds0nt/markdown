import element from 'virtual-element'
import AuthStore from '../stores/auth'
import Dispatcher from '../core/dispatcher'
import { ACTIONS } from '../core/constants'
function createFieldHandler( name ) {
  return (e, c, setState) => {
    let update = {}
    update[ name ] = e.target.value
    setState( update )
  }
}

function handleSubmit( e, component, setState ) {
  e.preventDefault()
  setState({ submitting: true })
  Dispatcher.dispatch({
    actionType : ACTIONS.LOGIN,
    username   : component.state.username,
    password   : component.state.password
  })
}

let initialState = () => {
  return {
    username   : '',
    password   : '',
    submitting : false,
    error      : ''
  }
}
let afterMount = (c, el, setState) => {
  setState({
    loginHandler: AuthStore.onAction('login:failure', error => setState({
      submitting : false,
      error      : error
    }))
  })
}

let beforeUnmount = (component) => {
  let {state} = component
  state.loginHandler.off()
}

let render = c => {
  let { state, props } = c
  let buttonContent = 'Login'
  if ( state.submitting ) {
    buttonContent = (<img src="/img/loading.gif" alt="Logging in..." />)
  }

  return (
    <div class="login-page">
      <form onSubmit={handleSubmit} class="pure-form">
        <p class="error">{state.error}</p>
        <input type="text" onChange={createFieldHandler('username')} value={state.username} placeholder="Username" />
        <input type="password" onChange={createFieldHandler('password')} value={state.password} placeholder="Password" />
        <button type="submit">{buttonContent}</button>
      </form>
      <p class="login-signup-link"><a href="/signup">Need an account?</a></p>
    </div>
  )
}
let LoginView = {
  initialState,
  afterMount,
  beforeUnmount,
  render,
}
export default LoginView
