// Conexión con Factus v2: token OAuth, rangos de numeración y errores.
// No sabe nada de facturas: eso está en cliente.ts.

import { ErrorIntegracion } from '../contratos/reglas'
import type { TipoNota } from '../contratos/tipos'

export interface ConfigFactus {
  /** Sin `/` al final, por ejemplo https://api-sandbox.factus.com.co */
  url: string
  clientId: string
  clientSecret: string
  usuario: string
  clave: string
  /** Sin él, Cloudflare responde 403. */
  userAgent: string
  /** Para las pruebas. Por defecto, el `fetch` global. */
  fetch?: typeof fetch
  /** Para las pruebas. Por defecto, `Date.now`. */
  ahora?: () => number
  /** Por defecto, 30 segundos. */
  esperaMaximaMs?: number
}

export type Rango = 'factura' | TipoNota

/** Lo que Factus llama `filter[document]` en los rangos de numeración. */
export const DOCUMENTO_RANGO: Record<Rango, string> = { factura: '21', credito: '22', debito: '23' }

/** El token se renueva cuando le falta esto para vencer, o la mitad de su duración si es más corta. */
export const MARGEN_TOKEN_MS = 60_000

export type Metodo = 'GET' | 'POST' | 'DELETE'

export interface OpcionesPedido {
  cuerpo?: unknown
  consulta?: Record<string, string>
}

export interface ConexionFactus {
  /** Llama a la API con el token vigente. Si Factus responde 401, pide otro token y repite una vez. */
  pedir<T = unknown>(metodo: Metodo, ruta: string, opciones?: OpcionesPedido): Promise<T>
  /** El id del rango activo. Se consulta una vez y queda en memoria. */
  rangoActivo(rango: Rango): Promise<number>
  /** Para cuando Factus ya no acepta el rango guardado. */
  olvidarRango(rango: Rango): void
}

interface RespuestaToken {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface Token {
  acceso: string
  renovacion: string | null
  renovarDesde: number
}

interface RangoFactus {
  id: number
  is_active?: boolean | number
  is_expired?: boolean | number
}

const MENSAJE_MAXIMO = 500

export function crearConexionFactus(config: ConfigFactus): ConexionFactus {
  const pedirHttp = config.fetch ?? fetch
  const ahora = config.ahora ?? Date.now
  const esperaMaximaMs = config.esperaMaximaMs ?? 30_000
  let token: Token | null = null
  let tokenEnCamino: Promise<Token> | null = null
  const rangos = new Map<Rango, Promise<number>>()

  async function llamar(url: string, init: RequestInit): Promise<unknown> {
    let respuesta: Response
    try {
      respuesta = await pedirHttp(url, {
        ...init,
        headers: { Accept: 'application/json', 'User-Agent': config.userAgent, ...init.headers },
        signal: AbortSignal.timeout(esperaMaximaMs),
      })
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error)
      throw new ErrorIntegracion(`Sin conexión con Factus: ${motivo}`, 'factus', 'red')
    }
    const texto = await respuesta.text().catch(() => '')
    const cuerpo = leerJson(texto)
    if (!respuesta.ok) throw errorDeRespuesta(respuesta, cuerpo, texto, ahora())
    return cuerpo
  }

  async function pedirToken(formulario: Record<string, string>): Promise<Token> {
    let cuerpo: Partial<RespuestaToken> | null
    try {
      cuerpo = (await llamar(`${config.url}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...formulario }),
      })) as Partial<RespuestaToken> | null
    } catch (error) {
      // OAuth responde 400 con credenciales o refresh_token inválidos: no es un error de los datos.
      if (error instanceof ErrorIntegracion && error.tipo === 'validacion') {
        throw new ErrorIntegracion(error.message, 'factus', 'no_autorizado', error.status)
      }
      throw error
    }
    if (!cuerpo?.access_token || !(Number(cuerpo.expires_in) > 0)) {
      throw new ErrorIntegracion('Factus respondió un token sin access_token o expires_in', 'factus', 'servidor')
    }
    const duracionMs = Number(cuerpo.expires_in) * 1000
    return {
      acceso: cuerpo.access_token,
      renovacion: cuerpo.refresh_token ?? null,
      renovarDesde: ahora() + duracionMs - Math.min(MARGEN_TOKEN_MS, duracionMs / 2),
    }
  }

  async function tokenNuevo(anterior: Token | null): Promise<Token> {
    if (anterior?.renovacion) {
      try {
        return await pedirToken({ grant_type: 'refresh_token', refresh_token: anterior.renovacion })
      } catch (error) {
        // Un refresh_token vencido o revocado no es un fallo: se entra otra vez con la contraseña.
        if (!(error instanceof ErrorIntegracion) || error.reintentable) throw error
      }
    }
    return pedirToken({ grant_type: 'password', username: config.usuario, password: config.clave })
  }

  /** Varias llamadas a la vez comparten la misma petición de token. */
  async function tokenVigente(): Promise<string> {
    if (token && ahora() < token.renovarDesde) return token.acceso
    tokenEnCamino ??= tokenNuevo(token).finally(() => {
      tokenEnCamino = null
    })
    token = await tokenEnCamino
    return token.acceso
  }

  async function pedir<T>(metodo: Metodo, ruta: string, opciones: OpcionesPedido = {}): Promise<T> {
    const consulta = opciones.consulta ? `?${new URLSearchParams(opciones.consulta)}` : ''
    const enviar = (acceso: string) =>
      llamar(`${config.url}${ruta}${consulta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${acceso}`,
          ...(opciones.cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      }) as Promise<T>
    const acceso = await tokenVigente()
    try {
      return await enviar(acceso)
    } catch (error) {
      if (!(error instanceof ErrorIntegracion) || error.status !== 401) throw error
      // Factus pudo revocar el token antes de tiempo: se entra otra vez y se repite una sola vez.
      if (token?.acceso === acceso) token = null
      return enviar(await tokenVigente())
    }
  }

  async function buscarRango(rango: Rango): Promise<number> {
    const cuerpo = await pedir<{ data?: unknown }>('GET', '/v2/numbering-ranges', {
      consulta: { 'filter[document]': DOCUMENTO_RANGO[rango], 'filter[is_active]': '1' },
    })
    // POR CONFIRMAR: si la lista viene en `data` o en `data.data`, con la paginación al lado.
    const datos = cuerpo?.data as { data?: unknown } | unknown[] | undefined
    const lista = (Array.isArray(datos) ? datos : Array.isArray(datos?.data) ? datos.data : []) as RangoFactus[]
    const activo = lista.find((r) => Boolean(r.is_active ?? true) && !r.is_expired)
    if (!activo) {
      throw new ErrorIntegracion(
        `Factus no tiene un rango activo de documento ${DOCUMENTO_RANGO[rango]}`,
        'factus',
        'validacion',
      )
    }
    return activo.id
  }

  return {
    pedir,
    rangoActivo(rango) {
      let id = rangos.get(rango)
      if (!id) {
        id = buscarRango(rango)
        // Un fallo no se guarda: la próxima llamada vuelve a consultar.
        id.catch(() => rangos.delete(rango))
        rangos.set(rango, id)
      }
      return id
    },
    olvidarRango: (rango) => void rangos.delete(rango),
  }
}

function leerJson(texto: string): unknown {
  if (!texto) return null
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** Convierte una respuesta fallida de Factus en el error del contrato. */
export function errorDeRespuesta(respuesta: Response, cuerpo: unknown, texto: string, ahora: number) {
  const { status } = respuesta
  const tipo: ErrorIntegracion['tipo'] =
    status === 409
      ? 'conflicto'
      : status === 429
        ? 'limite'
        : status >= 500
          ? 'servidor'
          : status === 401 || status === 403
            ? 'no_autorizado'
            : 'validacion'
  const detalle = detalleDeError(cuerpo) ?? (cuerpo === null ? texto.replace(/\s+/g, ' ').trim() : '')
  const mensaje = `Factus respondió ${status}${detalle ? `: ${detalle}` : ''}`.slice(0, MENSAJE_MAXIMO)
  const esperar = status === 429 ? segundosDeEspera(respuesta.headers.get('Retry-After'), ahora) : undefined
  return new ErrorIntegracion(mensaje, 'factus', tipo, status, esperar)
}

/** Factus responde `{ message, errors }`, con `errors` como objeto de listas o como lista. */
function detalleDeError(cuerpo: unknown): string | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const { message, errors } = cuerpo as { message?: unknown; errors?: unknown }
  const partes: string[] = []
  if (typeof message === 'string' && message) partes.push(message)
  if (Array.isArray(errors)) partes.push(...errors.map(String))
  else if (errors && typeof errors === 'object') {
    for (const [campo, lista] of Object.entries(errors)) {
      partes.push(`${campo}: ${Array.isArray(lista) ? lista.join(', ') : String(lista)}`)
    }
  }
  return partes.length > 0 ? partes.join('. ') : null
}

/** `Retry-After` puede venir en segundos o como fecha HTTP. */
export function segundosDeEspera(valor: string | null, ahora: number): number | undefined {
  if (!valor) return undefined
  const segundos = Number(valor)
  if (Number.isFinite(segundos) && segundos >= 0) return Math.ceil(segundos)
  const fecha = Date.parse(valor)
  return Number.isNaN(fecha) ? undefined : Math.max(0, Math.ceil((fecha - ahora) / 1000))
}
