const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const SystemData = require('./models/SystemData');
const { Parser } = require('json2csv');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/esp32_industrial_db')
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- GLOBAL VARIABLES ---
let desiredState = { command: "NONE", params: {} };

// 1. Live Memory Storage (For Instant Dashboard Status)
let realTimeStatus = {}; 

// 2. Timer for Database Saving (For Charts)
let lastChartSaveTime = 0;
const SAVE_INTERVAL = 5 * 60 * 1000; // 5 Minutes in milliseconds

// Load last known state from DB on startup
SystemData.findOne().sort({ timestamp: -1 }).then(doc => {
  if(doc) realTimeStatus = doc.toObject();
});

// ==========================================
// 1. TELEMETRY ENDPOINT
// ==========================================
app.post('/api/telemetry', async (req, res) => {
  try {
    const data = req.body;
    
    // Construct the Data Object
    const currentData = {
      timestamp: Date.now(),
      temperatures: {
        thermocouple1: data.tempC1,
        thermocouple2: data.tempC2,
        dsSensors: [data.tempDS1, data.tempDS2, data.tempDS3, data.tempDS4, data.tempDS5, data.tempDS6]
      },
      flow: {
        sensor1: { rate: data.flowRate1, total: data.totalFlow1, connected: data.flowSensorConnected1 },
        sensor2: { rate: data.flowRate2, total: data.totalFlow2, connected: data.flowSensorConnected2 }
      },
      actuators: {
        pump: { running: data.pumpRunning, speed: data.pumpSpeed },
        valveA: data.valve1Status,
        valveB: data.valve2Status,
        cycleRelay: data.cycleRelayStatus
      },
      system: {
        mode: (data.automaticMode) ? 'auto' : 'manual', 
        ipAddress: data.esp32IP
      }
    };

    // A. ALWAYS Update Live Status (So dashboard cards/controls are instant)
    realTimeStatus = currentData;

    // B. CONDITIONALLY Save to Database (So charts update every 5 mins)
    const now = Date.now();
    if (now - lastChartSaveTime >= SAVE_INTERVAL) {
        const newData = new SystemData(currentData);
        await newData.save();
        lastChartSaveTime = now;
        console.log(`💾 HISTORY SAVED: Flow1=${data.flowRate1} (Next save in 5 mins)`);
    } else {
        // Just log a heartbeat (don't save to DB)
        console.log(`⚡ LIVE UPDATE: Relay=${data.cycleRelayStatus} | Next DB Save: ${Math.round((SAVE_INTERVAL - (now - lastChartSaveTime))/1000)}s`);
    }

    // C. Send Back Commands (Piggyback)
    const responsePayload = {
      status: "success",
      command: desiredState.command,
      ...desiredState.params
    };

    if (desiredState.command !== "NONE") {
      console.log(`📤 Executing Command: ${desiredState.command}`);
      desiredState.command = "NONE";
      desiredState.params = {};
    }

    res.status(200).json(responsePayload);

  } catch (err) {
    console.error("Error processing data:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 2. API ENDPOINTS
// ==========================================

// Returns INSTANT data from RAM (Fast)
app.get('/api/status', (req, res) => {
  res.json(realTimeStatus || {});
});

// Returns HISTORY data from DB (5-minute intervals)
app.get('/api/history', async (req, res) => {
  try {
    const data = await SystemData.find()
                               .sort({ timestamp: -1 })
                               .limit(50) 
                               .lean();
    res.json(data.reverse());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- UPDATED EXPORT FUNCTION ---
app.get('/api/export', async (req, res) => {
  try {
    const allData = await SystemData.find().sort({ timestamp: -1 }).lean();
    
    // Define ALL fields here
    const fields = [
      { label: 'Time', value: row => new Date(row.timestamp).toLocaleString() },
      
      // Main Temperatures
      { label: 'TTO (Main)', value: row => row.temperatures?.thermocouple1 ?? 0 },
      { label: 'BTO (Main)', value: row => row.temperatures?.thermocouple2 ?? 0 },

      // Detailed DS18B20 Sensors
      { label: 'WISSBT', value: row => row.temperatures?.dsSensors?.[0] ?? 0 },
      { label: 'OSBT', value: row => row.temperatures?.dsSensors?.[1] ?? 0 },
      { label: 'WISSTT', value: row => row.temperatures?.dsSensors?.[2] ?? 0 },
      { label: 'GPT', value: row => row.temperatures?.dsSensors?.[3] ?? 0 },
      { label: 'GTT', value: row => row.temperatures?.dsSensors?.[4] ?? 0 },
      { label: 'OSTT', value: row => row.temperatures?.dsSensors?.[5] ?? 0 },

      // Flow 1
      { label: 'Flow Rate 1', value: row => row.flow?.sensor1?.rate ?? 0 },
      { label: 'Total Vol 1', value: row => row.flow?.sensor1?.total ?? 0 },

      // Flow 2
      { label: 'Flow Rate 2', value: row => row.flow?.sensor2?.rate ?? 0 },
      { label: 'Total Vol 2', value: row => row.flow?.sensor2?.total ?? 0 },

      // Actuators & Status
      { label: 'Pump Status', value: row => row.actuators?.pump?.running ? "ON" : "OFF" },
      { label: 'Cycle Relay', value: row => row.actuators?.cycleRelay ? "ON" : "OFF" },
      { label: 'Valve A', value: row => row.actuators?.valveA ? "OPEN" : "CLOSED" },
      { label: 'Valve B', value: row => row.actuators?.valveB ? "OPEN" : "CLOSED" },
      
      // Controller Info
      { label: 'Mode', value: row => row.system?.mode ?? "manual" },
      { label: 'Controller IP', value: row => row.system?.ipAddress ?? "Unknown" }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(allData);

    res.header('Content-Type', 'text/csv');
    res.attachment('system_data_export.csv');
    res.send(csv);

  } catch (err) {
    res.status(500).json({ message: "Export failed: " + err.message });
  }
});

app.post('/api/control', (req, res) => {
  const { action } = req.body;
  desiredState.command = action;
  res.json({ status: "queued" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});