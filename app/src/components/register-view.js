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
  setState({
    submitting: true,
    error: ''
  })
  Dispatcher.dispatch({
    actionType : ACTIONS.REGISTER,
    email   : component.state.email,
    password   : component.state.password
  })
}

let initialState = () => {
  return {
    email   : '',
    password   : '',
    submitting : false,
    error      : ''
  }
}
let afterMount = (c, el, setState) => {
  setState({
    registerHandler: AuthStore.onAction('register:failure', ({error}) => {
      setState({
        submitting : false,
        error      : error
      })
    })

  })
}

let beforeUnmount = (component) => {
  let {state} = component
  state.registerHandler.off()
}
function signup() {
  Dispatcher.dispatch({
    actionType: ACTIONS.SET_ROUTE,
    route: '/signup'
  })
}

let render = c => {
  let { state, props } = c
  let buttonContent = 'Login'
  if ( state.submitting ) {
    buttonContent = (<img src="/img/loading.gif" alt="Logging in..." />)
  }

  return (
  <div class="ui container">
    <div class="register-page">
      <div class={`ui ${state.submitting ? 'loading' : ''} ${state.error !== '' ? 'error' : ''} form`}>
        <div class="field">
          <label>E-mail</label>
          <input type="email" onChange={createFieldHandler('email')} value={state.email} placeholder="joe@schmoe.com" />
          <input type="password" onChange={createFieldHandler('password')} value={state.password} placeholder="Password" />
        </div>
        <div onClick={handleSubmit} class="ui submit button">Submit</div>
        {
          state.error !== '' ?
        <div class="ui error message">
          <div class="header">Login Error</div>
          <p>{state.error}</p>
        </div> : ''
        }
      </div>
      <p class="register-signup-link"><a onClick={signup}>Need an account?</a></p>
    </div>
  </div>
  )
}
let LoginView = {
  initialState,
  afterMount,
  beforeUnmount,
  render
}
export default LoginView
