import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb'
const SENSOR_CHARACTERISTIC_UUID = '0000abce-0000-1000-8000-00805f9b34fb'
const COMMAND_CHARACTERISTIC_UUID = '0000abcf-0000-1000-8000-00805f9b34fb'

type Command = 'extend' | 'retract'

const parseSensorPacket = (value: DataView) => {
  // Espera-se: Float32 temp (0-3), Float32 humidade (4-7), Uint8 chuva (8)
  const temperature = value.byteLength >= 4 ? value.getFloat32(0, true) : Number.NaN
  const humidity = value.byteLength >= 8 ? value.getFloat32(4, true) : Number.NaN
  const rainByte = value.byteLength >= 9 ? value.getUint8(8) : 0

  return {
    temperature: Number.isFinite(temperature) ? temperature : null,
    humidity: Number.isFinite(humidity) ? humidity : null,
    isRaining: rainByte === 1,
  }
}

const friendlyError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError' || /cancel/i.test(error.message)) {
      return 'Ligação cancelada pelo utilizador.'
    }
    if (error.name === 'NetworkError') {
      return 'Dispositivo fora de alcance ou desligado.'
    }
    if (error.name === 'NotSupportedError') {
      return 'Este browser não suporta Web Bluetooth em contexto seguro.'
    }
  }
  return (error as Error)?.message ?? 'Erro desconhecido ao usar Bluetooth.'
}

const MANUAL_COMMAND_TIMEOUT_MS = 30000 // 30 segundos, mesmo que no código Arduino

export const useBLE = () => {
  const { setConnectionState, setSensorData, setClotheslineState, setCommandStatus, setDeviceName, setLastManualCommandTime, reset } =
    useStore()

  const deviceRef = useRef<BluetoothDevice | null>(null)
  const sensorCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null)
  const commandCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null)

  const handleDisconnection = useCallback(() => {
    reset()
    sensorCharacteristicRef.current?.removeEventListener('characteristicvaluechanged', handleNotification)
    sensorCharacteristicRef.current = null
    commandCharacteristicRef.current = null
  }, [reset])

  // Precisa ser function para remover listener; definida depois
  function handleNotification(event: Event) {
    const target = event.target as BluetoothRemoteGATTCharacteristic
    const value = target.value
    if (!value) return

    const parsed = parseSensorPacket(value)
    setSensorData(parsed)
    
    const { humidityTrigger, lastManualCommandTime } = useStore.getState()
    
    // Verifica se há um comando manual recente (dentro do timeout)
    const now = Date.now()
    const hasRecentManualCommand = lastManualCommandTime && (now - lastManualCommandTime < MANUAL_COMMAND_TIMEOUT_MS)
    
    // Chuva tem sempre prioridade máxima, mesmo com comando manual recente
    if (parsed.isRaining) {
      setClotheslineState('FECHADO')
      return
    }
    
    // Se há um comando manual recente, não atualizamos o estado automaticamente
    // (exceto chuva que já foi tratada acima)
    if (hasRecentManualCommand) {
      return
    }
    
    // Quando não há chuva e não há comando manual recente, atualizamos o estado baseado nas condições:
    // - Condições boas (temp >= TEMP_MIN e hum <= trigger) → ABERTO
    // - Condições não boas → FECHADO
    const TEMP_MIN = 20 // Mesmo valor do código Arduino
    if (typeof parsed.temperature === 'number' && typeof parsed.humidity === 'number') {
      if (parsed.temperature >= TEMP_MIN && parsed.humidity <= humidityTrigger) {
        setClotheslineState('ABERTO')
      } else {
        setClotheslineState('FECHADO')
      }
    }
  }

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setConnectionState('error', 'Web Bluetooth não é suportado neste dispositivo.')
      return
    }

    try {
      setConnectionState('connecting')

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'SmartDry' }],
        optionalServices: [SERVICE_UUID],
      })

      deviceRef.current = device
      setDeviceName(device.name ?? 'SmartDry')
      device.addEventListener('gattserverdisconnected', handleDisconnection)

      const server = await device.gatt?.connect()
      if (!server) {
        throw new Error('Falha ao abrir canal GATT.')
      }

      const service = await server.getPrimaryService(SERVICE_UUID)
      const sensorChar = await service.getCharacteristic(SENSOR_CHARACTERISTIC_UUID)
      const commandChar = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID)

      sensorCharacteristicRef.current = sensorChar
      commandCharacteristicRef.current = commandChar

      await sensorChar.startNotifications()
      sensorChar.addEventListener('characteristicvaluechanged', handleNotification)

      setConnectionState('connected')
    } catch (error) {
      const message = friendlyError(error)
      setConnectionState('error', message)
      sensorCharacteristicRef.current?.removeEventListener('characteristicvaluechanged', handleNotification)
      sensorCharacteristicRef.current = null
      commandCharacteristicRef.current = null
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect()
      }
    }
  }, [handleDisconnection, setConnectionState, setDeviceName, setSensorData])

  const disconnect = useCallback(async () => {
    try {
      sensorCharacteristicRef.current?.removeEventListener('characteristicvaluechanged', handleNotification)
      await sensorCharacteristicRef.current?.stopNotifications().catch(() => undefined)
      sensorCharacteristicRef.current = null
      commandCharacteristicRef.current = null

      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect()
      }
    } finally {
      handleDisconnection()
    }
  }, [handleDisconnection])

  const sendCommand = useCallback(
    async (command: Command) => {
      setCommandStatus('sending')
      try {
        if (!commandCharacteristicRef.current) {
          throw new Error('Ainda não existe canal de comandos BLE.')
        }

        const characteristic = commandCharacteristicRef.current
        const payload = new Uint8Array([command === 'extend' ? 0x01 : 0x02])
        if ('writeValueWithResponse' in characteristic && typeof characteristic.writeValueWithResponse === 'function') {
          await characteristic.writeValueWithResponse(payload)
        } else {
          await characteristic.writeValue(payload)
        }
        
        // Atualiza o estado e regista o timestamp do comando manual
        const newState = command === 'extend' ? 'ABERTO' : 'FECHADO'
        setClotheslineState(newState)
        setLastManualCommandTime(Date.now())
      } catch (error) {
        setConnectionState('error', friendlyError(error))
      } finally {
        setCommandStatus('idle')
      }
    },
    [setClotheslineState, setCommandStatus, setConnectionState, setLastManualCommandTime],
  )

  useEffect(
    () => () => {
      disconnect()
    },
    [disconnect],
  )

  return {
    connect,
    disconnect,
    sendCommand,
  }
}

