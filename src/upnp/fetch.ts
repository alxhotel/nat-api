import http from 'http'
import https from 'https'
import { logger } from '@libp2p/logger'

const log = logger('nat-port-mapper:upnp:fetch')

export interface RequestInit {
  method: 'POST' | 'GET'
  headers: Record<string, string>
  body: Buffer | string
  signal: AbortSignal
}

function initRequest (url: URL, init: RequestInit): http.ClientRequest {
  if (url.protocol === 'http:') {
    return http.request(url, {
      method: init.method,
      headers: init.headers,
      signal: init.signal
    })
  } else if (url.protocol === 'https:') {
    return https.request(url, {
      method: init.method,
      headers: init.headers,
      rejectUnauthorized: false,
      signal: init.signal
    })
  } else {
    throw new Error('Invalid protocol ' + url.protocol)
  }
}

export async function fetchXML (url: URL, init: RequestInit): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = initRequest(url, init)

    if (init.body != null) {
      request.write(init.body)
    }

    request.end()

    request.on('error', (err) => {
      reject(err)
    })

    request.on('response', (response) => {
      if (response.statusCode === 302 && response.headers.location != null) {
        log('Redirecting to %s', response.headers.location)
        fetchXML(new URL(response.headers.location), init)
          .then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        throw new Error(`Request failed: ${response.statusCode}`) // eslint-disable-line @typescript-eslint/restrict-template-expressions
      }

      if (response.headers['content-type'] != null && !response.headers['content-type'].includes('/xml')) {
        reject(new Error('Bad content type ' + response.headers['content-type'])); return
      }

      let body = ''

      response.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      response.on('end', () => {
        resolve(body)
      })
      response.on('error', (err) => {
        reject(err)
      })
    })
  })
}
