# @achingbrain/nat-port-mapper <!-- omit in toc -->

[![codecov](https://img.shields.io/codecov/c/github/achingbrain/nat-port-mapper.svg?style=flat-square)](https://codecov.io/gh/achingbrain/nat-port-mapper)
[![CI](https://img.shields.io/github/actions/workflow/status/achingbrain/nat-port-mapper/js-test-and-release.yml?branch=master\&style=flat-square)](https://github.com/achingbrain/nat-port-mapper/actions/workflows/js-test-and-release.yml?query=branch%3Amaster)

> Port mapping with UPnP and NAT-PMP

## Table of contents <!-- omit in toc -->

- [Install](#install)
- [Usage](#usage)
- [Credits](#credits)
- [Additional Information](#additional-information)
- [License](#license)
- [Contribution](#contribution)

## Install

```console
$ npm i @achingbrain/nat-port-mapper
```

## Usage

```js
import { upnpNat } from '@achingbrain/nat-port-mapper'

const client = await upnpNat({
  // all fields are optional
  ttl: number // how long mappings should live for in seconds - min 20 minutes, default 2 hours
  description: string // default description to pass to the router for a mapped port
  gateway: string // override the router address, will be auto-detected if not set
  keepAlive: boolean // if true, refresh the mapping ten minutes before the ttl is reached, default true
})

// Map public port 1000 to private port 1000 with TCP
await client.map({
  localPort: 1000,
  protocol: 'TCP'
})

// Map public port 2000 to private port 3000 with UDP
await client.map({
  publicPort: 2000,
  localPort: 3000,
  protocol: 'UDP'
})

// Unmap port public and private port 1000 with TCP
await client.unmap({
  localPort: 1000,
  protocol: 'TCP'
})

// Get external IP
const externalIp = await client.externalIp()

console.log('External IP:', ip)

// Unmap all mapped ports
client.close()
```

## Credits

Based on [alxhotel/nat-api](https://github.com/alxhotel/nat-api)

## Additional Information

- <http://miniupnp.free.fr/nat-pmp.html>
- <http://wikipedia.org/wiki/NAT_Port_Mapping_Protocol>
- <http://tools.ietf.org/html/draft-cheshire-nat-pmp-03>

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
