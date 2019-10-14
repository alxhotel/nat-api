const NatAPI = require('../')

var client = new NatAPI()

client.map(8080, function (err) {
  if (err) return console.log('Error: ', err)
  console.log('Port 8080 mapped to 8080 (UDP & TCP)')

  client.destroy(function () {
    console.log('NatAPI client destroyed')
  })
})
