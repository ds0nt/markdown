import element from 'virtual-element'
import AuthStore from '../stores/auth'
import Dispatcher from '../core/dispatcher'
import { ACTIONS } from '../core/constants'



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
    loginHandler: AuthStore.onAction('login:failure', ({error}) => {
      setState({
        submitting : false,
        error      : error
      })
    })

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

  let onChangeField = name => (e, c, setState) => {
    setState({
      [name]: e.target.value
    })
  }
  function signup() {
    Dispatcher.dispatch({
      actionType: ACTIONS.SET_ROUTE,
      route: '/register'
    })
  }

  function handleSubmit( e, component, setState ) {
    e.preventDefault()
    setState({
      submitting: true,
      error: ''
    })
    Dispatcher.dispatch({
      actionType : ACTIONS.LOGIN,
      email   : component.state.email,
      password   : component.state.password
    })
    return false
  }

  return (
  <div class="ui fluid doubling grid centered container">
    <div class="row">
      <div class="four wide column login-page">
        <div class={`ui ${state.submitting ? 'loading' : ''} ${state.error !== '' ? 'error' : ''} form`}>
          <form>
            <h2>Login</h2>
            <div class="field">
              <label>E-mail</label>
              <input name="email" type="email" onChange={onChangeField('email')} value={state.email} placeholder="joe@schmoe.com" />
              <label>Password</label>
              <input name="password" type="password" onChange={onChangeField('password')} value={state.password} placeholder="Password" />
            </div>
            <button type="button" onClick={handleSubmit} class="ui submit button">{buttonContent}</button>
          {
            state.error !== '' ?
            <div class="ui error message">
              <div class="header">Login Error</div>
              <p>{state.error}</p>
            </div> : ''
          }
          </form>
        </div>
        <p class="login-signup-link"><a onClick={signup}>Need an account?</a></p>
      </div>
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
