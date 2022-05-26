import { Device } from './device.js'
import type { Client, MapPortOptions, UnmapPortOptions } from '../index.js'
import { logger } from '@libp2p/logger'
import type { DiscoverGateway } from '../discovery/index.js'

const log = logger('nat-port-mapper:upnp')

export class UPNPClient implements Client {
  private closed: boolean
  private readonly discoverGateway: () => DiscoverGateway
  private cancelGatewayDiscovery?: () => Promise<void>
  private readonly abortController: AbortController

  static async createClient (discoverGateway: () => DiscoverGateway) {
    return new UPNPClient(discoverGateway)
  }

  constructor (discoverGateway: () => DiscoverGateway) {
    this.discoverGateway = discoverGateway
    this.closed = false

    // used to terminate network operations on shutdown
    this.abortController = new AbortController()
  }

  async map (options: MapPortOptions) {
    if (this.closed) {
      throw new Error('client is closed')
    }

    const gateway = await this.findGateway()
    const description = options.description ?? 'node:nat:upnp'
    const protocol = options.protocol === 'TCP' ? options.protocol : 'UDP'
    let ttl = 60 * 30

    if (typeof options.ttl === 'number') {
      ttl = options.ttl
    }

    if (typeof options.ttl === 'string' && !isNaN(options.ttl)) {
      ttl = Number(options.ttl)
    }

    log('Mapping local port %d to public port %d', options.localPort, options.publicPort)

    await gateway.run('AddPortMapping', [
      ['NewExternalPort', options.publicPort],
      ['NewProtocol', protocol],
      ['NewInternalPort', options.localPort],
      ['NewInternalClient', options.localAddress],
      ['NewEnabled', 1],
      ['NewPortMappingDescription', description],
      ['NewLeaseDuration', ttl],
      ['NewProtocol', options.protocol]
    ], this.abortController.signal)
  }

  async unmap (options: UnmapPortOptions) {
    if (this.closed) {
      throw new Error('client is closed')
    }

    const gateway = await this.findGateway()

    await gateway.run('DeletePortMapping', [
      ['NewExternalPort', options.publicPort],
      ['NewProtocol', options.protocol]
    ], this.abortController.signal)
  }

  async externalIp (): Promise<string> {
    if (this.closed) {
      throw new Error('client is closed')
    }

    log('Discover external IP address')

    const gateway = await this.findGateway()
    const data = await gateway.run('GetExternalIPAddress', [], this.abortController.signal)

    let key = null
    Object.keys(data).some(function (k) {
      if (!/:GetExternalIPAddressResponse$/.test(k)) return false

      key = k
      return true
    })

    if (key == null) {
      throw new Error('Incorrect response')
    }

    log('Discovered external IP address %s', data[key].NewExternalIPAddress)
    return data[key].NewExternalIPAddress
  }

  async findGateway (): Promise<Device> {
    if (this.closed) {
      throw new Error('client is closed')
    }

    const discovery = this.discoverGateway()
    this.cancelGatewayDiscovery = discovery.cancel

    const service = await discovery.gateway()

    this.cancelGatewayDiscovery = undefined

    return new Device(service)
  }

  async close () {
    this.closed = true

    this.abortController.abort()

    if (this.cancelGatewayDiscovery != null) {
      await this.cancelGatewayDiscovery()
    }
  }
}
