// Prelude
var udpul = require('../lib/udpul');
var Connection = udpul.Connection;
var mqtt = require('mqtt');
var UL = require('../lib/ultralight');

// MQTT route:
function MQTT(callback) {
  // TODO: configuracion
  this.connection = mqtt.connect('mqtt://155.54.171.221');
  this.connection.on('message', callback);
}

MQTT.prototype.close = function() {
  this.connection.end();
}

var mqttPeers = {

}

// Connection:
var con = new Connection();
con.listen(1448);

con.on('error', function(err) {
  console.log('Bad packet: ')
  console.log(err);
})

con.on('new', function(peer) {
  console.log("New peer at " + peer.port);
  mqttPeers[peer.id] = new MQTT(function(topic, message) {
    con.enqueueData({
      't': topic,
      'm': message.toString().replace(/\|/g, ',')
    }, peer)
  });
})

con.on('clear', function(peer) {
  mqttPeers[peer.id].close();
})

con.on('discard', function(packet, peer) {
  console.log("Discard packet at " + peer.port);
})

con.on('data', function(data, peer) {
  console.log("New data at " + peer.port);
  console.log(data);
  var peer = mqttPeers[peer.id];
  if (data['o']) {
    var op = data['o'];
    if (op == 's') {
      if (!('t' in data)) {
        console.log('Bad packet: subscribe without topic "t"')
      } else {
        console.log("Subscribe: ", data['t']);
        peer.connection.subscribe(data['t']);
      }
    } else if (op == 'p') {
      if (!('t' in data && 'm' in data)) {
        console.log('Bad packet: publish with no topic "t" or message "m"');
      } else {
        console.log("Publish: ", data['t'], data['m']);
        peer.connection.publish(data['t'], data['m'].replace(/,/g, '|'));
      }
    } else {
      console.log('Bad packet: unkown operation ' + data['o']);
    }
  } else {
    console.log('Bad packet: data with no operation "o"');
  }
})
