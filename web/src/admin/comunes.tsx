import { useEffect, useState, type ReactNode } from 'react'
import type { EstadoFactura, Fecha, MedioPago, RolPersonal } from '../../../contratos/tipos'
import type { Lectura } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip } from '../ui/Controles'
import { copiar } from '../ui/copiar'
import { Icono } from '../ui/Icono'
import { ZONA_RESTAURANTE } from './calculos'

export const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  factus_pay: 'Factus Pay',
  efectivo: 'Efectivo',
  tarjeta_debito: 'Tarjeta débito',
  tarjeta_credito: 'Tarjeta crédito',
}

export const ETIQUETA_ROL: Record<RolPersonal, string> = {
  mesero: 'Mesero',
  cocina: 'Cocina',
  admin: 'Administrador',
}

const FACTURA: Record<EstadoFactura, { texto: string; tono: string }> = {
  sin_emitir: { texto: 'Sin emitir', tono: 'gris' },
  en_proceso: { texto: 'En proceso', tono: 'ambar' },
  en_validacion: { texto: 'En validación', tono: 'ambar' },
  emitida: { texto: 'Emitida', tono: 'verde-fuerte' },
  rechazada: { texto: 'Rechazada', tono: 'rojo' },
}

export const ChipFactura = ({ estado }: { estado: EstadoFactura }) => <Chip tono={FACTURA[estado].tono}>{FACTURA[estado].texto}</Chip>

const formatoFecha = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_RESTAURANTE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** 4 nov, 12:41 p. m., en hora de Colombia. */
export const fechaHora = (fecha: Fecha) => formatoFecha.format(new Date(fecha))

/** Todas listas, o el primer error, o cargando. */
export function reunir<T extends Record<string, Lectura<unknown>>>(lecturas: T): Lectura<{ [K in keyof T]: T[K] extends Lectura<infer V> ? V : never }> {
  const valores: Record<string, unknown> = {}
  let cargando = false
  for (const [clave, lectura] of Object.entries(lecturas)) {
    if (lectura.estado === 'error') return lectura
    if (lectura.estado === 'cargando') cargando = true
    else valores[clave] = lectura.valor
  }
  return cargando ? { estado: 'cargando' } : { estado: 'listo', valor: valores as { [K in keyof T]: T[K] extends Lectura<infer V> ? V : never } }
}

/** La hora avanza sola: a medianoche "hoy" cambia aunque nadie toque la pantalla. */
export function usarAhora(cadaMs = 60_000) {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), cadaMs)
    return () => clearInterval(reloj)
  }, [cadaMs])
  return ahora
}

export function descargarArchivo(archivo: Blob, nombre: string) {
  const url = URL.createObjectURL(archivo)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function BotonCopiar({ texto, etiqueta, children = 'Copiar' }: { texto: string; etiqueta: string; children?: ReactNode }) {
  const avisos = usarAvisos()
  const [hecho, setHecho] = useState(false)
  useEffect(() => {
    if (!hecho) return
    const espera = setTimeout(() => setHecho(false), 1600)
    return () => clearTimeout(espera)
  }, [hecho])
  return (
    <Boton
      variante="fantasma"
      className="boton--chico"
      aria-label={etiqueta}
      onClick={async () => {
        if (await copiar(texto)) setHecho(true)
        else avisos.error(new Error('No se pudo copiar'))
      }}
    >
      <Icono nombre={hecho ? 'check' : 'copiar'} tamano={15} /> {hecho ? 'Copiado' : children}
    </Boton>
  )
}

/** Para lo que no se puede deshacer: el primer toque pregunta, el segundo hace. */
export function Confirmar({
  texto,
  pregunta,
  alConfirmar,
  cargando = false,
  variante = 'fantasma',
}: {
  texto: string
  pregunta: string
  alConfirmar: () => void
  cargando?: boolean
  variante?: 'fantasma' | 'secundario'
}) {
  const [preguntando, setPreguntando] = useState(false)
  if (!preguntando) {
    return (
      <Boton variante={variante} className="boton--chico" cargando={cargando} onClick={() => setPreguntando(true)}>
        {texto}
      </Boton>
    )
  }
  return (
    <span className="admin-confirmar" role="group" aria-label={pregunta}>
      <span>{pregunta}</span>
      <Boton
        variante="primario"
        className="boton--chico"
        onClick={() => {
          setPreguntando(false)
          alConfirmar()
        }}
      >
        Sí
      </Boton>
      <Boton variante="fantasma" className="boton--chico" onClick={() => setPreguntando(false)}>
        No
      </Boton>
    </span>
  )
}

export function Campo({ etiqueta, ayuda, error, children }: { etiqueta: string; ayuda?: string; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="campo">
      <span className="campo__etiqueta">{etiqueta}</span>
      {children}
      {ayuda && !error && <span className="ayuda-campo">{ayuda}</span>}
      {error && (
        <span className="admin-error-campo" role="alert">
          <Icono nombre="alerta" tamano={14} /> <span>{error}</span>
        </span>
      )}
    </label>
  )
}
