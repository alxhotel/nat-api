import type { Service, SSDP } from '@achingbrain/ssdp'
import first from 'it-first'
import pTimeout from 'p-timeout'
import ssdp from '@achingbrain/ssdp'
import { logger } from '@libp2p/logger'
import type { InternetGatewayDevice } from '../upnp/device'

const log = logger('nat-port-mapper:discovery')

export interface DiscoverGateway {
  gateway: () => Promise<Service<InternetGatewayDevice>>
  cancel: () => Promise<void>
}

export interface DiscoveryOptions {
  /**
   * Do not search the network for a gateway, use this instead
   */
  gateway?: string

  /**
   * Rediscover gateway after this number of ms
   */
  timeout?: number

  /**
   * Only search the network for this long
   */
  discoveryTimeout?: number
}

const ST = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1'
const ONE_MINUTE = 60000
const ONE_HOUR = ONE_MINUTE * 60

export function discoverGateway (options: DiscoveryOptions = {}): () => DiscoverGateway {
  const timeout = options.timeout ?? ONE_HOUR
  const discoveryTimeout = options.discoveryTimeout ?? ONE_MINUTE
  let service: Service<InternetGatewayDevice>
  let expires: number

  return () => {
    let discovery: SSDP
    let clear: (() => void) | undefined

    const discover: DiscoverGateway = {
      gateway: async () => {
        if (service != null && !(expires < Date.now())) {
          return service
        }

        if (options.gateway != null) {
          log('Using overridden gateway address %s', options.gateway)

          if (!options.gateway.startsWith('http')) {
            options.gateway = `http://${options.gateway}`
          }

          expires = Date.now() + timeout

          service = {
            location: new URL(options.gateway),
            details: {
              device: {
                serviceList: {
                  service: []
                },
                deviceList: {
                  device: []
                }
              }
            },
            expires,
            serviceType: ST,
            uniqueServiceName: 'unknown'
          }
        } else {
          if (discovery == null) {
            discovery = await ssdp({
              start: false
            })
            discovery.on('error', (err) => {
              log.error('ssdp error', err)
            })
            await discovery.start()
          }

          log('Discovering gateway')
          const clearable = pTimeout(
            first(discovery.discover<InternetGatewayDevice>(ST)),
            discoveryTimeout
          )

          clear = clearable.clear

          const result = await clearable

          if (result == null) {
            throw new Error('Could not discover gateway')
          }

          log('Discovered gateway %s', result.location)

          service = result
          expires = Date.now() + timeout
        }

        return service
      },
      cancel: async () => {
        if (discovery != null) {
          await discovery.stop()
        }

        if (clear != null) {
          await clear()
        }
      }
    }

    return discover
  }
}
