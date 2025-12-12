import { create } from 'zustand'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
type CommandStatus = 'idle' | 'sending'
type ClotheslineState = 'ABERTO' | 'FECHADO' | 'DESCONHECIDO'

export interface SensorState {
  temperature: number | null
  humidity: number | null
  temperatureHistory: number[]
  humidityHistory: number[]
  isRaining: boolean | null
  lastUpdated?: number
}

interface StoreState {
  connectionState: ConnectionState
  deviceName?: string
  error?: string
  sensors: SensorState
  humidityTrigger: number
  clotheslineState: ClotheslineState
  commandStatus: CommandStatus
  setConnectionState: (state: ConnectionState, error?: string) => void
  setDeviceName: (name?: string) => void
  setSensorData: (data: Partial<Pick<SensorState, 'temperature' | 'humidity' | 'isRaining'>>) => void
  setHumidityTrigger: (value: number) => void
  setClotheslineState: (state: ClotheslineState) => void
  setCommandStatus: (status: CommandStatus) => void
  reset: () => void
}

const HISTORY_LIMIT = 24

export const useStore = create<StoreState>((set) => ({
  connectionState: 'idle',
  deviceName: undefined,
  error: undefined,
  humidityTrigger: 70,
  clotheslineState: 'DESCONHECIDO',
  commandStatus: 'idle',
  sensors: {
    temperature: null,
    humidity: null,
    temperatureHistory: [],
    humidityHistory: [],
    isRaining: null,
  },
  setConnectionState: (state, error) =>
    set({
      connectionState: state,
      error: state === 'error' ? error : undefined,
    }),
  setDeviceName: (name) => set({ deviceName: name }),
  setSensorData: (data) =>
    set((current) => {
      const nextTemperatureHistory = [...current.sensors.temperatureHistory]
      const nextHumidityHistory = [...current.sensors.humidityHistory]

      if (typeof data.temperature === 'number') {
        nextTemperatureHistory.push(data.temperature)
        if (nextTemperatureHistory.length > HISTORY_LIMIT) nextTemperatureHistory.shift()
      }

      if (typeof data.humidity === 'number') {
        nextHumidityHistory.push(data.humidity)
        if (nextHumidityHistory.length > HISTORY_LIMIT) nextHumidityHistory.shift()
      }

      return {
        sensors: {
          ...current.sensors,
          ...data,
          temperatureHistory: nextTemperatureHistory,
          humidityHistory: nextHumidityHistory,
          lastUpdated: Date.now(),
        },
      }
    }),
  setHumidityTrigger: (value) => set({ humidityTrigger: value }),
  setClotheslineState: (state) => set({ clotheslineState: state }),
  setCommandStatus: (status) => set({ commandStatus: status }),
  reset: () =>
    set({
      connectionState: 'disconnected',
      deviceName: undefined,
      commandStatus: 'idle',
      clotheslineState: 'DESCONHECIDO',
      sensors: {
        temperature: null,
        humidity: null,
        temperatureHistory: [],
        humidityHistory: [],
        isRaining: null,
      },
    }),
}))

