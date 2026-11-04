// Cliente real de Factus Pay. Solo corre en el backend.
//
// Nunca llama a `POST /auth`: cada llamada revoca el token de todo el equipo.
// El token sale de `.env` y viaja en `Authorization: Bearer`. No se imprime
// nunca, ni dentro de los mensajes de error.

import { ErrorIntegracion } from '../contratos/reglas'
import type { Cobro, EstadoCobro, Fecha, Pesos, ServicioCobros, SolicitudCobro } from '../contratos/tipos'
import { ESTADOS_COBRO } from '../contratos/tipos'

export interface OpcionesFactusPay {
  /** `https://pay-api-sandbox.factus.com.co`. Da igual si trae barra al final. */
  url: string
  /** El token de `.env`. No se vuelve a pedir: pedirlo revoca el del equipo. */
  token: string
  /** La llave que el restaurante registró en el panel. La usa el webhook. */
  llaveWebhook: string
  /** Toda llamada lleva User-Agent propio; sin él, Cloudflare responde 403. */
  userAgent: string
  /** Para las pruebas. Por defecto, el `fetch` global. */
  fetch?: typeof globalThis.fetch
  /** El webhook debe contestar en menos de 10 segundos, así que la llamada no se cuelga. */
  tiempoLimiteMs?: number
}

/** `leerWebhook` llega en el paso siguiente. */
export type CobrosFactusPay = Omit<ServicioCobros, 'leerWebhook'>

const TIEMPO_LIMITE_MS = 8_000

/** Colombia no tiene horario de verano, así que su desfase es siempre este. */
const DESFASE_COLOMBIA = '-05:00'

/** `28-10-2026 08:03:04 PM`, el formato que muestra la documentación. */
const FECHA_DE_FACTUS =
  /^(\d{2})-(\d{2})-(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([AaPp])\.?[Mm]\.?)?$/

/** Un ISO que ya dice su zona: `Z`, `+0000` o `-05:00`. */
const CON_ZONA = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** Un ISO sin zona, como `2026-09-04T15:20:00`. */
const SIN_ZONA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/

const recortar = (texto: string) => (texto.length > 200 ? `${texto.slice(0, 200)}...` : texto)

/** Quita la barra final para que `${url}/v1/collections` no quede con dos barras. */
const sinBarraFinal = (url: string) => url.replace(/\/+$/, '')

function aTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null
}

/** El QR llega como `data:image/png;base64,iVBOR...` y el contrato lo quiere sin el prefijo. */
function aQr(valor: unknown): string | null {
  const texto = aTexto(valor)
  if (!texto) return null
  return aTexto(texto.replace(/^data:[^,]*,/, ''))
}

/** Los pesos del contrato son enteros. Factus Pay manda `150000`, `150000.0` o `"150000"`. */
function aPesos(valor: unknown): Pesos | null {
  const numero = typeof valor === 'string' ? Number(valor.trim()) : valor
  if (typeof numero !== 'number' || !Number.isFinite(numero)) return null
  return Math.round(numero)
}

/** Un estado que no conocemos es `desconocido`: no detiene las consultas ni lanza error. */
function aEstado(valor: unknown): EstadoCobro {
  const conocidos: readonly string[] = ESTADOS_COBRO
  return typeof valor === 'string' && conocidos.includes(valor) ? (valor as EstadoCobro) : 'desconocido'
}

function aIso(texto: string): Fecha | null {
  const fecha = new Date(texto)
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/**
 * Las fechas del contrato son ISO 8601 en UTC. La documentación muestra dos formatos:
 * `28-10-2026 08:03:04 PM` en los recaudos e ISO con `Z` en el webhook. Lo que no
 * trae zona se lee como hora de Colombia. Una fecha que no se entiende es `null`:
 * un recaudo sin fechas legibles no debe tumbar el pago.
 */
export function aFecha(valor: unknown): Fecha | null {
  const texto = aTexto(valor)?.trim()
  if (!texto) return null

  const partes = FECHA_DE_FACTUS.exec(texto)
  if (partes) {
    const [, dia, mes, anio, hora, minuto, segundo = '00', meridiano] = partes
    let horas = Number(hora)
    if (meridiano) {
      const tarde = meridiano.toLowerCase() === 'p'
      if (tarde && horas < 12) horas += 12
      if (!tarde && horas === 12) horas = 0
    }
    const reloj = String(horas).padStart(2, '0')
    return aIso(`${anio}-${mes}-${dia}T${reloj}:${minuto}:${segundo}${DESFASE_COLOMBIA}`)
  }

  const sinZona = SIN_ZONA.test(texto) && !CON_ZONA.test(texto)
  return aIso(sinZona ? `${texto.replace(' ', 'T')}${DESFASE_COLOMBIA}` : texto)
}

/** El `Retry-After` de un 429: segundos, o una fecha HTTP. */
function esperaDe(cabeceras: Headers): number | undefined {
  const valor = cabeceras.get('Retry-After')?.trim()
  if (!valor) return undefined
  if (/^\d+$/.test(valor)) return Number(valor)
  const fecha = Date.parse(valor)
  if (Number.isNaN(fecha)) return undefined
  return Math.max(0, Math.ceil((fecha - Date.now()) / 1000))
}

/** Los textos de `errors`, que en una validación del sandbox llega como `{ campo: ['texto'] }`. */
function detallesDe(errores: unknown): string[] {
  if (typeof errores === 'string') return [errores]
  if (Array.isArray(errores)) return errores.flatMap(detallesDe)
  if (errores && typeof errores === 'object') return Object.values(errores).flatMap(detallesDe)
  return []
}

/** Probado en el sandbox: una validación trae `{ message, errors }` y un 404 `{ status, message, data: null }`. */
function mensajeDe(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const cuerpo = json as Record<string, unknown>
  const mensaje = aTexto(cuerpo.message) ?? aTexto(cuerpo.error)
  const detalle = detallesDe(cuerpo.errors).join(' ')
  return [mensaje, detalle].filter(Boolean).join(': ') || null
}

/**
 * 429 es `limite` y trae la espera; 5xx es `servidor`; 401 y 403 son `no_autorizado`;
 * 409 es `conflicto`; el resto de los 4xx, con 404 y 422 entre ellos, son `validacion`.
 */
function errorDe(
  status: number,
  cabeceras: Headers,
  json: unknown,
  censurar: (texto: string) => string,
): ErrorIntegracion {
  const detalle = mensajeDe(json)
  const mensaje = `Factus Pay respondió ${status}${detalle ? `: ${censurar(recortar(detalle))}` : ''}`
  if (status === 429) return new ErrorIntegracion(mensaje, 'factus_pay', 'limite', status, esperaDe(cabeceras))
  if (status >= 500) return new ErrorIntegracion(mensaje, 'factus_pay', 'servidor', status)
  if (status === 401 || status === 403) return new ErrorIntegracion(mensaje, 'factus_pay', 'no_autorizado', status)
  if (status === 409) return new ErrorIntegracion(mensaje, 'factus_pay', 'conflicto', status)
  return new ErrorIntegracion(mensaje, 'factus_pay', 'validacion', status)
}

/** Un cuerpo que no se entiende se reintenta: puede ser una caída pasajera. */
const respuestaRara = (status: number, porque: string) =>
  new ErrorIntegracion(
    `Factus Pay respondió ${status} con un cuerpo que no se entiende: ${porque}`,
    'factus_pay',
    'servidor',
    status,
  )

function aCobro(json: unknown, status: number, referencia: string, monto?: Pesos): Cobro {
  const data = (json as { data?: unknown } | null)?.data
  if (!data || typeof data !== 'object') throw respuestaRara(status, 'no viene `data`')
  const recaudo = data as Record<string, unknown>
  const pesos = aPesos(recaudo.amount) ?? monto
  if (pesos === undefined) throw respuestaRara(status, 'no viene `data.amount`')
  return {
    referencia: aTexto(recaudo.reference_code) ?? referencia,
    monto: pesos,
    estado: aEstado(recaudo.status),
    qrBase64: aQr(recaudo.qr),
    llaveBreB: aTexto(recaudo.breb_key),
    qrExpiraEn: aFecha(recaudo.qr_expires_at),
    recaudadoEn: aFecha(recaudo.collected_at),
  }
}

function leerJson(texto: string): unknown {
  if (texto.trim() === '') return null
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** El mensaje del fallo, nunca el objeto entero: podría arrastrar la petición y el token. */
function razonDe(causa: unknown): string {
  if (causa instanceof Error) return causa.name === 'TimeoutError' ? 'se agotó el tiempo' : causa.message
  return 'fallo desconocido'
}

export function crearCobrosFactusPay(opciones: OpcionesFactusPay): CobrosFactusPay {
  const base = sinBarraFinal(opciones.url)
  const hacerFetch = opciones.fetch ?? globalThis.fetch
  const tiempoLimiteMs = opciones.tiempoLimiteMs ?? TIEMPO_LIMITE_MS

  /** El token no sale en ningún mensaje, ni aunque Factus Pay lo repita en el suyo. */
  const censurar = (texto: string) =>
    opciones.token === '' ? texto : texto.split(opciones.token).join('[token]')

  async function pedir(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown) {
    let respuesta: Response
    try {
      respuesta = await hacerFetch(`${base}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${opciones.token}`,
          Accept: 'application/json',
          'User-Agent': opciones.userAgent,
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoLimiteMs),
      })
    } catch (causa) {
      // Sin conexión, DNS caído o se agotó el tiempo: se puede reintentar.
      throw new ErrorIntegracion(
        `No se pudo hablar con Factus Pay: ${censurar(recortar(razonDe(causa)))}`,
        'factus_pay',
        'red',
      )
    }

    let texto: string
    try {
      texto = await respuesta.text()
    } catch (causa) {
      throw new ErrorIntegracion(
        `Factus Pay cortó la respuesta: ${censurar(recortar(razonDe(causa)))}`,
        'factus_pay',
        'red',
      )
    }

    const json = leerJson(texto)
    // Factus Pay responde 201 cuando el recaudo es nuevo y 200 cuando ya existía.
    if (respuesta.status !== 200 && respuesta.status !== 201) {
      throw errorDe(respuesta.status, respuesta.headers, json, censurar)
    }
    return { status: respuesta.status, json }
  }

  async function crearCobro(solicitud: SolicitudCobro): Promise<Cobro> {
    const { status, json } = await pedir('POST', '/v1/collections', {
      reference_code: solicitud.referencia,
      amount: solicitud.monto,
      expiration: solicitud.expiraEnSegundos,
    })
    return aCobro(json, status, solicitud.referencia, solicitud.monto)
  }

  async function consultarCobro(referencia: string): Promise<Cobro> {
    const { status, json } = await pedir('GET', `/v1/collections/${encodeURIComponent(referencia)}`)
    return aCobro(json, status, referencia)
  }

  return { crearCobro, consultarCobro }
}
