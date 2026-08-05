// ESP32‑S3 – Lettura 16 Reed Switch collegati a un CD74HC4067
// Pin di controllo del MUX
const int S0 = 4;
const int S1 = 5;
const int S2 = 6;
const int S3 = 7;
const int SIG = 15;          // ingresso del segnale del MUX

// ------------------------------------------------
// Seleziona il canale 0‑15 (binary on S0‑S3)
void selectMuxChannel(uint8_t channel) {
  digitalWrite(S0, channel & 0x01);            // bit 0
  digitalWrite(S1, (channel >> 1) & 0x01);    // bit 1
  digitalWrite(S2, (channel >> 2) & 0x01);    // bit 2
  digitalWrite(S3, (channel >> 3) & 0x01);    // bit 3
}

void setup() {
  Serial.begin(115200);

  pinMode(S0, OUTPUT);
  pinMode(S1, OUTPUT);
  pinMode(S2, OUTPUT);
  pinMode(S3, OUTPUT);
  pinMode(SIG, INPUT_PULLUP);      // pull‑up interno

  Serial.println(F("\n=== Lettura 16 Reed Switch ==="));
}

void loop() {
  const uint32_t DELAY_MS = 500;   // tempo tra due letture complete
  static uint32_t lastTime = 0;
  if (millis() - lastTime < DELAY_MS) return;
  lastTime = millis();

  // Bitmap a 16 bit: 1 = calamita presente, 0 = vuoto
  uint16_t bitmap = 0;

  for (uint8_t ch = 0; ch < 16; ++ch) {
    selectMuxChannel(ch);          // mette il MUX sul canale `ch`
    delayMicroseconds(5);          // breve stabilizzazione (± µs)

    int stato = digitalRead(SIG);  // LOW → reed chiuso (magnete)
    if (stato == LOW) {
      bitmap |= (1U << ch);         // imposta il bit corrispondente
    }
  }

  // ---------- Stampa risultato ----------
  Serial.print(F("Bitmap 0x"));
  Serial.println(bitmap, HEX);      // es.: 0x0A03

  // (Facoltativo) stampa canale per canale
  for (uint8_t i = 0; i < 16; ++i) {
    bool occupied = (bitmap >> i) & 0x01;
    Serial.printf("C%02d: %s\n", i,
                  occupied ? "✅ Calamita" : "❌ Vuoto");
  }
  Serial.println();                // riga vuota per separare le letture
}
