import element from 'virtual-element'
import UserStore from '../stores/user'

function createFieldHandler( name ) {
  return ( e ) => {
    let update = {}
    update[ name ] = e.target.value
    this.setState( update )
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
  UserStore.on('login:failure', ( error ) => {
    setState({
      submitting : false,
      error      : error
    })
  })
}

let beforeUnmount = () => {
  UserStore.off( 'login:failure' )
}

let render = c => {
  let { state, props } = c
  let buttonContent = 'Login'
  if ( state.submitting ) {
    buttonContent = (<img src="/img/loading.gif" alt="Logging in..." />)
  }

  return (
    <div className="login-page">
      <img src="/img/logo_big.png" alt="Draw Gaiden - Login" />
      <form onSubmit={handleSubmit} className="pure-form">
        <p className="error">{state.error}</p>
        <input type="text" onChange={createFieldHandler('username')} value={state.username} placeholder="Username" />
        <input type="password" onChange={createFieldHandler('password')} value={state.password} placeholder="Password" />
        <button type="submit" className="login-page-button pure-button pure-button-primary">{buttonContent}</button>
      </form>
      <p className="login-signup-link"><a href="/signup">Need an account?</a></p>
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
