const mongoose = require('mongoose');

const SystemDataSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  temperatures: {
    thermocouple1: Number, // TTO
    thermocouple2: Number, // BTO
    dsSensors: [Number]    // Array for the 6 DS18B20s
  },
  flow: {
    sensor1: {
      rate: Number,
      total: Number,
      connected: Boolean
    },
    sensor2: {
      rate: Number,
      total: Number,
      connected: Boolean
    }
  },
  actuators: {
    pump: {
      running: Boolean,
      speed: Number
    },
    valveA: Boolean,
    valveB: Boolean,
    cycleRelay: Boolean // <--- NEW FIELD: Stores the Cycle Relay State
  },
  system: {
    mode: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    wifiSignal: Number,
    ipAddress: String
  }
});

module.exports = mongoose.model('SystemData', SystemDataSchema);