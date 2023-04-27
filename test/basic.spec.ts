import { type MapPortOptions, upnpNat } from '../src/index.js'

describe('nat-port-mapper', () => {
  it('should map a port', async () => {
    if (process.env.CI != null) {
      return // CI environments don't have uPNP routers!
    }

    const client = upnpNat()
    const details: Partial<MapPortOptions> = {
      localPort: 48932,
      protocol: 'TCP'
    }

    await client.map(details)

    process.on('SIGINT', () => {
      void client.unmap(details)
        .finally(() => {
          process.exit(0)
        })
    })
  })
})
