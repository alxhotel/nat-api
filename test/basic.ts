import { MapPortOptions, upnpNat } from '../src/index.js'

async function main () {
  const client = await upnpNat()
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
}

void main().catch(err => {
  console.error(err) // eslint-disable-line no-console
  process.exit(1)
})
