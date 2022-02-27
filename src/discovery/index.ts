import type { Service, SSDP } from '@achingbrain/ssdp'
import first from 'it-first'
import pTimeout from 'p-timeout'
import ssdp from '@achingbrain/ssdp'
import { logger } from '@libp2p/logger'
import type { InternetGatewayDevice } from '../upnp/device'

const log = logger('nat-port-mapper:discovery')

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

export function discoverGateway (options: DiscoveryOptions = {}): () => Promise<Service<InternetGatewayDevice>> {
  const timeout = options.timeout ?? ONE_HOUR
  const discoveryTimeout = options.discoveryTimeout ?? ONE_MINUTE
  let service: Service<InternetGatewayDevice>
  let expires: number
  let discovery: SSDP

  return async () => {
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
        discovery = await ssdp()
      }

      log('Discovering gateway')
      const result = await pTimeout(
        first(discovery.discover<InternetGatewayDevice>(ST)),
        discoveryTimeout
      )

      if (result == null) {
        throw new Error('Could not discover gateway')
      }

      log('Discovered gateway %s', result.location)

      service = result
      expires = Date.now() + timeout
    }

    return service
  }
}
