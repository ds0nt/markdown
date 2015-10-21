import element from 'virtual-element'
import AuthStore from '../stores/auth'
import Dispatcher from '../core/dispatcher'
import { ACTIONS } from '../core/constants'


let initialState = () => {
  return {
    email   : '',
    password   : '',
    password2   : '',
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
let render = c => {
  let { state, props } = c
  let buttonContent = 'Register'
  if ( state.submitting ) {
    buttonContent = (<img src="/img/loading.gif" alt="Logging in..." />)
  }

  let onChangeField = name => (e, c, setState) => {
    setState({
      [name]: e.target.value
    })
  }

  function handleSubmit(e, component, setState ) {
    e.preventDefault()
    let {props, state} = component
    if (state.password !== state.password2) {
      setState({
        submitting: false,
        error: 'Passwords do not match'
      })
      return
    }
    setState({
      submitting: true,
      error: ''
    })
    Dispatcher.dispatch({
      actionType : ACTIONS.REGISTER,
      email   : state.email,
      password   : state.password
    })
    return false
  }

  function login() {
    Dispatcher.dispatch({
      actionType: ACTIONS.SET_ROUTE,
      route: '/login'
    })
  }

  return (
  <div class="ui container">
    <div class="register-page">
      <div class={`ui ${state.submitting ? 'loading' : ''} ${state.error !== '' ? 'error' : ''} form`}>
        <form>
          <h2>Register</h2>
          <div class="field">
            <label>E-mail</label>
            <input name="email" type="email" onChange={onChangeField('email')} value={state.email} placeholder="joe@schmoe.com" />
            <label>Password</label>
            <input name="password" type="password" onChange={onChangeField('password')} value={state.password} placeholder="Password" />
            <label>Confirm Password</label>
            <input name="password2" type="password" onChange={onChangeField('password2')} value={state.password2} placeholder="Confirm Password" />
          </div>
          <button type="button" onClick={handleSubmit} class="ui submit button">{buttonContent}</button>
          {
            state.error !== '' ?
            <div class="ui error message">
              <div class="header">Registation Error</div>
              <p>{state.error}</p>
            </div> : ''
          }
        </form>
      </div>
      <p class="register-signup-link">
        <a onClick={login}>Already have an account?</a>
      </p>
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
