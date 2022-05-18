import { createSocket } from 'dgram'
import { logger } from '@libp2p/logger'
import { EventEmitter } from 'events'
import errCode from 'err-code'
import defer, { DeferredPromise } from 'p-defer'
import type { Socket, RemoteInfo } from 'dgram'
import type { Client, MapPortOptions, UnmapPortOptions } from '../index.js'
import type { DiscoverGateway } from '../discovery/index.js'

const debug = logger('nat-port-mapper:pmp')

// Ports defined by draft
const CLIENT_PORT = 5350
const SERVER_PORT = 5351

// Opcodes
const OP_EXTERNAL_IP = 0
const OP_MAP_UDP = 1
const OP_MAP_TCP = 2
const SERVER_DELTA = 128

// Resulit codes
const RESULT_CODES: Record<number, string> = {
  0: 'Success',
  1: 'Unsupported Version',
  2: 'Not Authorized/Refused (gateway may have NAT-PMP disabled)',
  3: 'Network Failure (gateway may have not obtained a DHCP lease)',
  4: 'Out of Resources (no ports left)',
  5: 'Unsupported opcode'
}

export interface PortMappingOptions {
  type?: 'tcp' | 'udp'
  ttl?: number
  public?: boolean
  private?: boolean
  internal?: boolean
  external?: boolean
}

export class PMPClient extends EventEmitter implements Client {
  private readonly socket: Socket
  private queue: Array<{ op: number, buf: Uint8Array, deferred: DeferredPromise<any> }>
  private connecting: boolean
  private listening: boolean
  private req: any
  private reqActive: boolean
  private readonly discoverGateway: () => DiscoverGateway
  private gateway?: string
  private cancelGatewayDiscovery?: () => Promise<void>

  static async createClient (discoverGateway: () => DiscoverGateway) {
    return new PMPClient(discoverGateway)
  }

  constructor (discoverGateway: () => DiscoverGateway) {
    super()

    if (discoverGateway == null) {
      throw new Error('discoverGateway is not defined')
    }

    this.discoverGateway = discoverGateway
    this.queue = []
    this.connecting = false
    this.listening = false
    this.req = null
    this.reqActive = false

    // Create socket
    this.socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('listening', () => this.onListening())
    this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo))
    this.socket.on('close', () => this.onClose())
    this.socket.on('error', (err) => this.onError(err))

    // Try to connect
    this.connect()
  }

  connect () {
    debug('Client#connect()')
    if (this.connecting) return
    this.connecting = true
    this.socket.bind(CLIENT_PORT)
  }

  async map (opts: MapPortOptions) {
    debug('Client#portMapping()')
    let opcode: number
    switch (String(opts.protocol ?? 'tcp').toLowerCase()) {
      case 'tcp':
        opcode = OP_MAP_TCP
        break
      case 'udp':
        opcode = OP_MAP_UDP
        break
      default:
        throw new Error('"type" must be either "tcp" or "udp"')
    }

    const discoverGateway = this.discoverGateway()
    this.cancelGatewayDiscovery = discoverGateway.cancel

    const gateway = await discoverGateway.gateway()
    this.cancelGatewayDiscovery = undefined

    this.gateway = new URL(gateway.location).host

    const deferred = defer()

    this.request(opcode, opts, deferred)

    await deferred.promise
  }

  async unmap (opts: UnmapPortOptions) {
    debug('Client#portUnmapping()')

    await this.map({
      ...opts,
      description: '',
      localAddress: '',
      ttl: 0
    })
  }

  async externalIp () {
    debug('Client#externalIp()')

    const discoverGateway = this.discoverGateway()
    this.cancelGatewayDiscovery = discoverGateway.cancel

    const gateway = await discoverGateway.gateway()
    this.cancelGatewayDiscovery = undefined

    this.gateway = new URL(gateway.location).host

    const deferred = defer<string>()

    this.request(OP_EXTERNAL_IP, {}, deferred)

    return await deferred.promise
  }

  async close () {
    debug('Client#close()')

    if (this.socket != null) {
      this.socket.close()
    }

    this.queue = []
    this.connecting = false
    this.listening = false
    this.req = null
    this.reqActive = false

    if (this.cancelGatewayDiscovery != null) {
      await this.cancelGatewayDiscovery()
    }
  }

  /**
   * Queues a UDP request to be send to the gateway device.
   */

  request (op: number, obj: PortMappingOptions, deferred: DeferredPromise<any>) {
    debug('Client#request()', [op, obj])

    let buf
    let size
    let pos = 0

    let internal
    let external
    let ttl

    switch (op) {
      case OP_MAP_UDP:
      case OP_MAP_TCP:
        if (obj == null) {
          throw new Error('mapping a port requires an "options" object')
        }

        internal = Number(obj.private ?? obj.internal ?? 0)
        if (internal !== (internal | 0) ?? internal < 0) {
          throw new Error('the "private" port must be a whole integer >= 0')
        }

        external = Number(obj.public ?? obj.external ?? 0)
        if (external !== (external | 0) ?? external < 0) {
          throw new Error('the "public" port must be a whole integer >= 0')
        }

        ttl = Number(obj.ttl ?? 0)
        if (ttl !== (ttl | 0)) {
          // The RECOMMENDED Port Mapping Lifetime is 7200 seconds (two hours)
          ttl = 7200
        }

        size = 12
        buf = Buffer.alloc(size)
        buf.writeUInt8(0, pos)
        pos++ // Vers = 0
        buf.writeUInt8(op, pos)
        pos++ // OP = x
        buf.writeUInt16BE(0, pos)
        pos += 2 // Reserved (MUST be zero)
        buf.writeUInt16BE(internal, pos)
        pos += 2 // Internal Port
        buf.writeUInt16BE(external, pos)
        pos += 2 // Requested External Port
        buf.writeUInt32BE(ttl, pos)
        pos += 4 // Requested Port Mapping Lifetime in Seconds
        break
      case OP_EXTERNAL_IP:
        size = 2
        buf = Buffer.alloc(size)
        // Vers = 0
        buf.writeUInt8(0, 0)
        pos++
        // OP = x
        buf.writeUInt8(op, 1)
        pos++
        break
      default:
        throw new Error(`Invalid opcode: ${op}`)
    }
    // assert.equal(pos, size, 'buffer not fully written!')

    // Add it to queue
    this.queue.push({ op, buf: buf, deferred })

    // Try to send next message
    this._next()
  }

  /**
   * Processes the next request if the socket is listening.
   */

  _next () {
    debug('Client#_next()')

    const req = this.queue[0]

    if (req == null) {
      debug('_next: nothing to process')
      return
    }

    if (this.socket == null) {
      debug('_next: client is closed')
      return
    }

    if (!this.listening) {
      debug('_next: not "listening" yet, cannot send out request yet')

      if (!this.connecting) {
        this.connect()
      }

      return
    }

    if (this.reqActive) {
      debug('_next: already an active request so wait...')
      return
    }

    this.reqActive = true
    this.req = req

    const buf = req.buf

    debug('_next: sending request', buf, this.gateway)
    this.socket.send(buf, 0, buf.length, SERVER_PORT, this.gateway)
  }

  onListening () {
    debug('Client#onListening()')
    this.listening = true
    this.connecting = false

    // Try to send next message
    this._next()
  }

  onMessage (msg: Buffer, rinfo: RemoteInfo) {
    // Ignore message if we're not expecting it
    if (this.queue.length === 0) {
      return
    }

    debug('Client#onMessage()', [msg, rinfo])

    const cb = (err?: Error, parsed?: any) => {
      this.req = null
      this.reqActive = false

      if (err != null) {
        if (req.deferred != null) {
          req.deferred.reject(err)
        } else {
          this.emit('error', err)
        }
      } else if (req.deferred != null) {
        req.deferred.resolve(parsed)
      }

      // Try to send next message
      this._next()
    }

    const req = this.queue[0]
    const parsed: any = { msg: msg }
    parsed.vers = msg.readUInt8(0)
    parsed.op = msg.readUInt8(1)

    if (parsed.op - SERVER_DELTA !== req.op) {
      debug('WARN: ignoring unexpected message opcode', parsed.op)
      return
    }

    // if we got here, then we're gonna invoke the request's callback,
    // so shift this request off of the queue.
    debug('removing "req" off of the queue')
    this.queue.shift()

    if (parsed.vers !== 0) {
      cb(new Error(`"vers" must be 0. Got: ${parsed.vers}`)) // eslint-disable-line @typescript-eslint/restrict-template-expressions
      return
    }

    // Common fields
    parsed.resultCode = msg.readUInt16BE(2)
    parsed.resultMessage = RESULT_CODES[parsed.resultCode]
    parsed.epoch = msg.readUInt32BE(4)

    // Error
    if (parsed.resultCode !== 0) {
      return cb(errCode(new Error(parsed.resultMessage), parsed.resultCode))
    }

    // Success
    switch (req.op) {
      case OP_MAP_UDP:
      case OP_MAP_TCP:
        parsed.private = parsed.internal = msg.readUInt16BE(8)
        parsed.public = parsed.external = msg.readUInt16BE(10)
        parsed.ttl = msg.readUInt32BE(12)
        parsed.type = (req.op === OP_MAP_UDP) ? 'udp' : 'tcp'
        break
      case OP_EXTERNAL_IP:
        parsed.ip = []
        parsed.ip.push(msg.readUInt8(8))
        parsed.ip.push(msg.readUInt8(9))
        parsed.ip.push(msg.readUInt8(10))
        parsed.ip.push(msg.readUInt8(11))
        break
      default:
        return cb(new Error(`Unknown opcode: ${req.op}`))
    }

    cb(undefined, parsed)
  }

  onClose () {
    debug('Client#onClose()')
    this.listening = false
    this.connecting = false
  }

  onError (err: Error) {
    debug('Client#onError()', [err])
    if (this.req?.cb != null) {
      this.req.cb(err)
    } else {
      this.emit('error', err)
    }

    if (this.socket != null) {
      this.socket.close()
      // Force close - close() does not guarantee to trigger onClose()
      this.onClose()
    }
  }
}
