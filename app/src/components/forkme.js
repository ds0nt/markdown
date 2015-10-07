import element from 'virtual-element'

let ghstyle = `
  position: absolute;
  top: 0px;
  left: 0px;
`
let ghforksrc = "https://camo.githubusercontent.com/c6286ade715e9bea433b4705870de482a654f78a/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f6769746875622f726962626f6e732f666f726b6d655f6c6566745f77686974655f6666666666662e706e67"
let canonicalwtf = "https://s3.amazonaws.com/github/ribbons/forkme_left_white_ffffff.png"

let Forkme = {
  render: ({props}) =>
    <a href={`https://github.com/${props.repo}`} style={ghstyle} >
      <img src={ghforksrc} alt="Fork me on GitHub" data-canonical-src={canonicalwtf} />
    </a>
}
export default Forkme
