// Rhythmic Intent — piezo tap pad → USB serial
//
// Sends one line per strike:   TAP <velocity 1-127>\n   at 115200 baud.
// The bridge (bridge/bridge.py) auto-detects this board and turns each line
// into a live MIDI note (real velocity) plus a tap in the GUI.
//
// Wiring (velocity-sensitive piezo):
//   piezo (+) ── A0
//   piezo (-) ── GND
//   1 MΩ resistor across the piezo (A0 ── GND) to drain charge between hits.
//   Recommended: a 5.1 V zener (or two diodes) from A0 to GND/5V to clamp
//   spikes so hard hits don't over-volt the ADC.
//
// Tuning: watch the raw values in the Serial Monitor (uncomment DEBUG below),
// then set THRESHOLD just above the resting noise and MAX_READING to roughly
// the ADC value of your hardest comfortable hit.
//
// Button instead of a piezo? Wire a button from a digital pin to GND with
// INPUT_PULLUP and, on a debounced falling edge, `Serial.println("TAP 100");`.

const int PIEZO_PIN = A0;
const int THRESHOLD = 40;     // ADC counts to register a hit (above noise floor)
const int MAX_READING = 700;  // ADC counts mapped to full velocity (127)
const unsigned long PEAK_MS = 6;   // window to capture the strike's peak
const unsigned long DEAD_MS = 60;  // ignore retriggers for this long after a hit

// #define DEBUG  // uncomment to also print raw peak values for tuning

void setup() {
  Serial.begin(115200);
}

void loop() {
  int reading = analogRead(PIEZO_PIN);
  if (reading <= THRESHOLD) return;

  // Track the peak over a short window so velocity reflects strike strength,
  // not just the first sample above threshold.
  int peak = reading;
  unsigned long start = millis();
  while (millis() - start < PEAK_MS) {
    int r = analogRead(PIEZO_PIN);
    if (r > peak) peak = r;
  }

  int clamped = constrain(peak, THRESHOLD, MAX_READING);
  int velocity = map(clamped, THRESHOLD, MAX_READING, 1, 127);

  Serial.print("TAP ");
  Serial.println(velocity);
#ifdef DEBUG
  Serial.print("# peak=");
  Serial.println(peak);
#endif

  delay(DEAD_MS);  // debounce / avoid double-triggering on the ring-out
}
