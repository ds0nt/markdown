import axios from 'axios'

let host = 'http://localhost:3000'

function store({loadfn, fetchfn, savefn}) {
  this.keys = []
  this.items = {}

  let load = async () => {
    return await axios.get(`${host}${loadfn}`)
  }

  let fetch = async (key) => {
    return await axios.get(`${host}${fetchfn}/${key}`)
  }

  let save = async (key, data) => {
    return await axios.post(`${host}${savefn}/${key}`, { data } )
  }

  return {
    load,
    fetch,
    save,
  }
}

export let documents = new store({
  loadfn: `/documents`,
  fetchfn: `/documents`,
  savefn: `/documents`,
})
