// Las órdenes de openapi.yaml: cada función llama a su ruta con el ID token de Firebase.

import { comoErrorDatos, ErrorDatos, type Ordenes } from './fuente'

export interface OpcionesApi {
  /** El ID token de la sesión actual. Lanza si nadie ha entrado. */
  obtenerToken: () => Promise<string>
  /** En el navegador, `fetch`. En las pruebas, uno falso. */
  pedir?: typeof fetch
  base?: string
}

/** Lee el `{ codigo, mensaje }` del backend. Cualquier otra respuesta se trata según su estado HTTP. */
async function errorDeRespuesta(respuesta: Response): Promise<ErrorDatos> {
  try {
    return comoErrorDatos(await respuesta.clone().json())
  } catch {
    if (respuesta.status === 401) return new ErrorDatos('NO_AUTORIZADO')
    if (respuesta.status === 403) return new ErrorDatos('SIN_PERMISO')
    return new ErrorDatos('SERVICIO_NO_DISPONIBLE', `La API respondió ${respuesta.status}`)
  }
}

export function crearOrdenesApi({ obtenerToken, pedir = (...a) => fetch(...a), base = '' }: OpcionesApi): Ordenes {
  async function llamar(metodo: string, ruta: string, cuerpo?: unknown): Promise<Response> {
    let respuesta: Response
    try {
      const token = await obtenerToken()
      respuesta = await pedir(`${base}/api${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      })
    } catch (error) {
      throw comoErrorDatos(error)
    }
    if (!respuesta.ok) throw await errorDeRespuesta(respuesta)
    return respuesta
  }

  async function json<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const respuesta = await llamar(metodo, ruta, cuerpo)
    try {
      return (await respuesta.json()) as T
    } catch (error) {
      throw comoErrorDatos(error)
    }
  }

  const pdf = async (ruta: string) => (await llamar('GET', ruta)).blob()
  const mesa = (token: string) => `/mesas/${encodeURIComponent(token)}`
  const pago = (token: string, pagoId: string) => `${mesa(token)}/pagos/${encodeURIComponent(pagoId)}`
  const producto = (id: string) => `/productos/${encodeURIComponent(id)}`
  const nota = (id: string) => `/notas/${encodeURIComponent(id)}`
  const restaurante = (id: string) => `/restaurantes/${encodeURIComponent(id)}`

  return {
    agregarLineas: (token, solicitud) => json('POST', `${mesa(token)}/lineas`, solicitud),
    confirmarLineas: (token, solicitud) => json('POST', `${mesa(token)}/lineas/confirmar`, solicitud),
    rechazarLineas: (token, solicitud) => json('POST', `${mesa(token)}/lineas/rechazar`, solicitud),
    anularLineas: (token, solicitud) => json('POST', `${mesa(token)}/lineas/anular`, solicitud),
    avanzarLinea: (token, lineaId, solicitud) => json('POST', `${mesa(token)}/lineas/${encodeURIComponent(lineaId)}/estado`, solicitud),
    dividirEnPartesIguales: (token, solicitud) => json('PUT', `${mesa(token)}/division`, solicitud),
    quitarDivision: (token) => json('DELETE', `${mesa(token)}/division`),
    crearPago: (token, solicitud) => json('POST', `${mesa(token)}/pagos`, solicitud),
    verificarPago: (token, pagoId) => json('POST', `${pago(token, pagoId)}/verificar`),
    cancelarPago: (token, pagoId) => json('POST', `${pago(token, pagoId)}/cancelar`),
    descargarFacturaPdf: (token, pagoId) => pdf(`${pago(token, pagoId)}/factura/pdf`),
    enviarFacturaPorCorreo: (token, pagoId, solicitud) => json('POST', `${pago(token, pagoId)}/factura/correo`, solicitud),
    reintentarFactura: (token, pagoId, solicitud) => json('POST', `${pago(token, pagoId)}/factura/reintentar`, solicitud),
    liberarMesa: (token) => json('POST', `${mesa(token)}/liberar`),
    crearRestaurante: (nuevo) => json('POST', '/restaurantes', nuevo),
    actualizarRestaurante: (id, cambios) => json('PATCH', restaurante(id), cambios),
    agregarMesas: (id, solicitud) => json('POST', `${restaurante(id)}/mesas`, solicitud),
    crearPersonal: (id, nuevo) => json('POST', `${restaurante(id)}/personal`, nuevo),
    actualizarPersonal: (id, uid, cambios) => json('PATCH', `${restaurante(id)}/personal/${encodeURIComponent(uid)}`, cambios),
    crearProducto: (nuevo) => json('POST', '/productos', nuevo),
    actualizarProducto: (id, cambios) => json('PATCH', producto(id), cambios),
    borrarProducto: async (id) => {
      await llamar('DELETE', producto(id))
    },
    crearNota: (pagoId, solicitud) => json('POST', `/pagos/${encodeURIComponent(pagoId)}/notas`, solicitud),
    verificarNota: (id) => json('POST', `${nota(id)}/verificar`),
    reintentarNota: (id, solicitud) => json('POST', `${nota(id)}/reintentar`, solicitud),
    marcarDevolucionHecha: (id) => json('POST', `${nota(id)}/devolucion`),
    enviarNotaPorCorreo: (id, solicitud) => json('POST', `${nota(id)}/correo`, solicitud),
    descargarNotaPdf: (id) => pdf(`${nota(id)}/pdf`),
  }
}
