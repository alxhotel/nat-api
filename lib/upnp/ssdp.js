const dgram = require('dgram')
const os = require('os')
const EventEmitter = require('events').EventEmitter

class Ssdp extends EventEmitter {
  constructor (opts) {
    super()

    opts = opts || {}

    this.multicast = '239.255.255.250'
    this.port = 1900

    this._sourcePort = opts.sourcePort || 0
    this._bound = false
    this._boundCount = 0
    this._destroyed = false
    this._queue = []

    // Create sockets on all external interfaces
    this.createSockets()
  }

  createSockets () {
    const self = this
    const interfaces = os.networkInterfaces()

    this.sockets = []
    for (let key in interfaces) {
      interfaces[key].filter(function (item) {
        return !item.internal
      }).forEach(function (item) {
        self.sockets.push(self.createSocket(item))
      })
    }
  }

  search (device, promise) {
    if (!promise) {
      promise = new EventEmitter()
      promise._ended = false
      promise.once('end', function () {
        promise._ended = true
      })
    }

    if (!this._bound) {
      this._queue.push({ action: 'search', device: device, promise: promise })
      return promise
    }

    // If promise was ended before binding - do not send queries
    if (promise._ended) return

    const self = this
    const query = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: ' + this.multicast + ':' + this.port + '\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 1\r\n' +
      'ST: ' + device + '\r\n' +
      '\r\n'
    )

    // Send query on each socket
    this.sockets.forEach(function (socket) {
      socket.send(query, 0, query.length, self.port, self.multicast)
    })

    function ondevice (info, address) {
      if (promise._ended) return
      if (info.st !== device) return

      promise.emit('device', info, address)
    }
    this.on('_device', ondevice)

    // Detach listener after receiving 'end' event
    promise.once('end', function () {
      self.removeListener('_device', ondevice)
    })

    return promise
  }

  createSocket (interf) {
    const self = this
    const socket = dgram.createSocket(interf.family === 'IPv4' ? 'udp4' : 'udp6')

    socket.on('message', function (message, info) {
      // Ignore messages after closing sockets
      if (self._destroyed) return

      // Parse response
      self._parseResponse(message.toString(), socket.address, info)
    })

    // Bind in next tick (sockets should be me in this.sockets array)
    process.nextTick(function () {
      // Unqueue this._queue once all sockets are ready
      function onReady () {
        if (self._boundCount < self.sockets.length) return

        self._bound = true
        self._queue.forEach(function (item) {
          return self[item.action](item.device, item.promise)
        })
      }

      socket.on('listening', function () {
        self._boundCount += 1
        onReady()
      })

      // On error - remove socket from list and execute items from queue
      socket.once('error', function () {
        socket.close()
        self.sockets.splice(self.sockets.indexOf(socket), 1)
        onReady()
      })

      socket.address = interf.address
      socket.bind(self._sourcePort, interf.address)
    })

    return socket
  }

  // TODO create separate logic for parsing unsolicited upnp broadcasts,
  // if and when that need arises
  _parseResponse (response, addr, remote) {
    const self = this

    // Ignore incorrect packets
    if (!/^(HTTP|NOTIFY)/m.test(response)) return

    const headers = self._parseMimeHeader(response)

    // Messages that match the original search target
    if (!headers.st) return

    this.emit('_device', headers, addr)
  }

  _parseMimeHeader (headerStr) {
    const lines = headerStr.split(/\r\n/g)

    // Parse headers from lines to hashmap
    return lines.reduce(function (headers, line) {
      line.replace(/^([^:]*)\s*:\s*(.*)$/, function (a, key, value) {
        headers[key.toLowerCase()] = value
      })
      return headers
    }, {})
  }

  destroy () {
    this.sockets.forEach((socket) => {
      socket.close()
    })
    this._destroyed = true
  }
}

module.exports = Ssdp
