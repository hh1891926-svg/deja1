#include <WiFi.h>
#include <HTTPClient.h>
#include "MAX6675.h"
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>

// --- Relay Settings (Cycle Relay) ---
#define RELAY_CYCLE_PIN 32        
unsigned long relayOnTime = 30UL * 60UL * 1000UL;   // 30 minutes ON
unsigned long relayOffTime = (4UL * 60UL * 60UL * 1000UL) - relayOnTime; // 3.5 hours OFF
unsigned long lastRelaySwitch = 0; 
bool relayCycleState = false;      // CHANGED: Start OFF (Manual Mode)
// ----------------------------------------

int thermoCLK = 18;
int thermoDO = 19;
int thermoCS_1 = 5;
int thermoCS_2 = 17;

MAX6675 thermocouple1(thermoCLK, thermoCS_1, thermoDO);
MAX6675 thermocouple2(thermoCLK, thermoCS_2, thermoDO);

#define ONE_WIRE_BUS 21
#define NUM_DS18B20 6
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);

#define FLOW_SENSOR_PIN_1 4
#define FLOW_SENSOR_PIN_2 25

struct FlowSensorData {
  int pin;
  volatile unsigned long pulseCount;
  unsigned long lastInterruptTime;
  float calibrationFactor;
  bool calibrationMode;
  unsigned long calibrationStartTime;
  unsigned long calibrationPulses;
  float calibrationVolume;
  unsigned long oldTime;
  float flowRate;
  float totalFlow;
  unsigned long totalPulses;
  unsigned long lastPulseTime;
  bool flowSensorConnected;
};

FlowSensorData flowSensors[2];
uint8_t systemResetCount = 0;
const unsigned long measurementInterval = 1000;

#define PUMP_PIN 26
#define VALVE_A_PIN 27
#define VALVE_B_PIN 14

bool pumpManualState = false;
bool valveAManualState = false;
bool valveBManualState = false;
bool automaticMode = false; // Starts in Manual Mode
unsigned long lastCycleStart = 0;

struct SensorData {
  float tempC1;
  float tempF1;
  float tempC2;
  float tempF2;
  float tempDS[NUM_DS18B20];
  float flowRate1;
  float totalFlow1;
  bool flowSensorConnected1;
  float flowRate2;
  float totalFlow2;
  bool flowSensorConnected2;
};

SensorData sensorData;

const char *wifi_ssid = "PLC_PROJECT";
const char *wifi_password = "K9348280";
const char *serverUrl = "https://api.dejaa.site/api/telemetry";
const unsigned long dataSendInterval = 3 * 1000UL;
unsigned long lastDataSendTime = 0;

portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
WiFiServer server(80);

void IRAM_ATTR flowPulseCounter1() {
  if (micros() - flowSensors[0].lastInterruptTime > 500) {
    portENTER_CRITICAL_ISR(&mux);
    flowSensors[0].pulseCount++;
    portEXIT_CRITICAL_ISR(&mux);
    flowSensors[0].lastInterruptTime = micros();
    flowSensors[0].lastPulseTime = millis();
  }
}

void IRAM_ATTR flowPulseCounter2() {
  if (micros() - flowSensors[1].lastInterruptTime > 500) {
    portENTER_CRITICAL_ISR(&mux);
    flowSensors[1].pulseCount++;
    portEXIT_CRITICAL_ISR(&mux);
    flowSensors[1].lastInterruptTime = micros();
    flowSensors[1].lastPulseTime = millis();
  }
}

void setupWiFi() {
  WiFi.disconnect();
  delay(500);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifi_ssid, wifi_password);
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 10) {
    delay(500);
    attempt++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    server.begin();
    ArduinoOTA.setHostname("ESP32-Flow");
    ArduinoOTA.begin();
    Serial.println("WiFi connected. IP: " + WiFi.localIP().toString());
  }
}

// Logic to toggle Pin 32 (Cycle Relay) automatically
void handleRelayCycle() {
  unsigned long currentMillis = millis();
  if (relayCycleState) {
    // It is currently ON (Phase 1). Check if 30 mins passed.
    if (currentMillis - lastRelaySwitch >= relayOnTime) {
      relayCycleState = false;
      digitalWrite(RELAY_CYCLE_PIN, LOW); // Turn OFF
      lastRelaySwitch = currentMillis;
    }
  } else {
    // It is currently OFF (Phase 2). Check if 3.5 hours passed.
    if (currentMillis - lastRelaySwitch >= relayOffTime) {
      relayCycleState = true;
      digitalWrite(RELAY_CYCLE_PIN, HIGH); // Turn ON
      lastRelaySwitch = currentMillis;
    }
  }
}

void sendDataToServer(); 
void handleCommands();
void handleWebClient(WiFiClient &client);

void setup() {
  Serial.begin(115200);
  delay(500);
  
  ds18b20.begin();
  
  for (int i = 0; i < 2; i++) {
    flowSensors[i].pulseCount = 0;
    flowSensors[i].lastInterruptTime = 0;
    flowSensors[i].calibrationMode = false;
    flowSensors[i].calibrationPulses = 0;
    flowSensors[i].calibrationVolume = 0;
    flowSensors[i].oldTime = millis();
    flowSensors[i].flowRate = 0;
    flowSensors[i].totalFlow = 0;
    flowSensors[i].totalPulses = 0;
    flowSensors[i].lastPulseTime = millis();
    flowSensors[i].flowSensorConnected = true;
  }

  flowSensors[0].pin = FLOW_SENSOR_PIN_1;
  flowSensors[1].pin = FLOW_SENSOR_PIN_2;
  
  pinMode(flowSensors[0].pin, INPUT_PULLUP);
  pinMode(flowSensors[1].pin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(flowSensors[0].pin), flowPulseCounter1, FALLING);
  attachInterrupt(digitalPinToInterrupt(flowSensors[1].pin), flowPulseCounter2, FALLING);

  flowSensors[0].calibrationFactor = 5.0;
  flowSensors[1].calibrationFactor = 5.0;

  pinMode(PUMP_PIN, OUTPUT);
  pinMode(VALVE_A_PIN, OUTPUT);
  pinMode(VALVE_B_PIN, OUTPUT);
  
  // CHANGED: Initialize Relay to OFF (Manual Start)
  pinMode(RELAY_CYCLE_PIN, OUTPUT);
  digitalWrite(RELAY_CYCLE_PIN, LOW); 
  relayCycleState = false;
  // ----------------------------------------------

  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(VALVE_A_PIN, LOW);
  digitalWrite(VALVE_B_PIN, LOW);

  int wifiCount = 0;
  while (wifiCount < 3) {
    setupWiFi();
    if (WiFi.status() == WL_CONNECTED) break;
    wifiCount++;
    delay(2000);
  }

  sendDataToServer();
}

void calculateFlowData(int sensorIndex) {
  unsigned long currentMillis = millis();
  if (currentMillis - flowSensors[sensorIndex].oldTime >= measurementInterval) {
    portENTER_CRITICAL(&mux);
    unsigned long pulses = flowSensors[sensorIndex].pulseCount;
    flowSensors[sensorIndex].pulseCount = 0;
    portEXIT_CRITICAL(&mux);

    if (pulses > 0) {
        flowSensors[sensorIndex].flowSensorConnected = true;
        flowSensors[sensorIndex].lastPulseTime = currentMillis;
    } else if (currentMillis - flowSensors[sensorIndex].lastPulseTime > (measurementInterval * 2)) {
        flowSensors[sensorIndex].flowSensorConnected = false;
    }

    float instantFlow = (pulses / flowSensors[sensorIndex].calibrationFactor) / (measurementInterval / 1000.0);
    flowSensors[sensorIndex].flowRate = (flowSensors[sensorIndex].flowRate * 0.7) + (instantFlow * 0.3);
    
    if (flowSensors[sensorIndex].flowRate < 0.1) flowSensors[sensorIndex].flowRate = 0.0;

    flowSensors[sensorIndex].totalPulses += pulses;
    flowSensors[sensorIndex].totalFlow = flowSensors[sensorIndex].totalPulses / flowSensors[sensorIndex].calibrationFactor;

    if (flowSensors[sensorIndex].calibrationMode) {
      flowSensors[sensorIndex].calibrationPulses += pulses;
    }
    flowSensors[sensorIndex].oldTime = currentMillis;
  }
}

void readSensors() {
  float temp1 = thermocouple1.getCelsius();
  sensorData.tempC1 = isnan(temp1) ? 0 : temp1;
  float temp1F = thermocouple1.getFahrenheit();
  sensorData.tempF1 = isnan(temp1F) ? 32 : temp1F;

  float temp2 = thermocouple2.getCelsius();
  sensorData.tempC2 = isnan(temp2) ? 0 : temp2;
  float temp2F = thermocouple2.getFahrenheit();
  sensorData.tempF2 = isnan(temp2F) ? 32 : temp2F;

  ds18b20.requestTemperatures();
  delay(200);
  for (int i = 0; i < NUM_DS18B20; i++) {
    float dsTemp = ds18b20.getTempCByIndex(i);
    sensorData.tempDS[i] = (dsTemp == -127.0 || dsTemp == 85.0 || isnan(dsTemp)) ? 0 : dsTemp;
  }

  sensorData.flowRate1 = flowSensors[0].flowRate;
  sensorData.totalFlow1 = flowSensors[0].totalFlow;
  sensorData.flowSensorConnected1 = flowSensors[0].flowSensorConnected;

  sensorData.flowRate2 = flowSensors[1].flowRate;
  sensorData.totalFlow2 = flowSensors[1].totalFlow;
  sensorData.flowSensorConnected2 = flowSensors[1].flowSensorConnected;
}

void sendDataToServer() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  readSensors();

  DynamicJsonDocument jsonDoc(2048);
  jsonDoc["tempC1"] = sensorData.tempC1;
  jsonDoc["tempF1"] = sensorData.tempF1;
  jsonDoc["tempC2"] = sensorData.tempC2;
  jsonDoc["tempF2"] = sensorData.tempF2;
  
  for (int i = 0; i < NUM_DS18B20; i++) {
    jsonDoc["tempDS" + String(i + 1)] = sensorData.tempDS[i];
  }

  jsonDoc["flowRate1"] = sensorData.flowRate1;
  jsonDoc["totalFlow1"] = flowSensors[0].totalFlow;
  jsonDoc["flowSensorConnected1"] = flowSensors[0].flowSensorConnected;
  jsonDoc["flowRate2"] = flowSensors[1].flowRate;
  jsonDoc["totalFlow2"] = flowSensors[1].totalFlow;
  jsonDoc["flowSensorConnected2"] = flowSensors[1].flowSensorConnected;
  
  jsonDoc["flowSensorResetCount"] = systemResetCount;
  jsonDoc["valve1Status"] = digitalRead(VALVE_A_PIN);
  jsonDoc["valve2Status"] = digitalRead(VALVE_B_PIN);
  
  jsonDoc["pumpRunning"] = digitalRead(PUMP_PIN);
  jsonDoc["pumpSpeed"] = digitalRead(PUMP_PIN) ? 100 : 0;
  
  jsonDoc["cycleRelayStatus"] = relayCycleState;
  
  jsonDoc["esp32IP"] = WiFi.localIP().toString();
  jsonDoc["timestamp"] = millis();

  String jsonString;
  serializeJson(jsonDoc, jsonString);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  int httpResponseCode = http.POST(jsonString);
  http.end();
}

void loop() {
  if (Serial.available()) handleCommands();
  
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
  }

  // CHANGED: Only run the Relay Cycle Logic if Automatic Mode is ON
  if (automaticMode) {
    handleRelayCycle();
    
    // Sync Pump & Valves to Relay State
    digitalWrite(PUMP_PIN, relayCycleState ? HIGH : LOW);
    digitalWrite(VALVE_A_PIN, relayCycleState ? HIGH : LOW);
    digitalWrite(VALVE_B_PIN, relayCycleState ? HIGH : LOW);
  } 
  else {
    // Manual Mode: Pins obey the manual boolean states
    digitalWrite(PUMP_PIN, pumpManualState ? HIGH : LOW);
    digitalWrite(VALVE_A_PIN, valveAManualState ? HIGH : LOW);
    digitalWrite(VALVE_B_PIN, valveBManualState ? HIGH : LOW);
    
    // IMPORTANT: In Manual Mode, we ensure Pin 32 is OFF (unless you had a manual button for it, which we don't)
    digitalWrite(RELAY_CYCLE_PIN, LOW); 
  }
  
  calculateFlowData(0);
  calculateFlowData(1);
  
  unsigned long currentMillis = millis();
  if (currentMillis - lastDataSendTime >= dataSendInterval || WiFi.status() != WL_CONNECTED) {
    if (WiFi.status() != WL_CONNECTED) setupWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      sendDataToServer();
      lastDataSendTime = currentMillis;
    }
  }

  WiFiClient client = server.available();
  if (client) handleWebClient(client);
  delay(10);
}

void handleCommands() {
  String command = Serial.readStringUntil('\n');
  command.trim();

  if (command == "pump on") {
    pumpManualState = true;
    automaticMode = false; 
  } 
  else if (command == "pump off") {
    pumpManualState = false;
    automaticMode = false;
  }
  else if (command == "valveA on") {
    valveAManualState = true;
    automaticMode = false;
  }
  else if (command == "valveA off") {
    valveAManualState = false;
    automaticMode = false;
  }
  else if (command == "valveB on") {
    valveBManualState = true;
    automaticMode = false;
  }
  else if (command == "valveB off") {
    valveBManualState = false;
    automaticMode = false;
  }
  else if (command == "auto on") {
    // CHANGED: Force START the cycle immediately
    automaticMode = true;
    relayCycleState = true; 
    lastRelaySwitch = millis();
    digitalWrite(RELAY_CYCLE_PIN, HIGH); 
  }
  else if (command == "auto off") {
    // CHANGED: Force STOP the cycle immediately
    automaticMode = false;
    relayCycleState = false;
    digitalWrite(RELAY_CYCLE_PIN, LOW);
  }
  else if (command == "cal1 start") {
    flowSensors[0].calibrationMode = true;
    flowSensors[0].calibrationPulses = 0;
    flowSensors[0].calibrationStartTime = millis();
  }
  else if (command == "cal1 stop") {
    flowSensors[0].calibrationMode = false;
    Serial.print("Enter measured volume (mL): ");
    while (!Serial.available());
    flowSensors[0].calibrationVolume = Serial.parseFloat();
    if (flowSensors[0].calibrationVolume > 0) {
        flowSensors[0].calibrationFactor = flowSensors[0].calibrationPulses / flowSensors[0].calibrationVolume;
        Serial.print("New calibration factor 1: ");
        Serial.println(flowSensors[0].calibrationFactor);
    }
  }
  else if (command == "cal2 start") {
    flowSensors[1].calibrationMode = true;
    flowSensors[1].calibrationPulses = 0;
    flowSensors[1].calibrationStartTime = millis();
  }
  else if (command == "cal2 stop") {
    flowSensors[1].calibrationMode = false;
    Serial.print("Enter measured volume (mL): ");
    while (!Serial.available());
    flowSensors[1].calibrationVolume = Serial.parseFloat();
    if (flowSensors[1].calibrationVolume > 0) {
        flowSensors[1].calibrationFactor = flowSensors[1].calibrationPulses / flowSensors[1].calibrationVolume;
        Serial.print("New calibration factor 2: ");
        Serial.println(flowSensors[1].calibrationFactor);
    }
  }
}

void handleWebClient(WiFiClient &client) {
  String request = client.readStringUntil('\r');
  client.flush();

  if (request.indexOf("GET /pump/on") >= 0) {
    pumpManualState = true;
    automaticMode = false;
  }
  else if (request.indexOf("GET /pump/off") >= 0) {
    pumpManualState = false;
    automaticMode = false;
  }
  else if (request.indexOf("GET /valveA/on") >= 0) {
    valveAManualState = true;
    automaticMode = false;
  }
  else if (request.indexOf("GET /valveA/off") >= 0) {
    valveAManualState = false;
    automaticMode = false;
  }
  else if (request.indexOf("GET /valveB/on") >= 0) {
    valveBManualState = true;
    automaticMode = false;
  }
  else if (request.indexOf("GET /valveB/off") >= 0) {
    valveBManualState = false;
    automaticMode = false;
  }
  else if (request.indexOf("GET /auto/on") >= 0) {
    // CHANGED: Force START the cycle immediately
    automaticMode = true;
    relayCycleState = true;
    lastRelaySwitch = millis();
    digitalWrite(RELAY_CYCLE_PIN, HIGH);
  }
  else if (request.indexOf("GET /auto/off") >= 0) {
    // CHANGED: Force STOP the cycle immediately
    automaticMode = false;
    relayCycleState = false;
    digitalWrite(RELAY_CYCLE_PIN, LOW);
  }

  String html = "<html><body><h1>ESP32 Flow Controller</h1>";
  html += "<p>Temp1: " + String(sensorData.tempC1) + " C</p>";
  html += "<p>Temp2: " + String(sensorData.tempC2) + " C</p>";
  html += "<p>FlowRate1: " + String(sensorData.flowRate1) + " L/min</p>";
  html += "<p>TotalFlow1: " + String(sensorData.totalFlow1) + " L</p>";
  html += "<p>FlowRate2: " + String(sensorData.flowRate2) + " L/min</p>";
  html += "<p>TotalFlow2: " + String(sensorData.totalFlow2) + " L</p>";
  html += "<p>Cycle Relay: " + String(relayCycleState ? "ON" : "OFF") + "</p>";
  
  html += "<p>WiFi: " + WiFi.localIP().toString() + "</p>";
  html += "<p><a href=\"/pump/on\">Pump ON</a> | <a href=\"/pump/off\">Pump OFF</a></p>";
  html += "<p><a href=\"/valveA/on\">Valve A ON</a> | <a href=\"/valveA/off\">Valve A OFF</a></p>";
  html += "<p><a href=\"/valveB/on\">Valve B ON</a> | <a href=\"/valveB/off\">Valve B OFF</a></p>";
  html += "<p><a href=\"/auto/on\">AUTO ON</a> | <a href=\"/auto/off\">AUTO OFF</a></p>";
  html += "</body></html>";

  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: text/html");
  client.println("Connection: close");
  client.println();
  client.println(html);
}