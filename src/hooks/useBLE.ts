import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb'
const SENSOR_CHARACTERISTIC_UUID = '0000abce-0000-1000-8000-00805f9b34fb'
const COMMAND_CHARACTERISTIC_UUID = '0000abcf-0000-1000-8000-00805f9b34fb'

type Command = 'extend' | 'retract' | { type: 'setHumidity'; value: number }

const parseSensorPacket = (value: DataView) => {
  // Espera-se: Float32 temp (0-3), Float32 humidade (4-7), Uint8 chuva (8), Uint8 estado (9)
  const temperature = value.byteLength >= 4 ? value.getFloat32(0, true) : Number.NaN
  const humidity = value.byteLength >= 8 ? value.getFloat32(4, true) : Number.NaN
  const rainByte = value.byteLength >= 9 ? value.getUint8(8) : 0
  const stateByte = value.byteLength >= 10 ? value.getUint8(9) : undefined

  return {
    temperature: Number.isFinite(temperature) ? temperature : null,
    humidity: Number.isFinite(humidity) ? humidity : null,
    isRaining: rainByte === 1,
    clotheslineState: stateByte === 1 ? 'ABERTO' : (stateByte === 0 ? 'FECHADO' : undefined),
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

    // O estado reportado pelo hardware é a fonte da verdade
    if (parsed.clotheslineState) {
      setClotheslineState(parsed.clotheslineState as any)
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
        let payload: Uint8Array

        if (typeof command === 'string') {
          payload = new Uint8Array([command === 'extend' ? 0x01 : 0x02])
        } else {
          payload = new Uint8Array([0x03, command.value])
        }

        if ('writeValueWithResponse' in characteristic && typeof (characteristic as any).writeValueWithResponse === 'function') {
          await (characteristic as any).writeValueWithResponse(payload)
        } else {
          await (characteristic as any).writeValue(payload)
        }

        // Se for comando de movimento, atualiza o timestamp manual
        if (typeof command === 'string') {
          const newState = command === 'extend' ? 'ABERTO' : 'FECHADO'
          setClotheslineState(newState)
          setLastManualCommandTime(Date.now())
        }
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
