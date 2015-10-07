import element from 'virtual-element'

function submitData(el) {
  let children = el.querySelectorAll('input')

  let res = {}
  for (let child of children) {
    res[child.name || child.id || child.type] = child.value
  }
  return res
}

function process(ev, c, update) {
  ev.preventDefault()
  update({ error: '' })
  c.props.onSubmit(submitData(ev.target), c, update)
  return false
}

let Form = {
  initialState() {
    return {
      error: '',
      faded: true,
    }
  },
  render(c, update) {
    let { props, state } = c
    let title = props.title

    let focus = (e) => update({ faded: false })
    let blur = (e) => update({ faded: true })
    return <form {... props} onSubmit={process} onFocus={focus} onBlur={blur} class={{ form: true, faded: state.faded }}>
      <h3>{title}</h3>
      <span class="error">{state.error}</span>
      {props.children}
    </form>
  }
}

export default Form
