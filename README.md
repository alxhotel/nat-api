# nat-api

[![NPM Version][nat-api-ni]][nat-api-nu]
[![Build Status][nat-api-ti]][nat-api-tu]
[![Dependency Status][nat-api-di]][nat-api-du]
[![Standard - Javascript Style Guide][standard-image]][standard-url]

Fast port mapping with **UPnP** and **NAT-PMP** in NodeJS.

## Install

```sh
npm install nat-api
```

## Usage

```js
const NatAPI = require('nat-api')

const client = new NatAPI()

// Map public port 1000 to private port 1000 with UDP and TCP
client.map(1000, function (err) {
  if (err) return console.log('Error', err)
  console.log('Port mapped!')
})

// Map public port 2000 to private port 3000 with UDP and TCP
client.map(2000, 3000, function (err) {
  if (err) return console.log('Error', err)
  console.log('Port mapped!')
})

// Map public port 4000 to private port 5000 with only UDP
client.map({ publicPort: 4000, privatePort: 5000, ttl: 1800, protocol: 'UDP' }, function (err) {
  if (err) return console.log('Error', err)
  console.log('Port mapped!')
})

// Unmap port public and private port 1000 with UDP and TCP
client.unmap(1000, function (err) {
  if (err) return console.log('Error', err)
  console.log('Port unmapped!') 
})

// Destroy object
client.destroy()
```

## API

### `client = new NatAPI([opts])`

Create a new `nat-api` instance.

If `opts` is specified, then the default options (shown below) will be overridden.

```js
{
  ttl: 1200, // Time to live of each port mapping in seconds (default: 1200)
  autoUpdate: true, // Refresh all the port mapping to keep them from expiring (default: true)
  gateway: '192.168.1.1' // Default gateway (default: null)
}
```

If `gateway` is not set, then `nat-api` will get the default gateway based on the current network interface.

### `client.map(port, [callback])`
* `port`: Public and private ports
* `callback`

This method will use `port` por mapping the public port to the same private port.

It uses the default TTL and creates a map for UDP and TCP.

### `client.map(publicPort, privatePort, [callback])`
* `publicPort`: Public port
* `privatePort`: Private port
* `callback`

This is another quick way of mapping `publciPort` to `privatePort` with any protocol (UDP and TCP).

### `client.map(opts, [callback])`
* `opts`:
 - `publicPort`: Public port
 - `privatePort`: Private port
 - `protocol`: Port protocol (`UDP`, `TCP` or `null` for both)
 - `ttl`: Overwrite the default TTL in seconds.
 - `description`: Description of the port mapping
* `callback`

### `client.unmap(port, [callback])`

Unmap any port that has the public port or private port equal to `port`.

### `client.unmap(publicPort, privatePort, [callback])`

Unmap any port that has the public port or private port equal to `publicPort` and `privatePort`, respectively.

### `client.unmap(opts, [callback])`

Unmap any port that contains the parameters provided in `opts`.

### `client.destroy([callback])`

Destroy the client. Unmaps all the ports open with `nat-api` and cleans up large data structure resources.

## License

MIT. Copyright (c) [Alex](https://github.com/alxhotel)

[nat-api-ti]: https://img.shields.io/travis/alxhotel/nat-api/master.svg
[nat-api-tu]: https://travis-ci.org/alxhotel/nat-api
[nat-api-ni]: https://img.shields.io/npm/v/nat-api.svg
[nat-api-nu]: https://npmjs.org/package/nat-api
[nat-api-di]: https://david-dm.org/alxhotel/nat-api.svg
[nat-api-du]: https://david-dm.org/alxhotel/nat-api
[standard-image]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com
