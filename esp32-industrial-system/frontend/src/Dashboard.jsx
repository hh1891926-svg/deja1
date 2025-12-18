import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Activity, Droplets, Thermometer, Power, Settings, RefreshCw, Wifi, Download, Database, Server, Zap, Clock } from 'lucide-react';

// CONFIG: API URL
// const API_URL = 'https://api.sakr-project.xyz/api'; // Cloudflare
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'; // Local

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  // 1. Live Status Loop (Fast)
  useEffect(() => {
    isMounted.current = true;
    const fetchStatus = async () => {
      try {
        const res = await axios.get(`${API_URL}/status`);
        if (isMounted.current) { setData(res.data); setLoading(false); }
      } catch (err) {}
      if (isMounted.current) setTimeout(fetchStatus, 2000);
    };
    fetchStatus();
    return () => { isMounted.current = false; };
  }, []);

  // 2. History Loop (Slower)
  useEffect(() => {
    let active = true;
    const fetchHistory = async () => {
      try {
        const res = await axios.get(`${API_URL}/history`);
        if (active) {
          const formatted = res.data.map(d => ({
            time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            // Map Temperatures
            TTO: d.temperatures?.thermocouple1 || 0,
            BTO: d.temperatures?.thermocouple2 || 0,
            WISSBT: d.temperatures?.dsSensors?.[0] || 0,
            OSBT: d.temperatures?.dsSensors?.[1] || 0,
            WISSTT: d.temperatures?.dsSensors?.[2] || 0,
            GPT: d.temperatures?.dsSensors?.[3] || 0,
            GTT: d.temperatures?.dsSensors?.[4] || 0,
            OSTT: d.temperatures?.dsSensors?.[5] || 0,
            // Map Flow
            Flow1: d.flow?.sensor1?.rate || 0,
            Flow2: d.flow?.sensor2?.rate || 0,
            // Map Power/Status
            PumpPwr: d.actuators?.pump?.speed || 0,
            RelayState: d.actuators?.cycleRelay ? 100 : 0
          }));
          setHistory(formatted);
        }
      } catch (err) {}
      if (active) setTimeout(fetchHistory, 30000);
    };
    fetchHistory();
    return () => { active = false; };
  }, []);

  const sendCommand = async (action) => {
    try { await axios.post(`${API_URL}/control`, { action }); } catch (err) {}
  };

  const handleExport = () => {
    window.open(`${API_URL}/export`, '_blank');
  };

  if (loading || !data) return <div className="p-10 text-center animate-pulse">Loading System Data...</div>;

  const getDS = (idx) => data.temperatures?.dsSensors?.[idx] ?? 0;
  const isAuto = data.system?.mode === 'auto';
  const pumpSpeed = data.actuators?.pump?.speed || 0;
  const relayOn = data.actuators?.cycleRelay ?? false;

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gray-100 font-sans">
      
      {/* --- HEADER --- */}
      <header className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Database className="text-blue-600" /> Industrial Control System
          </h1>
          <p className="text-sm text-gray-500">Facility ID: ESP32-FLOW-01</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition">
            <Download size={18} /> Export History
          </button>
        </div>
      </header>

      {/* --- ROW 1: SYSTEM STATUS CARDS --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        
        {/* Controller Status */}
        <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-indigo-500">
           <div className="flex justify-between items-start mb-2">
              <h3 className="text-gray-500 font-bold text-xs uppercase">Controller Status</h3>
              <Server size={20} className="text-indigo-500"/>
           </div>
           <div className="space-y-1">
              <div className="flex justify-between items-center">
                 <span className="text-sm text-gray-600">Connectivity:</span>
                 <span className="flex items-center gap-1 text-green-600 font-bold text-sm"><Wifi size={14}/> ONLINE</span>
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-sm text-gray-600">IP Address:</span>
                 <span className="font-mono text-sm bg-gray-100 px-2 rounded">{data.system?.ipAddress}</span>
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-sm text-gray-600">Current Mode:</span>
                 <span className={`text-xs font-bold px-2 py-0.5 rounded ${isAuto ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                    {isAuto ? "AUTOMATIC" : "MANUAL"}
                 </span>
              </div>
           </div>
        </div>

        {/* Pump System Power */}
        <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
           <div className="flex justify-between items-start mb-2">
              <h3 className="text-gray-500 font-bold text-xs uppercase">Pump Power</h3>
              <Zap size={20} className={pumpSpeed > 0 ? "text-green-500 fill-green-500" : "text-gray-300"}/>
           </div>
           <div className="flex flex-col gap-2">
              <div className="flex justify-between items-end">
                 <span className="text-3xl font-bold text-gray-800">{pumpSpeed}%</span>
                 <span className="text-xs text-gray-400 font-bold uppercase mb-1">{data.actuators?.pump?.running ? "RUNNING" : "STOPPED"}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                 <div className="bg-green-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${pumpSpeed}%` }}></div>
              </div>
           </div>
        </div>

        {/* Actuators & Relay */}
        <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-blue-500">
           <div className="flex justify-between items-start mb-2">
              <h3 className="text-gray-500 font-bold text-xs uppercase">Actuators</h3>
              <Settings size={20} className="text-blue-500"/>
           </div>
           <div className="space-y-3">
              <div className="flex justify-between items-center border-b pb-2">
                 <div className="flex items-center gap-2">
                    <Clock size={16} className="text-purple-600" />
                    <span className="text-sm font-bold text-gray-700">Cycle Relay</span>
                 </div>
                 <span className={`text-xs px-2 py-1 rounded font-bold ${relayOn ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                    {relayOn ? "ACTIVE (ON)" : "WAITING (OFF)"}
                 </span>
              </div>
              <div className="flex justify-between gap-2">
                 <span className={`text-xs px-2 py-1 rounded w-full text-center ${data.actuators?.valveA ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
                    Valve A: {data.actuators?.valveA ? "OPEN" : "CLSD"}
                 </span>
                 <span className={`text-xs px-2 py-1 rounded w-full text-center ${data.actuators?.valveB ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
                    Valve B: {data.actuators?.valveB ? "OPEN" : "CLSD"}
                 </span>
              </div>
           </div>
        </div>
      </div>

      {/* --- ROW 2: NUMERIC SENSOR CARDS (RESTORED) --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        
        {/* Thermocouples */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-2 border-red-500">
          <h3 className="text-gray-500 font-bold text-xs uppercase mb-2 flex items-center gap-1"><Thermometer size={14}/> Main Temps</h3>
          <div className="flex justify-between items-end mb-2 border-b pb-2">
            <span className="text-gray-600 font-bold text-sm">TTO</span>
            <span className="text-xl font-bold">{data.temperatures?.thermocouple1}°C</span>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-gray-600 font-bold text-sm">BTO</span>
            <span className="text-xl font-bold">{data.temperatures?.thermocouple2}°C</span>
          </div>
        </div>

        {/* DS Sensors Group 1 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-2 border-orange-400">
          <h3 className="text-gray-500 font-bold text-xs uppercase mb-2">Internal Temps</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div className="flex justify-between pr-2 border-r"><span>WISSBT:</span> <b>{getDS(0)}°</b></div>
            <div className="flex justify-between pl-2"><span>OSBT:</span> <b>{getDS(1)}°</b></div>
            <div className="flex justify-between pr-2 border-r border-t pt-2"><span>WISSTT:</span> <b>{getDS(2)}°</b></div>
            <div className="flex justify-between pl-2 border-t pt-2"><span>GPT:</span> <b>{getDS(3)}°</b></div>
          </div>
        </div>

        {/* DS Sensors Group 2 */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-2 border-orange-400">
          <h3 className="text-gray-500 font-bold text-xs uppercase mb-2">Aux Temps</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div className="flex justify-between pr-2 border-r"><span>GTT:</span> <b>{getDS(4)}°</b></div>
            <div className="flex justify-between pl-2"><span>OSTT:</span> <b>{getDS(5)}°</b></div>
          </div>
          <div className="mt-3 text-xs text-center text-green-600 bg-green-50 py-1 rounded">All Sensors Active</div>
        </div>

        {/* Flow Meters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border-t-2 border-cyan-500">
          <h3 className="text-gray-500 font-bold text-xs uppercase mb-2 flex items-center gap-1"><Activity size={14}/> Flow Rates</h3>
          <div className="flex justify-between items-center mb-2">
             <span className="text-sm font-bold text-gray-600">Flow 1</span>
             <span className="text-lg font-bold text-cyan-600">{data.flow?.sensor1?.rate} <span className="text-xs text-gray-400">mL/s</span></span>
          </div>
          <div className="flex justify-between items-center">
             <span className="text-sm font-bold text-gray-600">Flow 2</span>
             <span className="text-lg font-bold text-cyan-600">{data.flow?.sensor2?.rate} <span className="text-xs text-gray-400">mL/s</span></span>
          </div>
        </div>
      </div>

      {/* --- ROW 3: CHARTS --- */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        
        {/* CHART 1: MAIN TEMPERATURES (Thermocouples) */}
        <div className="bg-white p-4 rounded-xl shadow-sm">
          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Thermometer className="text-red-500"/> Main Temperatures (TTO & BTO)</h3>
          <div className="h-64 w-full"> 
            <ResponsiveContainer>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" />
                <YAxis domain={['auto', 'auto']} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="TTO" stroke="#ef4444" strokeWidth={3} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="BTO" stroke="#f97316" strokeWidth={3} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: DETAILED TEMPERATURES (All 6 DS Sensors) */}
        <div className="bg-white p-4 rounded-xl shadow-sm">
          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Activity className="text-orange-500"/> Internal & Aux Temperatures</h3>
          <div className="h-80 w-full"> 
            <ResponsiveContainer>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" />
                <YAxis domain={['auto', 'auto']} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="WISSBT" stroke="#8884d8" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="OSBT" stroke="#ffc658" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="WISSTT" stroke="#82ca9d" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="GPT" stroke="#ff7300" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="GTT" stroke="#0088fe" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="OSTT" stroke="#00c49f" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 3: SYSTEM ACTIVITY */}
        <div className="bg-white p-4 rounded-xl shadow-sm">
          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2"><Droplets className="text-blue-500"/> Flow & System Activity</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={history}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="Flow1" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} isAnimationActive={false} />
                <Area type="monotone" dataKey="Flow2" stackId="1" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.3} isAnimationActive={false} />
                <Line type="step" dataKey="PumpPwr" stroke="#10b981" strokeWidth={2} dot={false} name="Pump %" isAnimationActive={false} />
                <Line type="step" dataKey="RelayState" stroke="#9333ea" strokeWidth={2} dot={false} name="Relay" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* --- ROW 4: CONTROL PANEL --- */}
      <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
         <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
            <Settings className="text-gray-600" /> Operator Control Panel
         </h3>
         
         <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b">
            <div className="w-full md:w-1/3">
               <label className="text-sm font-bold text-gray-500 uppercase mb-2 block">System Mode</label>
               <div className="flex gap-2">
                  <button onClick={() => sendCommand('SET_MODE_AUTO')} 
                     className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2 ${isAuto ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                     <RefreshCw size={18}/> AUTO
                  </button>
                  <button onClick={() => sendCommand('SET_MODE_MANUAL')} 
                     className={`flex-1 py-3 rounded-lg font-bold flex items-center justify-center gap-2 ${!isAuto ? 'bg-orange-500 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                     <Power size={18}/> MANUAL
                  </button>
               </div>
            </div>
            
            <div className={`w-full md:w-1/3 transition-opacity ${isAuto ? 'opacity-50 pointer-events-none' : ''}`}>
               <label className="text-sm font-bold text-gray-500 uppercase mb-2 block">Pump Control</label>
               <div className="flex gap-2">
                  <button onClick={() => sendCommand('PUMP_ON')} className="flex-1 py-3 bg-green-100 text-green-700 font-bold rounded-lg hover:bg-green-200 border border-green-200">START</button>
                  <button onClick={() => sendCommand('PUMP_OFF')} className="flex-1 py-3 bg-red-100 text-red-700 font-bold rounded-lg hover:bg-red-200 border border-red-200">STOP</button>
               </div>
            </div>

            <div className={`w-full md:w-1/3 transition-opacity ${isAuto ? 'opacity-50 pointer-events-none' : ''}`}>
               <label className="text-sm font-bold text-gray-500 uppercase mb-2 block">Valve Control</label>
               <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                     <span className="text-xs font-bold text-center text-gray-400">VALVE A</span>
                     <div className="flex gap-1">
                        <button onClick={() => sendCommand('VALVE_A_ON')} className="flex-1 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded hover:bg-blue-100 border">OPEN</button>
                        <button onClick={() => sendCommand('VALVE_A_OFF')} className="flex-1 py-2 bg-gray-50 text-gray-600 text-xs font-bold rounded hover:bg-gray-100 border">CLS</button>
                     </div>
                  </div>
                  <div className="flex flex-col gap-1">
                     <span className="text-xs font-bold text-center text-gray-400">VALVE B</span>
                     <div className="flex gap-1">
                        <button onClick={() => sendCommand('VALVE_B_ON')} className="flex-1 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded hover:bg-blue-100 border">OPEN</button>
                        <button onClick={() => sendCommand('VALVE_B_OFF')} className="flex-1 py-2 bg-gray-50 text-gray-600 text-xs font-bold rounded hover:bg-gray-100 border">CLS</button>
                     </div>
                  </div>
               </div>
            </div>
         </div>

         <div className="flex justify-end gap-4">
            <button onClick={() => sendCommand('RESET_FLOW_1')} className="text-xs text-gray-500 hover:text-red-500 font-bold underline">RESET FLOW 1</button>
            <button onClick={() => sendCommand('RESET_FLOW_2')} className="text-xs text-gray-500 hover:text-red-500 font-bold underline">RESET FLOW 2</button>
         </div>
      </div>

    </div>
  );
}