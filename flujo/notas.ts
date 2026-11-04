// Notas crédito y débito. Solo el administrador las crea, y solo sobre una factura emitida.

import { ErrorIntegracion, MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO, puedePasar, saldoAcreditable, TRANSICIONES_FACTURA } from '../contratos/reglas'
import type { Cobro, Factura, LineaFactura, Nota, PdfFactura, PropinaFactura, ResumenNota, SolicitudNotaNueva, SolicitudReintentoFactura } from '../contratos/tipos'
import type { Identidad } from './auth'
import type { Transaccion } from './base-datos'
import { pedirCorreo, rutaNota } from './documentos'
import { ErrorRibu, fallar } from './errores'
import { iso, referenciaNueva, rutaReferencia, sumarSegundos, type Contexto, type PagoDoc, type Referencia } from './modelo'
import { correoInicial, ESPERA_RESPALDO_SEGUNDOS, reservarConsulta, rutaFactura, rutaPago } from './pagos'
import { COBRO_EXPIRACION_SEGUNDOS } from '../contratos/reglas'
import { lineasDeNota, lineasDePago, propinaDePago, totalDeNota } from './solicitudes'

const resumenDeNota = ({ id, tipo, numero, total, estado }: Nota): ResumenNota => ({ id, tipo, numero, total, estado })

const restauranteDe = (identidad: Identidad) =>
  identidad.restauranteId ?? fallar('SIN_PERMISO', 'Solo el administrador del restaurante puede hacer esto')

function ponerResumenNota(tx: Transaccion, factura: Factura, nota: Nota) {
  const notas = factura.notas.map((n) => (n.id === nota.id ? resumenDeNota(nota) : n))
  tx.actualizar(rutaFactura(nota.restauranteId, nota.pagoId), { notas })
}

async function leerNota(ctx: Contexto, identidad: Identidad, notaId: string) {
  const restauranteId = restauranteDe(identidad)
  const nota = await ctx.db.leer<Nota>(rutaNota(restauranteId, notaId))
  return nota ?? fallar('NO_ENCONTRADO', 'Esa nota no existe')
}

export async function crearNota(ctx: Contexto, identidad: Identidad, pagoId: string, solicitud: SolicitudNotaNueva) {
  const restauranteId = restauranteDe(identidad)
  const id = ctx.nuevoId()
  const ahora = ctx.ahora()

  const nota = await ctx.db.transaccion(async (tx) => {
    const pago = await tx.leer<PagoDoc>(rutaPago(restauranteId, pagoId))
    const factura = await tx.leer<Factura>(rutaFactura(restauranteId, pagoId))
    if (!pago || !factura) return fallar('NO_ENCONTRADO', 'Ese pago no existe')
    if (factura.estado !== 'emitida' || !factura.datos) return fallar('FACTURA_NO_DISPONIBLE', 'La factura no está emitida')

    let lineas: LineaFactura[]
    let propina: PropinaFactura | null = null
    let total: number
    if (solicitud.tipo === 'credito' && solicitud.concepto === 'anulacion') {
      lineas = lineasDePago(pago)
      propina = propinaDePago(pago)
      total = pago.total
    } else {
      const conLineas = solicitud as Extract<SolicitudNotaNueva, { lineas: unknown }>
      lineas = lineasDeNota(conLineas.lineas, pago.impuesto)
      total = totalDeNota(conLineas.lineas)
    }

    if (solicitud.tipo === 'credito' && total > saldoAcreditable(pago.total, factura.notas)) {
      fallar('NOTA_EXCEDE_FACTURA', 'La nota supera lo que queda por acreditar de la factura')
    }
    const medio = solicitud.tipo === 'debito' ? solicitud.medio : pago.medio
    const cobraPrimero = solicitud.tipo === 'debito' && medio === 'factus_pay'
    if (cobraPrimero && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)) {
      fallar('MONTO_FUERA_DE_RANGO', `Factus Pay cobra de ${MONTO_MINIMO_COBRO} a ${MONTO_MAXIMO_COBRO} pesos`)
    }

    const nueva: Nota = {
      id,
      tipo: solicitud.tipo,
      numero: null,
      total,
      estado: cobraPrimero ? 'sin_emitir' : 'en_proceso',
      concepto: solicitud.concepto,
      motivo: solicitud.motivo,
      restauranteId,
      pagoId,
      numeroFactura: factura.datos.numero,
      comprador: factura.comprador,
      lineas,
      impuesto: pago.impuesto,
      propina,
      medio,
      cobro: null,
      devolucion: solicitud.tipo === 'credito' ? 'pendiente' : 'no_aplica',
      datos: null,
      intentos: 0,
      ultimoError: null,
      correo: correoInicial(factura.comprador.correo),
      creadoPor: identidad.uid,
      creadaEn: iso(ahora),
      emitidaEn: null,
    }
    tx.guardar(rutaNota(restauranteId, id), nueva)
    tx.actualizar(rutaFactura(restauranteId, pagoId), { notas: [...factura.notas, resumenDeNota(nueva)] })
    tx.guardar(rutaReferencia(id), {
      ...referenciaNueva(restauranteId, 'nota'),
      reintentarEn: cobraPrimero ? null : iso(sumarSegundos(ahora, ESPERA_RESPALDO_SEGUNDOS)),
    })
    return nueva
  })

  if (nota.estado !== 'sin_emitir') return nota

  // Nota débito con Factus Pay: primero se cobra y la nota sale cuando entra el pago.
  try {
    const cobro = await ctx.cobros.crearCobro({ referencia: id, monto: nota.total, expiraEnSegundos: COBRO_EXPIRACION_SEGUNDOS })
    return await guardarCobroNota(ctx, nota, cobro)
  } catch (error) {
    console.error('crearCobro de nota falló', error instanceof Error ? error.message : 'error desconocido')
    await deshacerNota(ctx, nota)
    throw new ErrorRibu('SERVICIO_NO_DISPONIBLE', 'No se pudo generar el cobro. Intenta de nuevo.')
  }
}

async function guardarCobroNota(ctx: Contexto, nota: Nota, cobro: Cobro) {
  return ctx.db.transaccion(async (tx) => {
    tx.actualizar(rutaNota(nota.restauranteId, nota.id), { cobro })
    return { ...nota, cobro }
  })
}

/** El cobro no se creó, así que nadie vio un QR. La nota no llegó a existir. */
async function deshacerNota(ctx: Contexto, nota: Nota) {
  await ctx.db.transaccion(async (tx) => {
    const factura = await tx.leer<Factura>(rutaFactura(nota.restauranteId, nota.pagoId))
    if (factura) tx.actualizar(rutaFactura(nota.restauranteId, nota.pagoId), { notas: factura.notas.filter((n) => n.id !== nota.id) })
    tx.borrar(rutaNota(nota.restauranteId, nota.id))
    tx.borrar(rutaReferencia(nota.id))
  })
}

/** Lo llaman el webhook y `verificarNota`, ya con el cobro consultado. Repetirlo no cambia nada. */
export async function confirmarCobroNota(ctx: Contexto, restauranteId: string, notaId: string, cobro: Cobro) {
  const ahora = ctx.ahora()
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaNota(restauranteId, notaId)
    const nota = await tx.leer<Nota>(ruta)
    if (!nota) return null
    if (nota.estado !== 'sin_emitir') return nota
    if (cobro.estado !== 'paid' || cobro.monto !== nota.total) {
      console.warn('Cobro de nota sin confirmar: estado o monto distinto', notaId)
      return nota
    }
    const factura = await tx.leer<Factura>(rutaFactura(restauranteId, nota.pagoId))
    const pagada: Nota = { ...nota, cobro, estado: 'en_proceso' }
    tx.guardar(ruta, pagada)
    if (factura) ponerResumenNota(tx, factura, pagada)
    tx.actualizar(rutaReferencia(notaId), { reintentarEn: iso(sumarSegundos(ahora, ESPERA_RESPALDO_SEGUNDOS)) })
    return pagada
  })
}

const qrVencido = (cobro: Cobro, ahora: Date) => cobro.qrExpiraEn !== null && cobro.qrExpiraEn <= iso(ahora)

export async function verificarNota(ctx: Contexto, identidad: Identidad, notaId: string) {
  const nota = await leerNota(ctx, identidad, notaId)
  if (nota.estado !== 'sin_emitir' || !nota.cobro) return nota
  if (!(await reservarConsulta(ctx, notaId))) return nota
  try {
    const cobro = await ctx.cobros.consultarCobro(notaId)
    if (cobro.estado === 'paid') return (await confirmarCobroNota(ctx, nota.restauranteId, notaId, cobro)) ?? nota
    // Se renueva con la misma referencia y el mismo monto: la llave Bre-B se conserva.
    const vigente = qrVencido(cobro, ctx.ahora())
      ? await ctx.cobros.crearCobro({ referencia: notaId, monto: nota.total, expiraEnSegundos: COBRO_EXPIRACION_SEGUNDOS })
      : cobro
    return await guardarCobroNota(ctx, nota, vigente)
  } catch (error) {
    if (!(error instanceof ErrorIntegracion)) throw error
    return nota
  }
}

export async function reintentarNota(ctx: Contexto, identidad: Identidad, notaId: string, solicitud: SolicitudReintentoFactura) {
  const leida = await leerNota(ctx, identidad, notaId)
  const { restauranteId } = leida
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaNota(restauranteId, notaId)
    const nota = await tx.leer<Nota>(ruta)
    const referencia = await tx.leer<Referencia>(rutaReferencia(notaId))
    const factura = await tx.leer<Factura>(rutaFactura(restauranteId, leida.pagoId))
    if (!nota || !referencia) return fallar('NO_ENCONTRADO', 'Esa nota no existe')
    if (nota.estado !== 'rechazada' || !puedePasar(TRANSICIONES_FACTURA, nota.estado, 'en_proceso')) {
      return fallar('TRANSICION_INVALIDA', 'Solo se reintenta una nota rechazada')
    }
    if (referencia.pendienteEliminar) {
      return fallar('TRANSICION_INVALIDA', 'Factus aún no elimina el rechazo: se está reintentando')
    }
    if (nota.tipo === 'credito' && factura) {
      const pago = await tx.leer<PagoDoc>(rutaPago(restauranteId, leida.pagoId))
      const otras = factura.notas.filter((n) => n.id !== notaId)
      if (pago && nota.total > saldoAcreditable(pago.total, otras)) {
        return fallar('TRANSICION_INVALIDA', 'Otra nota ya acreditó ese valor')
      }
    }
    const cambios: Nota = {
      ...nota,
      estado: 'en_proceso',
      ultimoError: null,
      comprador: solicitud.comprador ?? nota.comprador,
      correo: solicitud.comprador ? correoInicial(solicitud.comprador.correo) : nota.correo,
    }
    tx.guardar(ruta, cambios)
    if (factura) ponerResumenNota(tx, factura, cambios)
    tx.actualizar(rutaReferencia(notaId), { reintentarEn: iso(sumarSegundos(ctx.ahora(), ESPERA_RESPALDO_SEGUNDOS)) })
    return cambios
  })
}

export async function marcarDevolucionHecha(ctx: Contexto, identidad: Identidad, notaId: string) {
  const restauranteId = restauranteDe(identidad)
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaNota(restauranteId, notaId)
    const nota = (await tx.leer<Nota>(ruta)) ?? fallar('NO_ENCONTRADO', 'Esa nota no existe')
    if (nota.devolucion !== 'pendiente' || nota.estado !== 'emitida') {
      fallar('TRANSICION_INVALIDA', 'Esa nota no tiene una devolución pendiente')
    }
    tx.actualizar(ruta, { devolucion: 'hecha' })
    return { ...nota, devolucion: 'hecha' as const }
  })
}

export async function enviarNotaPorCorreo(ctx: Contexto, identidad: Identidad, notaId: string, correo: string) {
  const nota = await leerNota(ctx, identidad, notaId)
  if (nota.estado !== 'emitida' || !nota.datos) return fallar('FACTURA_NO_DISPONIBLE', 'La nota aún no está emitida')
  await pedirCorreo(ctx, { tipo: 'nota', restauranteId: nota.restauranteId, id: notaId }, correo)
  return (await ctx.db.leer<Nota>(rutaNota(nota.restauranteId, notaId))) as Nota
}

export async function descargarNotaPdf(ctx: Contexto, identidad: Identidad, notaId: string): Promise<PdfFactura> {
  const nota = await leerNota(ctx, identidad, notaId)
  if (nota.estado !== 'emitida' || !nota.datos) return fallar('FACTURA_NO_DISPONIBLE', 'La nota aún no está emitida')
  return ctx.facturacion.descargarPdfNota(nota.tipo, nota.datos.numero)
}
