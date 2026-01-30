#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Pinos
#define DHTPIN 4
#define DHTTYPE DHT11
#define PINO_CHUVA 26     // YL-83 digital
#define PINO_SERVO 18
#define PINO_LED   27
#define PINO_BUZZER 25

// Limites
#define TEMP_MIN 20
int humMax = 70; // Agora e variavel para permitir ajuste via BLE

// UUIDs BLE
static BLEUUID SERVICE_UUID("0000ABCD-0000-1000-8000-00805F9B34FB");
static BLEUUID CHAR_SENSOR_UUID("0000ABCE-0000-1000-8000-00805F9B34FB");   // notify/read
static BLEUUID CHAR_COMMAND_UUID("0000ABCF-0000-1000-8000-00805F9B34FB");  // write

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo servoEstendal;

// Angulos do servo
int anguloRecolhido = 0;
int anguloEstendido = 90;

bool estadoChuvaAnterior = false;

BLECharacteristic* pSensorChar = nullptr;
BLECharacteristic* pCommandChar = nullptr;
bool deviceConnected = false;

enum EstadoEstendal { EST_RECOLHIDO, EST_ESTENDIDO };
EstadoEstendal estadoEstendal = EST_RECOLHIDO;

// Flag para controlo manual: quando true, a logica automatica nao executa
bool comandoManualAtivo = false;
uint32_t tempoComandoManual = 0;
const uint32_t TIMEOUT_COMANDO_MANUAL_MS = 30000; // 30 segundos de prioridade para comando manual

void buzzerBeep(int freq, int ms) {
  tone(PINO_BUZZER, freq, ms);
  delay(ms + 10);
  noTone(PINO_BUZZER);
}

// NAO mexe no LED; so no servo
void setEstendal(EstadoEstendal novo) {
  // Apenas escreve no servo se o estado mudar para evitar jitter
  if (estadoEstendal != novo) {
    estadoEstendal = novo;
    servoEstendal.write(novo == EST_ESTENDIDO ? anguloEstendido : anguloRecolhido);
    Serial.print("Estendal mudou para: ");
    Serial.println(novo == EST_ESTENDIDO ? "ESTENDIDO" : "RECOLHIDO");
  }
}

// payload: Float32 temp, Float32 hum, Uint8 chuva (1/0), Uint8 estadoEstendal (1/0), little-endian
void enviarNotificacao(float t, float h, bool chuva, EstadoEstendal estado) {
  if (!deviceConnected || !pSensorChar) return;
  uint8_t payload[10];
  memcpy(payload + 0, &t, sizeof(float));
  memcpy(payload + 4, &h, sizeof(float));
  payload[8] = chuva ? 1 : 0;
  payload[9] = (estado == EST_ESTENDIDO) ? 1 : 0;
  
  // Debug via Serial
  Serial.print("BLE Notify -> T:"); Serial.print(t, 1);
  Serial.print(" H:"); Serial.print(h, 0);
  Serial.print(" Chuva:"); Serial.print(chuva ? "SIM" : "NAO");
  Serial.print(" Estendal:"); Serial.println(estado == EST_ESTENDIDO ? "ABERTO" : "FECHADO");

  pSensorChar->setValue(payload, sizeof(payload));
  pSensorChar->notify();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { deviceConnected = true; }
  void onDisconnect(BLEServer*) override { deviceConnected = false; }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    uint8_t* data = c->getData();
    size_t len = c->getLength();
    if (len == 0) return;
    
    uint8_t cmd = data[0];
    
    // Ativa flag de comando manual e regista o tempo
    comandoManualAtivo = true;
    tempoComandoManual = millis();
    
    if (cmd == 0x01) {
      setEstendal(EST_ESTENDIDO);
    } else if (cmd == 0x02) {
      setEstendal(EST_RECOLHIDO);
    } else if (cmd == 0x03 && len >= 2) {
      humMax = data[1];
      Serial.print("Novo limite de humidade: ");
      Serial.println(humMax);
    }
  }
};

void setupBLE() {
  BLEDevice::init("SmartDry");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  pSensorChar = service->createCharacteristic(
    CHAR_SENSOR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pSensorChar->addDescriptor(new BLE2902()); // enable notify

  pCommandChar = service->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pCommandChar->setCallbacks(new CommandCallbacks());

  service->start();
  server->getAdvertising()->addServiceUUID(SERVICE_UUID);
  server->getAdvertising()->start();
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  lcd.init();
  lcd.backlight();

  pinMode(PINO_CHUVA, INPUT);
  pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_BUZZER, OUTPUT);

  servoEstendal.attach(PINO_SERVO);
  setEstendal(EST_RECOLHIDO);
  digitalWrite(PINO_LED, LOW);
  buzzerBeep(1800, 120);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SmartDry");
  lcd.setCursor(0, 1);
  lcd.print("A iniciar...");
  delay(500);

  setupBLE();
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  bool leituraInvalida = isnan(h) || isnan(t);

  int leituraChuva = digitalRead(PINO_CHUVA);
  bool taChover = (leituraChuva == LOW);

  // beeps de transicao de chuva
  if (!estadoChuvaAnterior && taChover) {
    buzzerBeep(2000, 150);
  } else if (estadoChuvaAnterior && !taChover) {
    buzzerBeep(1500, 150);
  }
  estadoChuvaAnterior = taChover;

  // LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  if (leituraInvalida) {
    lcd.print("DHT erro");
  } else {
    lcd.print("T:");
    lcd.print(t, 1);
    lcd.print((char)223);
    lcd.print("C ");
    lcd.print("H:");
    lcd.print(h, 0);
    lcd.print("%");
  }

  // Verifica se o timeout do comando manual expirou
  if (comandoManualAtivo && (millis() - tempoComandoManual > TIMEOUT_COMANDO_MANUAL_MS)) {
    comandoManualAtivo = false;
  }

  // --- LOGICA PRINCIPAL DO ESTENDAL (LED controla-se aqui) ---
  // Se ha comando manual ativo, ignora a logica automatica (exceto chuva que tem prioridade maxima)
  if (taChover) {
    // Chuva tem sempre prioridade: desativa comando manual e recolhe
    comandoManualAtivo = false;
    setEstendal(EST_RECOLHIDO);
    digitalWrite(PINO_LED, HIGH); // LED ON so quando chove
    lcd.setCursor(0, 1);
    lcd.print("Ta a chover   ");
  } else if (!comandoManualAtivo) {
    // So executa logica automatica se nao houver comando manual ativo
    digitalWrite(PINO_LED, LOW); // LED OFF fora de chuva
    if (!leituraInvalida && (t >= TEMP_MIN) && (h <= humMax)) {
      setEstendal(EST_ESTENDIDO);
      lcd.setCursor(0, 1);
      lcd.print("Bom p/ secar  ");
    } else {
      setEstendal(EST_RECOLHIDO);
      lcd.setCursor(0, 1);
      if (leituraInvalida) {
        lcd.print("Clima ? DHT   ");
      } else {
        lcd.print("Clima desfav. ");
      }
    }
  } else {
    // Comando manual ativo: mantem o estado atual e mostra no LCD
    digitalWrite(PINO_LED, LOW);
    lcd.setCursor(0, 1);
    if (estadoEstendal == EST_ESTENDIDO) {
      lcd.print("Manual: ABERTO");
    } else {
      lcd.print("Manual: FECHADO");
    }
  }

  // notificacao BLE periodica (~0.5s)
  static uint32_t lastNotify = 0;
  if (millis() - lastNotify > 500) {
    lastNotify = millis();
    float tempSend = leituraInvalida ? NAN : t;
    float humSend = leituraInvalida ? NAN : h;
    enviarNotificacao(tempSend, humSend, taChover, estadoEstendal);
  }

  delay(500);  // ciclo mais rapido, sem buzzer constante
}
