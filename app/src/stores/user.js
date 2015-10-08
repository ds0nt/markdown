import { ACTIONS } from '../core/constants'
import Dispatcher from '../core/dispatcher'
import users from '../rest/users'

function initialize() {

}

async function signupAction(action) {
  try {
    await users.create({
      email    : action.email,
      username : action.username,
      password : action.password,
      active   : true
    })
    Dispatcher.dispatch({
      actionType : ACTIONS.LOGIN,
      username : action.username,
      password : action.password,
    })
  } catch(e) {
    console.error( e )
    if ( e instanceof BadRequestError )
      trigger( 'signup:failure', SIGNUP_ERROR_MESSAGE )
  }
}

Dispatcher.register(action => {
  if (action.actionType == ACTIONS.SIGNUP)
    signupAction(action)
})
