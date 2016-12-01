"use strict";
const UL = require('./ultralight');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const dgram = require('dgram');

function Timer() {
  this.time = 500;
  this.internal = null;
}

util.inherits(Timer, EventEmitter);

Timer.prototype.start = function(miliseconds) {
  var that = this;
  this.time = miliseconds;
  this.stop();
  this.internal = setTimeout(function() {
    that.emit('expire');
  }, miliseconds);
  return this;
}

Timer.prototype.stop = function() {
  if (this.internal) {
    clearTimeout(this.internal);
  }
  this.internal = null;
  return this;
}

Timer.prototype.restart = function() {
  this.start(this.time);
}

function uuConnection() {
  EventEmitter.call(this)
  this.peers = {};
  this.socket = dgram.createSocket('udp4');
  this.outgoingQueue = [];
  this.ackTimer = new Timer();

  var that = this;
  this.ackTimer.on('expire', function() {
    console.log("Ack expirado.");
    that.sendNext();
  });
}

util.inherits(uuConnection, EventEmitter);

uuConnection.prototype.parseDatagram = function(datagram) {
  var packet = new uuPacket();
  if (datagram.length >= 5) {
    packet.id = datagram.readUInt32LE(0);
    packet.type = datagram.readInt8(4);
    if (datagram.length > 5) {
      var s = datagram.toString('utf8', 5);
      packet.data = UL.parse(s);
    }
  } else {
    console.log("Discarding packet too small.");
  }
  return packet;
}

uuConnection.prototype.processPacket = function(packet, info) {
  var port = info.port;
  var addr = info.address;
  var peerid = port;
  var that = this;
  if (!(port in this.peers)) {
    // TODO: multiple addresses
    var peer = this.peers[peerid] = {
        port: port,
        addr: addr,
        lastId: packet.id,
        lastOutId: ~~(Math.random() * 65535),
        timeout: new Timer(),
        id: peerid
      }
      // Timeouts
    peer.timeout.start(60 * 5 * 1000); // 5 mins
    peer.timeout.on('expire', function() {
      that.clear(peer);
    })

    // Events:
    this.emit('new', peer);
    if (Object.keys(packet.data).length !== 0) {
      this.emit('data', packet.data, peer);
    }
    if (packet.type & packet.flags.CLEAR) {
      this.sendNonData(packet.id, packet.flags.ACK, peer);
    } else {
      this.sendNonData(packet.id, packet.flags.ACK | packet.flags.CLEAR, peer);
    }

    // Acks:
  } else {
    var peer = this.peers[peerid];
    // Paquete clear
    if (packet.type & packet.flags.CLEAR) {
      this.clear(peer);
      if (Object.keys(packet.data).length !== 0) {
        this.processPacket(packet, info);
        return;
      }
    }
    // Paquete PING
    if (packet.type & packet.flags.PING) {
      if (peer.lastId > packet.id) {
        console.log("Paquete ping viejo");
        this.emit('discard', packet, peer);
      } else if (peer.lastId == packet.id) {
        this.ack(packet, peer);
      } else {
        // TODO: check if lastId is the maximum id of a 32 bit unsigned integer and send clear.
        peer.lastId = packet.id;
        peer.timeout.restart();
        this.ack(packet, peer);
        this.emit('ping', peer);
      }
    }
    // Paquete ack
    if (packet.type & packet.flags.ACK) {
      console.log("ACK con id " + packet.id + " y se esperaba " + peer.lastOutId);
      if (packet.id == peer.lastOutId) {
        console.log("Desencolando por ack");
        this.removeFromQueue(packet.id);
        if (this.outgoingQueue.length >= 1) {
          this.sendNext();
        }
        console.log("En la cola: " + this.outgoingQueue.length + " elementos");
      }
    }

    // Paquete con datos
    if (Object.keys(packet.data).length !== 0) {
      if (peer.lastId > packet.id) {
        console.log("Paquete de datos viejo " + peer.lastId + " > " + packet.id);
        this.emit('discard', packet, peer);
      } else if (peer.lastId == packet.id) {
        this.ack(packet, peer);
      } else {
        // TODO: check if lastId is the maximum id of a 32 bit unsigned integer and send clear.
        peer.lastId = packet.id;
        peer.timeout.restart();
        this.ack(packet, peer);
        this.emit('data', packet.data, peer);
      }
    }
  }
}

uuConnection.prototype.removeFromQueue = function(packetId) {
  for (var i = 0; i < this.outgoingQueue.length; i++) {
    if (this.outgoingQueue[i][1].id == packetId) {
      this.outgoingQueue.splice(i,1);
      i--;
    }
  }
}

uuConnection.prototype.ack = function(packet, peer) {
  var that = this;
  that.sendNonData(packet.id, packet.flags.ACK, peer);
}

uuConnection.prototype.sendNonData = function(id, type, peer) {
  var pckt = new uuPacket();
  var that = this;
  pckt.id = id;
  pckt.type = type;
  if (!(pckt.type & pckt.flags.ACK)) {
    peer.timerAck.start(2000);
  }
  this.socket.send(pckt.toBuffer(), 0, 5, peer.port, peer.addr, function(error) {
    if (error)
      that.clear(peer);
  });
}

uuConnection.prototype.sendData = function(data, peer) {
  var packet = new uuPacket();
  var that = this;
  packet.id = ++peer.lastOutId;
  packet.type = packet.flags.DATA;
  packet.data = data;
  if (!(packet.type & packet.flags.ACK)) {
    peer.timerAck.start(peer.ackTime);
  }
  var buff = packet.toBuffer();
  this.socket.send(buff, 0, buff.length, peer.port, peer.addr, function(error) {
    if (error)
      that.clear(peer);
  });
}

uuConnection.prototype.sendNext = function() {
  if (this.outgoingQueue.length >= 1) {
    var arr = this.outgoingQueue.shift();
    var peerid = arr[0],
      packet = arr[1];
    packet._retries += 1;
    var peer = this.peers[peerid];
    if (peer) {
      var buff = packet.toBuffer();

      if (peer.lastOutId > packet.id || packet._retries > 3) {
        console.log("Discarding outoing packet");
        return this.sendNext();
      }

      this.outgoingQueue.push(arr);

      peer.lastOutId = packet.id;
      this.socket.send(buff, 0, buff.length, peer.port, peer.addr, function(error) {
        if (error)
          this.clear(peer);
      });
      this.ackTimer.start(1000 + Math.random() * 1000);
    }
    console.log("Waiting ACK");
  }
}

uuConnection.prototype.enqueueData = function(data, peer) {
  console.log("Encolando " + UL.stringify(data) + " para " + peer.id);

  var packet = new uuPacket();
  packet.type = packet.flags.DATA;
  packet.data = data;
  packet.id = ++peer.lastOutId;

  this.outgoingQueue.push([peer.id, packet]);
  console.log("La cola tiene " + this.outgoingQueue.length + " elementos.");

  if (this.outgoingQueue.length == 1) {
    this.sendNext();
  }
}

uuConnection.prototype.clear = function(peer) {
  peer.timeout.stop();
  delete this.peers[peer.id];
  this.emit('clear', peer);
}

uuConnection.prototype.listen = function(port) {
  var that = this;
  this.socket.bind(port);
  this.socket.on('message', function(msg, info) {
    try {
      var packet = that.parseDatagram(msg);
      that.processPacket(packet, info);
    } catch (e) {
      that.emit('error', e);
    }
  })
  this.socket.on('error', function(err) {
    console.log(err);
  });
}

uuConnection.prototype.close = function() {
  this.socket.close();
}

function uuPacket() {
  this.id = 0;
  this.type = this.flags.DATA;
  this.data = {};

  this._retries = 0;
}

uuPacket.prototype.flags = {
  DATA: 0x0,
  ACK: 0x1,
  PING: 0x2,
  //PONG: 0x4,
  CLEAR: 0x8
}

uuPacket.prototype.toBuffer = function() {
  var result = new Buffer(5);
  result.writeUInt32LE(this.id);
  result.writeUInt8(this.type, 4);
  if (this.type == this.flags.DATA) {
    result = Buffer.concat([result, new Buffer(UL.stringify(this.data))]);
  }
  return result;
}

module.exports = {
  Connection: uuConnection,
  Packet: uuPacket
}
