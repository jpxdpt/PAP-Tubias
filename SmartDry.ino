#include <Wire.h>                 // Biblioteca para comunicação I2C
#include <LiquidCrystal_I2C.h>    // Biblioteca do LCD 16x2 com interface I2C
#include <DHT.h>                  // Biblioteca do sensor de temperatura/humidade DHT
#include <ESP32Servo.h>           // Biblioteca para controlo de servo no ESP32
#include <BLEDevice.h>            // Bibliotecas para comunicação Bluetooth Low Energy (BLE)
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ------------------- Definição de pinos do hardware -------------------
#define DHTPIN 4                  // Pino de dados do sensor DHT11 (temperatura/humidade)
#define DHTTYPE DHT11             // Tipo de sensor DHT utilizado
#define PINO_CHUVA 26             // Pino digital ligado à saída DO do sensor de chuva YL-83
#define PINO_SERVO 18             // Pino de sinal do servo motor do estendal
#define PINO_LED   27             // Pino do LED de indicação (chove / não chove)
#define PINO_BUZZER 25            // Pino do buzzer (alertas sonoros)

// ------------------- UUIDs do serviço e características BLE -------------------
// Serviço principal BLE do projeto SmartDry
static BLEUUID SERVICE_UUID("0000ABCD-0000-1000-8000-00805F9B34FB");

// Característica para envio de dados de sensores para a aplicação (notify/read)
static BLEUUID CHAR_SENSOR_UUID("0000ABCE-0000-1000-8000-00805F9B34FB");

// Característica para receber comandos da aplicação (write)
static BLEUUID CHAR_COMMAND_UUID("0000ABCF-0000-1000-8000-00805F9B34FB");

// ------------------- Objetos de sensores e atuadores -------------------
DHT dht(DHTPIN, DHTTYPE);         // Objeto do sensor DHT11
LiquidCrystal_I2C lcd(0x27, 16, 2); // LCD I2C, endereço 0x27, 16 colunas x 2 linhas
Servo servoEstendal;              // Servo que move o estendal

// Ângulos do servo (podem ser ajustados conforme montagem real)
int anguloRecolhido = 0;          // Posição de estendal recolhido
int anguloEstendido = 90;         // Posição de estendal estendido

// Variável para detetar transições de chuva (antes / agora)
bool estadoChuvaAnterior = false;

// Ponteiros para características BLE (sensores e comandos)
BLECharacteristic* pSensorChar = nullptr;
BLECharacteristic* pCommandChar = nullptr;

// Flag para saber se existe dispositivo BLE ligado
bool deviceConnected = false;

// Estados possíveis do estendal
enum EstadoEstendal { EST_RECOLHIDO, EST_ESTENDIDO };
EstadoEstendal estadoEstendal = EST_RECOLHIDO;

// ------------------- Controlo manual via aplicação -------------------
// Flag que indica se o utilizador enviou um comando manual (BLE)
bool comandoManualAtivo = false;

// Momento (millis) em que o último comando manual foi recebido
uint32_t tempoComandoManual = 0;

// Tempo máximo (ms) durante o qual o comando manual tem prioridade (30 s)
const uint32_t TIMEOUT_COMANDO_MANUAL_MS = 30000;

// ------------------- Funções auxiliares -------------------

// Função para gerar um bip simples no buzzer
void buzzerBeep(int freq, int ms) {
  tone(PINO_BUZZER, freq, ms);   // Gera tom na frequência 'freq'
  delay(ms + 10);                // Mantém o som durante 'ms' milissegundos
  noTone(PINO_BUZZER);           // Desliga o buzzer
}

// Função para alterar o estado do estendal (apenas mexe no servo)
// Não altera o LED nem o LCD; isso é feito na lógica principal
void setEstendal(EstadoEstendal novo) {
  estadoEstendal = novo;
  // Se EST_ESTENDIDO → escreve anguloEstendido, senão anguloRecolhido
  servoEstendal.write(novo == EST_ESTENDIDO ? anguloEstendido : anguloRecolhido);
}

// Envia notificação BLE com temperatura, humidade, estado de chuva E ESTADO DO ESTENDAL
// Formato do payload (10 bytes): [float temp][float hum][uint8 chuva (1/0)][uint8 estado (1=ABERTO/0=FECHADO)]
void enviarNotificacao(float t, float h, bool chuva, EstadoEstendal estado) {
  if (!deviceConnected || !pSensorChar) return;  // Só envia se houver cliente ligado

  uint8_t payload[10];
  memcpy(payload + 0, &t, sizeof(float));        // 4 bytes temperatura
  memcpy(payload + 4, &h, sizeof(float));        // 4 bytes humidade
  payload[8] = chuva ? 1 : 0;                    // 1 byte: 1 = a chover, 0 = sem chuva
  payload[9] = (estado == EST_ESTENDIDO) ? 1 : 0; // 1 byte: 1 = ABERTO, 0 = FECHADO

  pSensorChar->setValue(payload, sizeof(payload));
  pSensorChar->notify();                         // Notifica a app com os novos dados
}

// ------------------- Callbacks do servidor BLE -------------------

// Callback chamado quando um dispositivo BLE se liga/desliga ao ESP32
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override  { deviceConnected = true;  }
  void onDisconnect(BLEServer*) override { deviceConnected = false; }
};

// Callback para tratar comandos recebidos da aplicação (característica de write)
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    // Lê o valor enviado pela app (String Arduino)
    String v = c->getValue();
    if (v.length() == 0) return; // Se vier vazio, ignora

    // Primeiro byte define o comando:
    // 0x01 → abrir estendal (estendido)
    // 0x02 → fechar estendal (recolhido)
    uint8_t cmd = (uint8_t)v[0];

    // Ativa modo de comando manual e guarda o momento atual
    comandoManualAtivo = true;
    tempoComandoManual = millis();

    if (cmd == 0x01) {
      setEstendal(EST_ESTENDIDO);   // Comando manual: abrir
    } else if (cmd == 0x02) {
      setEstendal(EST_RECOLHIDO);   // Comando manual: fechar
    }
  }
};

// ------------------- Configuração do módulo BLE -------------------
void setupBLE() {
  BLEDevice::init("SmartDry");                // Nome do dispositivo BLE visto pela app
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  // Cria o serviço principal
  BLEService* service = server->createService(SERVICE_UUID);

  // Característica para enviar dados de sensores (read + notify)
  pSensorChar = service->createCharacteristic(
    CHAR_SENSOR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pSensorChar->addDescriptor(new BLE2902());  // Necessário para ativar notificações na app

  // Característica para receber comandos da aplicação (write)
  pCommandChar = service->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pCommandChar->setCallbacks(new CommandCallbacks());

  // Inicia serviço e começa publicidade BLE
  service->start();
  server->getAdvertising()->addServiceUUID(SERVICE_UUID);
  server->getAdvertising()->start();
}

// ------------------- Setup inicial do sistema -------------------
void setup() {
  Serial.begin(115200);   // Porta série para debug
  dht.begin();            // Inicializa sensor DHT11
  lcd.init();             // Inicializa LCD I2C
  lcd.backlight();        // Liga a luz de fundo do LCD

  pinMode(PINO_CHUVA, INPUT);    // Entrada digital do sensor de chuva
  pinMode(PINO_LED, OUTPUT);     // Saída para LED
  pinMode(PINO_BUZZER, OUTPUT);  // Saída para buzzer

  servoEstendal.attach(PINO_SERVO); // Liga servo ao pino definido
  setEstendal(EST_RECOLHIDO);      // Começa com o estendal recolhido
  digitalWrite(PINO_LED, LOW);     // LED apagado (sem chuva)
  buzzerBeep(1800, 120);           // Bip de arranque

  // Mensagem inicial no LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SmartDry");
  lcd.setCursor(0, 1);
  lcd.print("A iniciar...");
  delay(500);

  // Inicia módulo BLE
  setupBLE();
}

// ------------------- Ciclo principal -------------------
void loop() {
  // Leitura de temperatura e humidade
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  bool leituraInvalida = isnan(h) || isnan(t);  // Verifica se leitura falhou

  // Leitura do sensor de chuva (YL-83, saída digital)
  int leituraChuva = digitalRead(PINO_CHUVA);
  bool taChover = (leituraChuva == LOW);       // Muitos módulos: LOW = chuva

  // --------- Gestão de beeps de transição de chuva ----------
  // Se antes NÃO chovia e agora chove → começou a chover
  if (!estadoChuvaAnterior && taChover) {
    buzzerBeep(2000, 150);   // Bip agudo
  }
  // Se antes chovia e agora NÃO chove → parou de chover
  else if (estadoChuvaAnterior && !taChover) {
    buzzerBeep(1500, 150);   // Bip mais grave
  }
  // Atualiza estado anterior
  estadoChuvaAnterior = taChover;

  // --------- Atualização do LCD (linha 1: T e H) ----------
  lcd.clear();
  lcd.setCursor(0, 0);
  if (leituraInvalida) {
    lcd.print("DHT erro");         // Indica falha no sensor DHT
  } else {
    lcd.print("T:");
    lcd.print(t, 1);               // Temperatura com 1 casa decimal
    lcd.print((char)223);          // Símbolo de grau
    lcd.print("C ");
    lcd.print("H:");
    lcd.print(h, 0);               // Humidade sem casas decimais
    lcd.print("%");
  }

  // --------- Gestão do timeout do comando manual ----------
  // Se o utilizador não mexer durante 30 s, volta ao modo automático
  if (comandoManualAtivo && (millis() - tempoComandoManual > TIMEOUT_COMANDO_MANUAL_MS)) {
    comandoManualAtivo = false;
  }

  // --------- Lógica principal do estendal ----------
  // 1) Chuva: tem sempre prioridade sobre tudo (inclui comando manual)
  if (taChover) {
    comandoManualAtivo = false;          // Sai do modo manual em caso de chuva
    setEstendal(EST_RECOLHIDO);          // Recolhe estendal
    digitalWrite(PINO_LED, HIGH);        // LED aceso indica chuva
    lcd.setCursor(0, 1);
    lcd.print("Ta a chover   ");
  }
  // 2) Não está a chover e não há comando manual → modo automático simples
  else if (!comandoManualAtivo) {
    digitalWrite(PINO_LED, LOW);         // LED apagado (sem chuva)
    setEstendal(EST_ESTENDIDO);          // Estende sempre que não chove
    lcd.setCursor(0, 1);
    if (leituraInvalida) {
      lcd.print("Sem chuva DHT?");
    } else {
      lcd.print("Sem chuva     ");
    }
  }
  // 3) Modo manual ativo → mantém posição escolhida pelo utilizador
  else {
    digitalWrite(PINO_LED, LOW);
    lcd.setCursor(0, 1);
    if (estadoEstendal == EST_ESTENDIDO) {
      lcd.print("Manual: ABERTO");
    } else {
      lcd.print("Manual: FECHADO");
    }
  }

  // --------- Envio periódico de dados via BLE ----------
  // Envia de 1 em 1 segundo a T, H, estado de chuva E ESTADO DO ESTENDAL para a app
  static uint32_t lastNotify = 0;
  if (millis() - lastNotify > 1000) {
    lastNotify = millis();
    float tempSend = leituraInvalida ? NAN : t;
    float humSend  = leituraInvalida ? NAN : h;
    enviarNotificacao(tempSend, humSend, taChover, estadoEstendal);
  }

  // Pequeno atraso para estabilizar o ciclo
  delay(500);
}
