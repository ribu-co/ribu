// La API de openapi.yaml, sobre Hono. Aquí solo se autentica, se lee el cuerpo y se responde: la lógica está en los servicios.

import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { ErrorIntegracion, ESTADO_HTTP_POR_ERROR } from '../contratos/reglas'
import type { ErrorApi, PdfFactura, Rol } from '../contratos/tipos'
import * as administracion from './administracion'
import type { Identidad } from './auth'
import { ErrorRibu, fallar } from './errores'
import * as facturas from './facturas'
import type { Contexto } from './modelo'
import * as notas from './notas'
import * as pagos from './pagos'
import * as pedidos from './pedidos'
import { leerSolicitudSemilla, sembrar } from './semilla'
import * as leer from './validacion'
import { recibirWebhook } from './webhook'

export const ENCABEZADO_SEMILLA = 'x-semilla-clave'

export interface OpcionesApi {
  /** El secreto SEMILLA_CLAVE. Se lee al usarlo. */
  claveSemilla: () => string
  /** De dónde salen los links de las mesas. */
  origenWeb: () => string
  /** Solo con mocks: marca un cobro como pagado y dispara el webhook, sin banco ni QR. */
  simularPago?: (ctx: Contexto, referencia: string) => Promise<void>
}

/** Compara resúmenes: `timingSafeEqual` revienta con longitudes distintas y compararlas filtraría el largo. */
export function clavesIguales(esperada: string, recibida: string) {
  if (esperada === '') return false
  const resumen = (texto: string) => createHash('sha256').update(texto, 'utf8').digest()
  return timingSafeEqual(resumen(esperada), resumen(recibida))
}

const CUALQUIER_MESA: Rol[] = ['cliente', 'mesero', 'admin']
const MESERO: Rol[] = ['mesero', 'admin']
const COCINA: Rol[] = ['cocina', 'mesero', 'admin']
const ADMIN: Rol[] = ['admin']
const GESTION: Rol[] = ['plataforma', 'admin']

function respuestaDeError(c: Context, codigo: ErrorApi['codigo'], mensaje: string) {
  const cuerpo: ErrorApi = { codigo, mensaje }
  return c.json(cuerpo, ESTADO_HTTP_POR_ERROR[codigo] as 400)
}

export function respuestaPdf(pdf: PdfFactura) {
  const nombre = pdf.nombreArchivo.replace(/[^A-Za-z0-9._-]/g, '_')
  return new Response(Buffer.from(pdf.base64, 'base64'), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}"` },
  })
}

export function crearApi(ctx: Contexto, opciones: OpcionesApi) {
  const app = new Hono()

  // Detrás de Hosting, una respuesta cacheable podría llegarle a otra persona.
  app.use('*', async (c, siguiente) => {
    await siguiente()
    c.header('Cache-Control', 'no-store')
  })

  async function identidadDe(c: Context): Promise<Identidad> {
    const cabecera = c.req.header('authorization') ?? ''
    const [esquema, token] = cabecera.split(' ')
    if (esquema !== 'Bearer' || !token) return fallar('NO_AUTORIZADO', 'Falta la sesión')
    return ctx.auth.verificar(token)
  }

  const cuerpo = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json()
    } catch {
      return fallar('CUERPO_INVALIDO', 'El cuerpo debe ser JSON')
    }
  }

  /** Un id con caracteres raros no existe, y no llega a una ruta de Firestore. */
  const id = (c: Context, nombre: string) => {
    const valor = c.req.param(nombre) ?? ''
    return leer.idSeguro(valor) ? valor : fallar('NO_ENCONTRADO', 'No existe')
  }

  type Accion = (c: Context, identidad: Identidad) => Promise<Response>

  const para = (roles: readonly Rol[], accion: Accion) => async (c: Context) => {
    const identidad = await identidadDe(c)
    if (!roles.includes(identidad.rol)) fallar('SIN_PERMISO', 'Tu cuenta no puede hacer esto')
    return accion(c, identidad)
  }

  // Pedido

  app.post('/api/mesas/:token/lineas', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pedidos.agregarLineas(ctx, yo, id(c, 'token'), leer.leerSolicitudLineas(await cuerpo(c))), 201)))
  app.post('/api/mesas/:token/lineas/confirmar', para(MESERO, async (c, yo) =>
    c.json(await pedidos.confirmarLineas(ctx, yo, id(c, 'token'), leer.leerIdsLineas(await cuerpo(c))))))
  app.post('/api/mesas/:token/lineas/rechazar', para(MESERO, async (c, yo) =>
    c.json(await pedidos.rechazarLineas(ctx, yo, id(c, 'token'), leer.leerMotivoLineas(await cuerpo(c))))))
  app.post('/api/mesas/:token/lineas/anular', para(MESERO, async (c, yo) =>
    c.json(await pedidos.anularLineas(ctx, yo, id(c, 'token'), leer.leerMotivoLineas(await cuerpo(c))))))
  app.post('/api/mesas/:token/lineas/:lineaId/estado', para(COCINA, async (c, yo) =>
    c.json(await pedidos.avanzarLinea(ctx, yo, id(c, 'token'), id(c, 'lineaId'), leer.leerEstadoLinea(await cuerpo(c))))))
  app.put('/api/mesas/:token/division', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pedidos.dividirEnPartesIguales(ctx, yo, id(c, 'token'), leer.leerDivision(await cuerpo(c)).partes))))
  app.delete('/api/mesas/:token/division', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pedidos.quitarLaDivision(ctx, yo, id(c, 'token')))))
  app.post('/api/mesas/:token/liberar', para(MESERO, async (c, yo) =>
    c.json(await pedidos.liberarMesa(ctx, yo, id(c, 'token')))))

  // Pago

  app.post('/api/mesas/:token/pagos', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pagos.crearPago(ctx, yo, id(c, 'token'), leer.leerSolicitudPago(await cuerpo(c))), 201)))
  app.post('/api/mesas/:token/pagos/:pagoId/verificar', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pagos.verificarPago(ctx, yo, id(c, 'token'), id(c, 'pagoId')))))
  app.post('/api/mesas/:token/pagos/:pagoId/cancelar', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await pagos.cancelarPago(ctx, yo, id(c, 'token'), id(c, 'pagoId')))))

  // Factura

  app.get('/api/mesas/:token/pagos/:pagoId/factura/pdf', para(CUALQUIER_MESA, async (c, yo) =>
    respuestaPdf(await facturas.descargarFacturaPdf(ctx, yo, id(c, 'token'), id(c, 'pagoId')))))
  app.post('/api/mesas/:token/pagos/:pagoId/factura/correo', para(CUALQUIER_MESA, async (c, yo) =>
    c.json(await facturas.enviarFacturaPorCorreo(ctx, yo, id(c, 'token'), id(c, 'pagoId'), leer.leerCorreo(await cuerpo(c)).correo))))
  app.post('/api/mesas/:token/pagos/:pagoId/factura/reintentar', para(MESERO, async (c, yo) =>
    c.json(await facturas.reintentarFactura(ctx, yo, id(c, 'token'), id(c, 'pagoId'), leer.leerReintento(await cuerpo(c))))))

  // Plataforma

  app.post('/api/restaurantes', para(['plataforma'], async (c) =>
    c.json(await administracion.crearRestaurante(ctx, leer.leerNuevoRestaurante(await cuerpo(c))), 201)))
  app.patch('/api/restaurantes/:restauranteId', para(GESTION, async (c, yo) =>
    c.json(await administracion.actualizarRestaurante(ctx, yo, id(c, 'restauranteId'), leer.leerCambiosRestaurante(await cuerpo(c))))))
  app.post('/api/restaurantes/:restauranteId/mesas', para(GESTION, async (c, yo) =>
    c.json(await administracion.agregarMesas(ctx, yo, id(c, 'restauranteId'), leer.leerMesas(await cuerpo(c)).cantidad), 201)))
  app.post('/api/restaurantes/:restauranteId/personal', para(GESTION, async (c, yo) =>
    c.json(await administracion.crearPersonal(ctx, yo, id(c, 'restauranteId'), leer.leerNuevoPersonal(await cuerpo(c))), 201)))
  app.patch('/api/restaurantes/:restauranteId/personal/:uid', para(GESTION, async (c, yo) =>
    c.json(await administracion.actualizarPersonal(ctx, yo, id(c, 'restauranteId'), id(c, 'uid'), leer.leerCambiosPersonal(await cuerpo(c))))))

  // Carta

  app.post('/api/productos', para(ADMIN, async (c, yo) =>
    c.json(await administracion.crearProducto(ctx, yo, leer.leerNuevoProducto(await cuerpo(c))), 201)))
  app.patch('/api/productos/:productoId', para(COCINA, async (c, yo) =>
    c.json(await administracion.actualizarProducto(ctx, yo, id(c, 'productoId'), leer.leerCambiosProducto(await cuerpo(c))))))
  app.delete('/api/productos/:productoId', para(ADMIN, async (c, yo) => {
    await administracion.borrarProducto(ctx, yo, id(c, 'productoId'))
    return c.body(null, 204)
  }))

  // Notas

  app.post('/api/pagos/:pagoId/notas', para(ADMIN, async (c, yo) =>
    c.json(await notas.crearNota(ctx, yo, id(c, 'pagoId'), leer.leerSolicitudNota(await cuerpo(c))), 201)))
  app.post('/api/notas/:notaId/verificar', para(ADMIN, async (c, yo) =>
    c.json(await notas.verificarNota(ctx, yo, id(c, 'notaId')))))
  app.post('/api/notas/:notaId/reintentar', para(ADMIN, async (c, yo) =>
    c.json(await notas.reintentarNota(ctx, yo, id(c, 'notaId'), leer.leerReintento(await cuerpo(c))))))
  app.post('/api/notas/:notaId/devolucion', para(ADMIN, async (c, yo) =>
    c.json(await notas.marcarDevolucionHecha(ctx, yo, id(c, 'notaId')))))
  app.post('/api/notas/:notaId/correo', para(ADMIN, async (c, yo) =>
    c.json(await notas.enviarNotaPorCorreo(ctx, yo, id(c, 'notaId'), leer.leerCorreo(await cuerpo(c)).correo))))
  app.get('/api/notas/:notaId/pdf', para(ADMIN, async (c, yo) =>
    respuestaPdf(await notas.descargarNotaPdf(ctx, yo, id(c, 'notaId')))))

  // Webhook: sin sesión. Lo protege la llave que valida `leerWebhook`.

  app.post('/api/webhooks/factus-pay/:restauranteId', async (c) => {
    const texto = await c.req.text()
    let datos: unknown = null
    try {
      datos = JSON.parse(texto)
    } catch {
      // leerWebhook valida primero la llave y luego rechaza el cuerpo.
    }
    await recibirWebhook(ctx, c.req.query('key') ?? null, datos)
    return c.json({ recibido: true })
  })

  // Interno: protegido por SEMILLA_CLAVE, no por una sesión.

  const exigirClaveSemilla = (c: Context) => {
    if (!clavesIguales(opciones.claveSemilla(), c.req.header(ENCABEZADO_SEMILLA) ?? '')) {
      fallar('NO_AUTORIZADO', 'Clave incorrecta')
    }
  }

  app.post('/api/interno/semilla', async (c) => {
    exigirClaveSemilla(c)
    const solicitud = leerSolicitudSemilla(await cuerpo(c))
    return c.json(await sembrar(ctx, solicitud, opciones.origenWeb()))
  })

  const { simularPago } = opciones
  if (simularPago) {
    app.post('/api/interno/mock/cobros/:referencia/pagar', async (c) => {
      exigirClaveSemilla(c)
      await simularPago(ctx, id(c, 'referencia'))
      return c.json({ simulado: true })
    })
  }

  app.notFound((c) => respuestaDeError(c, 'NO_ENCONTRADO', 'Esa ruta no existe'))

  app.onError((error, c) => {
    if (error instanceof ErrorRibu) return respuestaDeError(c, error.codigo, error.message)
    // Ningún detalle interno sale de aquí. Los clientes de Factus ya censuran sus mensajes.
    console.error('Error en la API', error instanceof ErrorIntegracion ? error.message : error.name)
    return respuestaDeError(c, 'SERVICIO_NO_DISPONIBLE', 'El servicio no está disponible. Intenta de nuevo.')
  })

  return app
}
