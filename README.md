# SmartDry - Estendal Inteligente

Dashboard web para monitorização e controlo de um estendal inteligente baseado em ESP32, com comunicação via Web Bluetooth API.

## 📋 Índice

- [Descrição](#descrição)
- [Hardware Necessário](#hardware-necessário)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Instalação](#instalação)
- [Configuração do ESP32](#configuração-do-esp32)
- [Executar a Aplicação Web](#executar-a-aplicação-web)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Funcionalidades](#funcionalidades)
- [Protocolo BLE](#protocolo-ble)
- [Troubleshooting](#troubleshooting)
- [Licença](#licença)

## 📖 Descrição

O SmartDry é um sistema de estendal inteligente que monitoriza condições climáticas (temperatura, humidade e chuva) e controla automaticamente a extensão/recolha do estendal. A aplicação web permite monitorização em tempo real e controlo manual via Web Bluetooth.

### Funcionalidades Principais

- **Monitorização em Tempo Real**: Visualização de temperatura, humidade e estado de chuva
- **Controlo Automático**: Recolhe automaticamente quando chove ou quando a humidade excede o limite configurado
- **Controlo Manual**: Botões para estender/recolher manualmente o estendal
- **Histórico de Sensores**: Gráficos simples (sparklines) com histórico das últimas 24 leituras
- **Interface Responsiva**: Design mobile-first com dark mode

## 🔧 Hardware Necessário

### Componentes

- **ESP32** (qualquer variante com Bluetooth)
- **DHT11** - Sensor de temperatura e humidade
- **YL-83** - Sensor de chuva (módulo digital)
- **Servo Motor** - Para controlar o estendal
- **LED** - Indicador visual
- **Buzzer** - Alertas sonoros
- **LCD I2C 16x2** (opcional) - Display local
- **Resistências e jumpers** conforme necessário

### Ligações

```
ESP32    Componente
------   ----------
GPIO 4   DHT11 Data
GPIO 26  YL-83 Digital Out
GPIO 18  Servo Signal
GPIO 27  LED (com resistência)
GPIO 25  Buzzer
SDA/SCL  LCD I2C (se usado)
```

## 💻 Tecnologias Utilizadas

### Frontend (Web App)

- **React 19** - Framework UI
- **TypeScript** - Tipagem estática
- **Vite** - Build tool e dev server
- **TailwindCSS 3** - Estilização
- **Zustand** - Gestão de estado
- **Lucide React** - Ícones
- **Web Bluetooth API** - Comunicação BLE

### Firmware (ESP32)

- **Arduino Framework**
- **ESP32 BLE Library** - Comunicação Bluetooth Low Energy
- **DHT Library** - Leitura do sensor DHT11
- **ESP32Servo** - Controlo do servo motor
- **LiquidCrystal_I2C** - Display LCD (opcional)

## 🚀 Instalação

### Pré-requisitos

- **Node.js** 18+ e npm
- **Arduino IDE** com suporte para ESP32
- **Placa ESP32** configurada no Arduino IDE

### Instalar Dependências da Web App

```bash
cd smartdry
npm install
```

### Instalar Bibliotecas do Arduino

No Arduino IDE, instala as seguintes bibliotecas via Library Manager:

1. **ESP32 BLE Arduino** (geralmente incluída no core ESP32)
2. **DHT sensor library** (Adafruit)
3. **ESP32Servo**
4. **LiquidCrystal_I2C** (opcional, se usares LCD)

## 📱 Configuração do ESP32

1. Abre o ficheiro `SmartDry.ino` no Arduino IDE
2. Seleciona a placa: **Tools > Board > ESP32 Arduino > ESP32-WROOM-DA Module** (ou a tua variante)
3. Seleciona a porta COM correta: **Tools > Port**
4. Carrega o sketch para o ESP32: **Sketch > Upload**

### Configurações Ajustáveis

No código Arduino, podes ajustar:

```cpp
#define TEMP_MIN 20      // Temperatura mínima em ºC
#define HUM_MAX  70      // Humidade máxima em %
int anguloRecolhido = 0;     // Ângulo do servo quando recolhido
int anguloEstendido = 90;    // Ângulo do servo quando estendido
```

## 🌐 Executar a Aplicação Web

### Modo Desenvolvimento

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:5173`

**Nota**: O Web Bluetooth requer contexto seguro (HTTPS). Em desenvolvimento local, o `localhost` é considerado seguro pela maioria dos browsers.

### Build para Produção

```bash
npm run build
```

Os ficheiros compilados estarão na pasta `dist/`. Para servir em produção, usa um servidor HTTPS (ex: Vercel, Netlify).

### Preview do Build

```bash
npm run preview
```

## 📁 Estrutura do Projeto

```
smartdry/
├── src/
│   ├── components/
│   │   └── Dashboard.tsx      # Componente principal da dashboard
│   ├── hooks/
│   │   └── useBLE.ts           # Hook para comunicação BLE
│   ├── store/
│   │   └── useStore.ts         # Store Zustand (estado global)
│   ├── App.tsx                 # Componente raiz
│   ├── main.tsx                # Entry point
│   └── index.css               # Estilos globais Tailwind
├── SmartDry.ino                # Código Arduino para ESP32
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## ⚙️ Funcionalidades

### Dashboard

- **Header**: Título e botão de ligação Bluetooth com estados visuais (cinzento → azul → verde)
- **Cards de Sensores**:
  - **Temperatura**: Valor atual + sparkline com histórico
  - **Humidade**: Valor em % + barra de progresso + sparkline
  - **Chuva**: Indicador visual (Sol/Chuva) com mudança de cor
- **Painel de Controlo**:
  - Badge de estado atual (ABERTO/FECHADO)
  - Botões manuais "Estender" e "Recolher" com feedback de loading
  - Secção colapsável para configurar trigger de humidade (30-90%)

### Estados de Ligação

- **Idle**: Botão cinzento "Ligar"
- **Connecting**: Botão azul "A ligar..." com spinner
- **Connected**: Botão verde "Desligar"
- **Error**: Botão vermelho com mensagem de erro

## 📡 Protocolo BLE

### UUIDs

- **Serviço**: `0000ABCD-0000-1000-8000-00805F9B34FB`
- **Characteristic Sensores** (Read/Notify): `0000ABCE-0000-1000-8000-00805F9B34FB`
- **Characteristic Comandos** (Write): `0000ABCF-0000-1000-8000-00805F9B34FB`

### Payload de Notificação (Sensores)

O ESP32 envia notificações a cada ~1 segundo com o seguinte formato (little-endian):

```
Offset  Tamanho  Tipo     Descrição
------  -------  -------  -----------
0-3     4 bytes  Float32  Temperatura (ºC)
4-7     4 bytes  Float32  Humidade (%)
8       1 byte   Uint8    Chuva (1 = sim, 0 = não)
```

**Total**: 9 bytes

### Comandos (Write)

A app envia comandos de 1 byte:

- `0x01` - Estender estendal
- `0x02` - Recolher estendal

### Filtro de Dispositivo

A app procura dispositivos com `namePrefix: 'SmartDry'`. Certifica-te que o ESP32 anuncia este nome:

```cpp
BLEDevice::init("SmartDry");
```

## 🔍 Troubleshooting

### Web Bluetooth não funciona

- **Problema**: Botão "Ligar" não aparece ou dá erro
- **Solução**: 
  - Verifica que estás em `localhost` ou HTTPS
  - Certifica-te que o browser suporta Web Bluetooth (Chrome/Edge recomendados)
  - Verifica que o Bluetooth está ativo no sistema

### Dispositivo não aparece no scan

- **Problema**: A app não encontra o ESP32
- **Solução**:
  - Verifica que o ESP32 está a anunciar o nome "SmartDry"
  - Certifica-te que o BLE está ativo no ESP32
  - Tenta reiniciar o ESP32
  - Verifica a distância (BLE tem alcance limitado)

### Erro de compilação no Arduino

- **Problema**: Erros relacionados com caracteres estendidos
- **Solução**: O código já está sem acentos. Se persistir, copia o código para um novo sketch

### Servo não responde

- **Problema**: Comandos manuais não movem o servo
- **Solução**:
  - Verifica as ligações do servo (sinal, VCC, GND)
  - Ajusta os ângulos `anguloRecolhido` e `anguloEstendido` se necessário
  - Verifica que o servo está ligado a GPIO 18

### Dados não atualizam na dashboard

- **Problema**: Valores ficam em "--" ou não mudam
- **Solução**:
  - Verifica que as notificações BLE estão ativas
  - Abre a consola do browser (F12) para ver erros
  - Verifica que o DHT11 está ligado corretamente
  - Reinicia a ligação BLE

## 📝 Notas Importantes

- **HTTPS Obrigatório**: Em produção, a app deve ser servida via HTTPS para o Web Bluetooth funcionar
- **Timeout de Comando Manual**: Comandos manuais têm prioridade por 30 segundos antes da lógica automática retomar
- **Prioridade de Chuva**: A deteção de chuva tem sempre prioridade máxima e sobrescreve comandos manuais
- **Histórico Limitado**: O histórico de sensores mantém apenas as últimas 24 leituras

## 📄 Licença

Este projeto foi desenvolvido para fins educacionais.

## 👤 Autor

Desenvolvido como parte do projeto PAP (Projeto de Aptidão Profissional).

---

**Versão**: 1.0.0  
**Última atualização**: Dezembro 2025
