// Ephnim — 8 mechanical pads → USB keyboard keys 1–8
//
// Board: Pro Micro (ATmega32U4, 5 V / 16 MHz). It enumerates as an Arduino
// Micro, so build with FQBN arduino:avr:micro.
//
// Plug it into the Pi (or any computer) and it shows up as a keyboard. A pad
// holds its key down for as long as the switch is held, so Ephnim sees a tap
// as a tap and a hold past 400 ms as a hold (it ignores OS key repeat).
//
// Wiring: each switch has one leg on its pin below and the other leg on GND.
// The pins use the chip's own pull-ups, so no resistors are needed.
//
//   pad  key  pin        pad layout (top view)
//    1    1   10           1  2  3  4
//    2    2    9           5  6  7  8
//    3    3    7
//    4    4    5
//    5    5   14
//    6    6   A0
//    7    7   A2
//    8    8    2
//
// Wired a pad to the wrong pin? Swap the entries in PAD_PINS, not the wires.

#include <Keyboard.h>

const uint8_t PAD_PINS[8] = {10, 9, 7, 5, 14, A0, A2, 2};
const char PAD_KEYS[8] = {'1', '2', '3', '4', '5', '6', '7', '8'};

const unsigned long DEBOUNCE_MS = 5;  // a change must hold this long to count

bool down[8];               // the state the host has been told
bool locked[8];             // held at power-up: ignored until first released
unsigned long changedAt[8]; // when the raw reading last differed from `down`

void setup() {
  // Turn off the RX/TX LEDs (the two red ones beside the chip). The USB core
  // flashes them on every report by writing their port bits; with the pins
  // switched to inputs those writes can no longer light them. The power LED
  // is wired straight to 5 V and can't be switched from code.
  DDRB &= ~(1 << 0);  // RX LED, PB0
  DDRD &= ~(1 << 5);  // TX LED, PD5
  PORTB &= ~(1 << 0);
  PORTD &= ~(1 << 5);

  for (uint8_t i = 0; i < 8; i++) {
    pinMode(PAD_PINS[i], INPUT_PULLUP);
  }
  delay(10);  // let the pull-ups settle before the first read

  // A switch that reads pressed at power-up is most likely a short or a
  // solder bridge. Holding its key forever would flood the host with
  // repeats, so keep it silent until it has been seen released once.
  for (uint8_t i = 0; i < 8; i++) {
    down[i] = false;
    locked[i] = digitalRead(PAD_PINS[i]) == LOW;
    changedAt[i] = 0;
  }

  Keyboard.begin();
}

void loop() {
  unsigned long now = millis();

  for (uint8_t i = 0; i < 8; i++) {
    bool pressed = digitalRead(PAD_PINS[i]) == LOW;

    if (locked[i]) {
      if (!pressed) locked[i] = false;
      continue;
    }

    if (pressed == down[i]) {
      changedAt[i] = now;  // stable: restart the debounce window
      continue;
    }

    if (now - changedAt[i] < DEBOUNCE_MS) continue;

    down[i] = pressed;
    changedAt[i] = now;
    if (pressed) {
      Keyboard.press(PAD_KEYS[i]);
    } else {
      Keyboard.release(PAD_KEYS[i]);
    }
  }
}
