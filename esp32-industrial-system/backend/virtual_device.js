const axios = require('axios');
const os = require('os');

// CONFIG: Point to your local server
const SERVER_URL = 'http://localhost:5000/api/telemetry';

// --- HELPER: Auto-Detect Laptop IP ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (localhost) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback
}

const REAL_IP = getLocalIP();
console.log(`🤖 Virtual ESP32 Started on ${REAL_IP}. Connecting to server...`);

// Initial State
let state = {
  pumpRunning: false,
  valve1Status: false, // Valve A
  valve2Status: false, // Valve B
  cycleRelayStatus: true, // Starts ON
  automaticMode: false,
  
  // Sensors
  flowRate1: 0, totalFlow1: 100,
  flowRate2: 0, totalFlow2: 50,
  tempC1: 23.5, // TTO
  tempC2: 21.0, // BTO
  
  // DS18B20 Array (Internal/Aux Temps)
  dsTemps: [20.5, 21.2, 22.0, 23.1, 24.5, 25.0] 
};

// Relay Timer Simulation
let relayTimer = 0;
const SIM_RELAY_ON_TIME = 10; // 10 ticks (30 sec approx) for testing
const SIM_RELAY_OFF_TIME = 20; // 20 ticks (1 min approx) for testing

setInterval(async () => {
  // ===============================================
  // 1. SIMULATE PHYSICS
  // ===============================================
  
  // Simulate Relay Cycle (Only in Auto Mode)
  if (state.automaticMode) {
    relayTimer++;
    if (state.cycleRelayStatus && relayTimer > SIM_RELAY_ON_TIME) {
      state.cycleRelayStatus = false; // Turn OFF
      relayTimer = 0;
      console.log("🔄 SIM: Cycle Relay turning OFF");
    } else if (!state.cycleRelayStatus && relayTimer > SIM_RELAY_OFF_TIME) {
      state.cycleRelayStatus = true; // Turn ON
      relayTimer = 0;
      console.log("🔄 SIM: Cycle Relay turning ON");
    }

    // In Auto, hardware follows Relay
    state.pumpRunning = state.cycleRelayStatus;
    state.valve1Status = state.cycleRelayStatus;
    state.valve2Status = state.cycleRelayStatus;
  }

  // Fluctuate Temperatures
  state.tempC1 += (Math.random() - 0.5) * 0.2;
  state.tempC2 += (Math.random() - 0.5) * 0.2;
  state.dsTemps = state.dsTemps.map(t => t + (Math.random() - 0.5) * 0.1);

  // Flow Logic
  if (state.pumpRunning && state.valve1Status) {
    state.flowRate1 = 10 + Math.random() * 5; 
    state.totalFlow1 += state.flowRate1 / 10;
  } else {
    state.flowRate1 = 0;
  }

  if (state.pumpRunning && state.valve2Status) {
    state.flowRate2 = 12 + Math.random() * 4; 
    state.totalFlow2 += state.flowRate2 / 10;
  } else {
    state.flowRate2 = 0;
  }

  // ===============================================
  // 2. PREPARE PAYLOAD
  // ===============================================
  const payload = {
    tempC1: parseFloat(state.tempC1.toFixed(1)),
    tempF1: parseFloat((state.tempC1 * 1.8 + 32).toFixed(1)),
    tempC2: parseFloat(state.tempC2.toFixed(1)),
    tempF2: parseFloat((state.tempC2 * 1.8 + 32).toFixed(1)),
    
    tempDS1: parseFloat(state.dsTemps[0].toFixed(1)),
    tempDS2: parseFloat(state.dsTemps[1].toFixed(1)),
    tempDS3: parseFloat(state.dsTemps[2].toFixed(1)),
    tempDS4: parseFloat(state.dsTemps[3].toFixed(1)),
    tempDS5: parseFloat(state.dsTemps[4].toFixed(1)),
    tempDS6: parseFloat(state.dsTemps[5].toFixed(1)),

    flowRate1: parseFloat(state.flowRate1.toFixed(1)),
    totalFlow1: parseFloat(state.totalFlow1.toFixed(1)),
    flowSensorConnected1: true,

    flowRate2: parseFloat(state.flowRate2.toFixed(1)),
    totalFlow2: parseFloat(state.totalFlow2.toFixed(1)),
    flowSensorConnected2: true,

    pumpRunning: state.pumpRunning,
    pumpSpeed: state.pumpRunning ? 100 : 0,
    valve1Status: state.valve1Status,
    valve2Status: state.valve2Status,
    cycleRelayStatus: state.cycleRelayStatus, 
    
    flowSensorResetCount: 0,
    esp32IP: REAL_IP + " (SIM)", // <--- Sends Real Laptop IP
    automaticMode: state.automaticMode,
    timestamp: Date.now()
  };

  try {
    const response = await axios.post(SERVER_URL, payload);
    const cmd = response.data.command;
    
    if (cmd && cmd !== "NONE") {
      console.log(`⚡ COMMAND: ${cmd}`);
      if (cmd === "PUMP_ON") { state.pumpRunning = true; }
      if (cmd === "PUMP_OFF") { state.pumpRunning = false; }
      if (cmd === "VALVE_A_ON") { state.valve1Status = true; }
      if (cmd === "VALVE_A_OFF") { state.valve1Status = false; }
      if (cmd === "VALVE_B_ON") { state.valve2Status = true; }
      if (cmd === "VALVE_B_OFF") { state.valve2Status = false; }
      if (cmd === "SET_MODE_AUTO") { 
          state.automaticMode = true; 
          state.cycleRelayStatus = true; 
          relayTimer = 0;
      }
      if (cmd === "SET_MODE_MANUAL") { 
          state.automaticMode = false;
          state.pumpRunning = false;
          state.valve1Status = false;
          state.valve2Status = false;
      }
      if (cmd === "RESET_FLOW_1") { state.totalFlow1 = 0; }
      if (cmd === "RESET_FLOW_2") { state.totalFlow2 = 0; }
    }

  } catch (error) {
    console.error("❌ Connection Error.");
  }

}, 3000);