// Órdenes sobre la factura de un pago: PDF, correo y corrección de un rechazo.

import { puedePasar, TRANSICIONES_FACTURA } from '../contratos/reglas'
import type { Factura, PdfFactura, SolicitudReintentoFactura } from '../contratos/tipos'
import { esPersonal, type Identidad } from './auth'
import { ponerResumen } from './cuenta'
import { pedirCorreo } from './documentos'
import { fallar } from './errores'
import { iso, rutaReferencia, sumarSegundos, type Contexto, type CuentaDoc, type PagoDoc, type Referencia } from './modelo'
import { correoInicial, ESPERA_RESPALDO_SEGUNDOS, leerPagoDeMesa, rutaFactura, rutaPago } from './pagos'
import { rutaCuenta } from './pedidos'

async function facturaVisible(ctx: Contexto, identidad: Identidad, token: string, pagoId: string) {
  const pago = await leerPagoDeMesa(ctx, identidad, token, pagoId)
  const factura = await ctx.db.leer<Factura>(rutaFactura(pago.restauranteId, pagoId))
  if (!factura) return fallar('NO_ENCONTRADO', 'Esa factura no existe')
  if (factura.pagadorUid !== identidad.uid && !esPersonal(identidad.rol)) {
    return fallar('SIN_PERMISO', 'Solo quien pagó ve su factura')
  }
  return { pago, factura }
}

export async function descargarFacturaPdf(ctx: Contexto, identidad: Identidad, token: string, pagoId: string): Promise<PdfFactura> {
  const { factura } = await facturaVisible(ctx, identidad, token, pagoId)
  if (factura.estado !== 'emitida' || !factura.datos) return fallar('FACTURA_NO_DISPONIBLE', 'La factura aún no está emitida')
  return ctx.facturacion.descargarPdf(factura.datos.numero)
}

export async function enviarFacturaPorCorreo(ctx: Contexto, identidad: Identidad, token: string, pagoId: string, correo: string) {
  const { pago, factura } = await facturaVisible(ctx, identidad, token, pagoId)
  if (factura.estado !== 'emitida' || !factura.datos) return fallar('FACTURA_NO_DISPONIBLE', 'La factura aún no está emitida')
  await pedirCorreo(ctx, { tipo: 'pago', restauranteId: pago.restauranteId, id: pagoId }, correo)
  return (await ctx.db.leer<Factura>(rutaFactura(pago.restauranteId, pagoId))) as Factura
}

export async function reintentarFactura(ctx: Contexto, identidad: Identidad, token: string, pagoId: string, solicitud: SolicitudReintentoFactura) {
  const pagoLeido = await leerPagoDeMesa(ctx, identidad, token, pagoId)
  const { restauranteId } = pagoLeido
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaFactura(restauranteId, pagoId)
    const factura = await tx.leer<Factura>(ruta)
    const referencia = await tx.leer<Referencia>(rutaReferencia(pagoId))
    const pago = await tx.leer<PagoDoc>(rutaPago(restauranteId, pagoId))
    if (!factura || !referencia || !pago) return fallar('NO_ENCONTRADO', 'Esa factura no existe')
    if (!puedePasar(TRANSICIONES_FACTURA, factura.estado, 'en_proceso') || factura.estado !== 'rechazada') {
      return fallar('TRANSICION_INVALIDA', 'Solo se reintenta una factura rechazada')
    }
    if (referencia.pendienteEliminar) {
      return fallar('TRANSICION_INVALIDA', 'Factus aún no elimina el rechazo: se está reintentando')
    }
    const cambios: Factura = {
      ...factura,
      estado: 'en_proceso',
      ultimoError: null,
      comprador: solicitud.comprador ?? factura.comprador,
      correo: solicitud.comprador ? correoInicial(solicitud.comprador.correo) : factura.correo,
    }
    tx.guardar(ruta, cambios)
    tx.actualizar(rutaReferencia(pagoId), { reintentarEn: iso(sumarSegundos(ctx.ahora(), ESPERA_RESPALDO_SEGUNDOS)) })
    pago.estadoFactura = 'en_proceso'
    tx.actualizar(rutaPago(restauranteId, pagoId), { estadoFactura: 'en_proceso' })
    const cuenta = await tx.leer<CuentaDoc>(rutaCuenta(restauranteId, pago.cuentaId))
    if (cuenta) {
      ponerResumen(cuenta, pago)
      tx.actualizar(rutaCuenta(restauranteId, pago.cuentaId), { pagos: cuenta.pagos })
    }
    return cambios
  })
}
