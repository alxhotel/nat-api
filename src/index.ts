import defaultGateway from 'default-gateway'
import { logger } from '@libp2p/logger'
import { UPNPClient } from './upnp/index.js'
import { PMPClient } from './pmp/index.js'
import { discoverGateway } from './discovery/index.js'
import os from 'os'

const log = logger('nat-port-mapper')

export interface NatAPIOptions {
  /**
   * Minimum 20 minutes, default 2 hours
   */
  ttl?: number
  description?: string
  gateway?: string
  keepAlive?: boolean
}

export interface MapPortOptions {
  publicPort: number
  localPort: number
  localAddress: string
  protocol: 'TCP' | 'UDP'
  description: string
  ttl: number
  gateway?: string
}

export interface UnmapPortOptions {
  publicPort: number
  localPort: number
  protocol: 'TCP' | 'UDP'
}

export interface Client {
  close: () => Promise<void>
  map: (options: MapPortOptions) => Promise<void>
  unmap: (options: UnmapPortOptions) => Promise<void>
  externalIp: () => Promise<string>
}

export class NatAPI {
  private readonly ttl: number
  private readonly description: string
  private readonly gateway?: string
  private readonly keepAlive: boolean
  private readonly keepAliveInterval: number
  private readonly destroyed: boolean
  private openPorts: MapPortOptions[]
  private readonly client: Client
  private readonly updateIntervals: Map<string, any>

  constructor (opts: NatAPIOptions = {}, client: Client) {
    // TTL is 2 hours (min 20 min)
    this.ttl = opts.ttl != null ? Math.max(opts.ttl, 1200) : 7200
    this.description = opts.description ?? 'NatAPI'
    this.gateway = opts.gateway
    this.keepAlive = opts.keepAlive ?? true
    this.client = client
    this.updateIntervals = new Map()

    // Refresh the mapping 10 minutes before the end of its lifetime
    this.keepAliveInterval = (this.ttl - 600) * 1000
    this.destroyed = false
    this.openPorts = []
  }

  async map (options?: Partial<MapPortOptions>) {
    if (this.destroyed) {
      throw new Error('client is destroyed')
    }

    // Validate input
    const opts = this.validateInput(options)

    // UDP or TCP
    await this.client.map(opts)

    this.openPorts.push(opts)

    if (this.keepAlive) {
      this.updateIntervals.set(`${opts.publicPort}:${opts.localPort}-${opts.protocol}`, setInterval(() => {
        void this.client.map(opts)
          .catch(err => {
            log('Error refreshing port mapping %d:%d for protocol %s mapped on router', opts.publicPort, opts.localPort, opts.protocol, err)
          })
      }, this.keepAliveInterval))
    }

    log('Port %d:%d for protocol %s mapped on router', opts.publicPort, opts.localPort, opts.protocol)
  }

  async unmap (options: Partial<UnmapPortOptions>) {
    if (this.destroyed) {
      throw new Error('client is destroyed')
    }

    // Validate input
    const opts = this.validateInput(options)

    // UDP or TCP
    await this.client.unmap(opts)

    this.openPorts = this.openPorts.filter((openPort) => {
      return openPort.publicPort !== opts.publicPort && openPort.protocol !== opts.protocol
    })

    const key = `${opts.publicPort}:${opts.localPort}-${opts.protocol}`
    clearInterval(this.updateIntervals.get(key))
    this.updateIntervals.delete(key)

    log('Port %d:%d for protocol %s unmapped on router', opts.publicPort, opts.localPort, opts.protocol)
  }

  async close () {
    if (this.destroyed) {
      throw new Error('client already closed')
    }

    if (this.client != null) {
      log('Close UPnP client')
      await this.client.close()
    }

    // stop all updates
    for (const interval of this.updateIntervals.values()) {
      clearInterval(interval)
    }
    this.updateIntervals.clear()

    // Unmap all ports
    await Promise.all(
      this.openPorts.map(async opts => await this.unmap(opts))
    )
  }

  validateInput (options: Partial<MapPortOptions> = {}): MapPortOptions {
    if (options.localPort == null) {
      throw new Error('invalid parameters')
    }

    const output: MapPortOptions = {
      localPort: options.localPort,
      localAddress: options.localAddress ?? findLocalAddress(),
      publicPort: options.publicPort ?? options.localPort,
      protocol: options.protocol ?? 'TCP',
      description: options.description ?? this.description,
      ttl: options.ttl ?? this.ttl,
      gateway: options.gateway ?? this.gateway
    }

    return output
  }

  async externalIp () {
    return await this.client.externalIp()
  }
}

function findLocalAddress () {
  const interfaces = os.networkInterfaces()

  for (const infos of Object.values(interfaces)) {
    if (infos == null) {
      continue
    }

    for (const info of infos) {
      if (info.internal) {
        continue
      }

      if (info.family === 'IPv6') {
        continue
      }

      log('Found local address', info.address)
      return info.address
    }
  }

  throw new Error('Please pass a `localAddress` to the map function')
}

export async function upnpNat (options: Partial<NatAPIOptions> = {}) {
  const client = await UPNPClient.createClient(discoverGateway(options))

  return new NatAPI(options, client)
}

export async function pmpNat (options: Partial<NatAPIOptions> = {}) {
  const client = await PMPClient.createClient(discoverGateway({
    ...options,
    gateway: (await defaultGateway.v4()).gateway
  }))

  return new NatAPI(options, client)
}
