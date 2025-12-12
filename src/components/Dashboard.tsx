import { useMemo } from 'react'
import {
  Bluetooth,
  Loader2,
  Thermometer,
  Droplets,
  CloudRain,
  Sun,
  Scan,
  Waves,
  ArrowUpToLine,
  ArrowDownToLine,
  Settings2,
} from 'lucide-react'
import clsx from 'clsx'
import { useBLE } from '../hooks/useBLE'
import { useStore } from '../store/useStore'

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div
    className={clsx(
      'rounded-2xl bg-slate-900/60 border border-white/5 backdrop-blur shadow-soft p-4 md:p-5',
      className,
    )}
  >
    {children}
  </div>
)

const Sparkline = ({ data }: { data: number[] }) => {
  const points = useMemo(() => {
    if (!data.length) return '0,50 100,50'
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min || 1
    return data
      .map((value, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100
        const y = 100 - ((value - min) / range) * 100
        return `${x},${y}`
      })
      .join(' ')
  }, [data])

  return (
    <svg viewBox="0 0 100 100" className="w-full h-14 text-primary">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  )
}

const formatValue = (value: number | null, suffix = '') =>
  typeof value === 'number' ? `${value.toFixed(1)}${suffix}` : '--'

const connectionColors = {
  idle: 'bg-slate-700 text-slate-50 hover:bg-slate-600',
  disconnected: 'bg-slate-700 text-slate-50 hover:bg-slate-600',
  connecting: 'bg-blue-600 text-white hover:bg-blue-500',
  connected: 'bg-green-600 text-white hover:bg-green-500',
  error: 'bg-red-600 text-white hover:bg-red-500',
}

const stateBadge = {
  ABERTO: 'bg-green-500/15 text-green-400 border border-green-500/30',
  FECHADO: 'bg-red-500/15 text-red-400 border border-red-500/30',
  DESCONHECIDO: 'bg-slate-700/60 text-slate-200 border border-white/10',
}

const Dashboard = () => {
  const { connect, disconnect, sendCommand } = useBLE()
  const {
    connectionState,
    deviceName,
    sensors,
    humidityTrigger,
    setHumidityTrigger,
    clotheslineState,
    commandStatus,
    error,
  } = useStore()

  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'

  const humidityPercent = Math.min(100, Math.max(0, sensors.humidity ?? 0))

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Scan className="w-4 h-4" /> SmartDry · HMI
          </p>
          <h1 className="text-3xl md:text-4xl font-semibold text-white mt-1">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            Monitorização em tempo real e controlo manual via Web Bluetooth.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {error && connectionState === 'error' ? (
            <span className="text-sm text-red-400">{error}</span>
          ) : null}
          <button
            type="button"
            onClick={() => (isConnected ? disconnect() : connect())}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-soft',
              connectionColors[connectionState],
            )}
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />}
            {isConnected ? 'Desligar' : isConnecting ? 'A ligar...' : 'Ligar'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-6">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              <Thermometer className="w-4 h-4 text-orange-300" />
              <span className="text-sm">Temperatura</span>
            </div>
            <span className="text-xs text-slate-400">{deviceName ?? 'Sem dispositivo'}</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-white">{formatValue(sensors.temperature, '°C')}</span>
            <span className="text-xs text-slate-400">live</span>
          </div>
          <div className="mt-2">
            <Sparkline data={sensors.temperatureHistory} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              <Droplets className="w-4 h-4 text-blue-300" />
              <span className="text-sm">Humidade</span>
            </div>
            <span className="text-xs text-slate-400">Trigger {humidityTrigger}%</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-white">{formatValue(sensors.humidity, '%')}</span>
            <span className="text-xs text-slate-400">última leitura</span>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 rounded-full bg-slate-800 overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-primary to-cyan-400 transition-all"
                style={{ width: `${humidityPercent}%` }}
              />
            </div>
            <Sparkline data={sensors.humidityHistory} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              {sensors.isRaining ? (
                <CloudRain className="w-4 h-4 text-blue-400" />
              ) : (
                <Sun className="w-4 h-4 text-yellow-300" />
              )}
              <span className="text-sm">Chuva</span>
            </div>
            <span
              className={clsx(
                'px-2 py-1 rounded-full text-xs font-medium border',
                sensors.isRaining
                  ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                  : 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
              )}
            >
              {sensors.isRaining ? 'A chover' : 'Sem chuva'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-slate-200">
            <Waves className="w-5 h-5 text-cyan-300" />
            <div>
              <p className="text-lg font-semibold">Estado do Estendal</p>
              <p className="text-sm text-slate-400">Reage a chuva e ao limite de humidade</p>
            </div>
          </div>
          <div className="mt-4">
            <div className={clsx('inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold', stateBadge[clotheslineState])}>
              {clotheslineState}
            </div>
          </div>
        </Card>
      </div>

      <section className="mt-6 md:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-300">
              <Settings2 className="w-4 h-4 text-purple-300" />
              <span className="text-sm">Configuração</span>
            </div>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-slate-200 font-semibold flex items-center justify-between">
              Trigger de humidade
              <span className="text-xs text-slate-400">definir recolha automática</span>
            </summary>
            <div className="mt-4 space-y-3">
              <input
                type="range"
                min={30}
                max={90}
                value={humidityTrigger}
                onChange={(event) => setHumidityTrigger(Number(event.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Recolher se humidade &gt; {humidityTrigger}%</span>
                <span className="text-slate-500">30% - 90%</span>
              </div>
            </div>
          </details>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Comando Manual</p>
              <h3 className="text-xl font-semibold text-white">Controla o estendal</h3>
            </div>
            <div className={clsx('px-3 py-1 rounded-full text-xs font-semibold border', stateBadge[clotheslineState])}>
              {clotheslineState}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!isConnected || commandStatus === 'sending'}
              onClick={() => void sendCommand('extend')}
              className={clsx(
                'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-green-600 text-white hover:bg-green-500',
              )}
            >
              {commandStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpToLine className="w-4 h-4" />}
              Estender
            </button>

            <button
              type="button"
              disabled={!isConnected || commandStatus === 'sending'}
              onClick={() => void sendCommand('retract')}
              className={clsx(
                'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-slate-800 text-white hover:bg-slate-700',
              )}
            >
              {commandStatus === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Recolher
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Os botões enviam um byte: 0x01 (estender) ou 0x02 (recolher). Mostram feedback de envio.
          </p>
        </Card>
      </section>
    </div>
  )
}

export default Dashboard

