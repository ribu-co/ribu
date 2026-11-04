// Pagos: crear, cancelar, vencer y confirmar. La plata solo se marca después de preguntarle a Factus Pay.

import {
  baseSinImpuesto,
  calcularPropina,
  COBRO_EXPIRACION_SEGUNDOS,
  CONSULTA_COBRO_SEGUNDOS,
  ErrorIntegracion,
  MONTO_MAXIMO_COBRO,
  MONTO_MINIMO_COBRO,
  propinaValida,
  puedePasar,
  rutas,
  TRANSICIONES_FACTURA,
  TRANSICIONES_PAGO,
} from '../contratos/reglas'
import type { Cobro, EstadoPago, Factura, Fecha, PagadorCobro, SolicitudPago } from '../contratos/tipos'
import { esPersonal, type Identidad } from './auth'
import type { Transaccion } from './base-datos'
import { aceptarPagoTardio, cubrirDestino, moverCobertura, ponerResumen, recalcular, subtotalDe } from './cuenta'
import { ErrorRibu, fallar } from './errores'
import { iso, referenciaNueva, rutaReferencia, sumarSegundos, type Contexto, type CuentaDoc, type PagoDoc, type Referencia } from './modelo'
import { exigirRestauranteActivo, leerCuentaDeMesa, leerMesa, rutaCuenta } from './pedidos'
import { leerComprador } from './validacion'

export const rutaPago = (restauranteId: string, id: string) => `${rutas.pagos(restauranteId)}/${id}`
export const rutaFactura = (restauranteId: string, id: string) => `${rutas.facturas(restauranteId)}/${id}`

/** Si el disparador no corre, el barrido programado toma el documento pasado este tiempo. */
export const ESPERA_RESPALDO_SEGUNDOS = 120

export function correoInicial(destino: string | null): Factura['correo'] {
  return { estado: destino ? 'pendiente' : 'sin_correo', destino, ultimoError: null, enviadoEn: null }
}

/** Un QR vencido sigue en `ready`: el vencimiento se decide con `qrExpiraEn`, no por el estado. */
export function fechaLimiteCobro(pago: PagoDoc): Fecha {
  return pago.cobro?.qrExpiraEn ?? iso(sumarSegundos(new Date(pago.creadoEn), COBRO_EXPIRACION_SEGUNDOS))
}

export const cobroVencido = (pago: PagoDoc, ahora: Date) =>
  pago.estado === 'esperando_pago' &&
  pago.medio === 'factus_pay' &&
  pago.cobro?.estado !== 'paid' &&
  fechaLimiteCobro(pago) <= iso(ahora)

/** Saca el pago de los cobros activos y suelta lo que cubría. Quien llama guarda la cuenta. */
function soltarPago(tx: Transaccion, cuenta: CuentaDoc, pago: PagoDoc, estado: EstadoPago) {
  if (!puedePasar(TRANSICIONES_PAGO, pago.estado, estado)) {
    return fallar('TRANSICION_INVALIDA', 'Ese pago ya no está esperando')
  }
  pago.estado = estado
  if (pago.parte === null) moverCobertura(cuenta, pago.items, -1)
  ponerResumen(cuenta, pago)
  tx.actualizar(rutaPago(pago.restauranteId, pago.id), { estado })
  tx.actualizar(rutaReferencia(pago.id), { venceEn: null })
}

/** Vence los cobros cuyo QR ya pasó, aunque quien pagaba haya cerrado la pestaña. Deja la cuenta recalculada. */
export async function vencerCobrosDeCuenta(tx: Transaccion, cuenta: CuentaDoc, ahora: Date, excepto?: string) {
  const activos = cuenta.pagos.filter((p) => p.estado === 'esperando_pago' && p.medio === 'factus_pay' && p.id !== excepto)
  const pagos = await tx.leerVarios<PagoDoc>(activos.map((p) => rutaPago(cuenta.restauranteId, p.id)))
  for (const pago of pagos) {
    if (pago && cobroVencido(pago, ahora)) soltarPago(tx, cuenta, pago, 'vencido')
  }
  return recalcular(cuenta)
}

export async function crearPago(ctx: Contexto, identidad: Identidad, token: string, solicitud: SolicitudPago) {
  const { destino, propinaPorcentaje, medio } = solicitud
  if (medio !== 'factus_pay' && !esPersonal(identidad.rol)) {
    fallar('SIN_PERMISO', 'El efectivo y la tarjeta solo los registra el personal')
  }
  if (!propinaValida(propinaPorcentaje)) fallar('PROPINA_INVALIDA', 'La propina es un porcentaje entero de 0 a 100')
  const comprador = leerComprador(solicitud.comprador)

  const ahora = ctx.ahora()
  const pago = await ctx.db.transaccion(async (tx) => {
    const { mesa, cuenta, ruta } = await leerCuentaDeMesa(tx, identidad, token)
    const { impuesto } = await exigirRestauranteActivo(tx, mesa.restauranteId)
    await vencerCobrosDeCuenta(tx, cuenta, ahora)

    const { items, parte, division } = cubrirDestino(cuenta, destino)
    const subtotal = subtotalDe(items)
    if (subtotal <= 0) fallar('NADA_POR_PAGAR', 'No hay nada por pagar')
    const propina = calcularPropina(subtotal, impuesto, propinaPorcentaje)
    const total = subtotal + propina
    if (medio === 'factus_pay' && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)) {
      fallar('MONTO_FUERA_DE_RANGO', `Factus Pay cobra de ${MONTO_MINIMO_COBRO} a ${MONTO_MAXIMO_COBRO} pesos: usa efectivo o tarjeta`)
    }

    const pagadoYa = medio !== 'factus_pay'
    const id = ctx.nuevoId()
    const nuevo: PagoDoc = {
      id,
      numero: cuenta.pagos.length + 1,
      parte,
      subtotal,
      total,
      medio,
      estado: pagadoYa ? 'pagado' : 'esperando_pago',
      estadoFactura: pagadoYa ? 'en_proceso' : 'sin_emitir',
      incidencia: null,
      creadoPor: identidad.uid,
      restauranteId: mesa.restauranteId,
      cuentaId: cuenta.id,
      mesaToken: token,
      destino,
      items,
      impuesto,
      baseSinImpuesto: baseSinImpuesto(subtotal, impuesto),
      propinaPorcentaje,
      propina,
      cobro: null,
      creadoEn: iso(ahora),
      pagadoEn: pagadoYa ? iso(ahora) : null,
      divisionId: division?.id ?? null,
    }
    const factura: Factura = {
      pagoId: id,
      restauranteId: mesa.restauranteId,
      pagadorUid: identidad.uid,
      estado: nuevo.estadoFactura,
      comprador,
      datos: null,
      intentos: 0,
      ultimoError: null,
      correo: correoInicial(comprador.correo),
      pagador: null,
      notas: [],
      emitidaEn: null,
    }
    const referencia: Referencia = {
      ...referenciaNueva(mesa.restauranteId, 'pago'),
      venceEn: pagadoYa ? null : fechaLimiteCobro(nuevo),
      reintentarEn: pagadoYa ? iso(sumarSegundos(ahora, ESPERA_RESPALDO_SEGUNDOS)) : null,
    }

    moverCobertura(cuenta, items, 1)
    ponerResumen(cuenta, nuevo)
    tx.guardar(ruta, recalcular(cuenta))
    tx.guardar(rutaPago(mesa.restauranteId, id), nuevo)
    tx.guardar(rutaFactura(mesa.restauranteId, id), factura)
    tx.guardar(rutaReferencia(id), referencia)
    return nuevo
  })

  if (pago.medio !== 'factus_pay') return pago

  // El cobro se pide con las unidades ya reservadas: nadie más puede cobrar lo mismo mientras tanto.
  try {
    const cobro = await ctx.cobros.crearCobro({
      referencia: pago.id,
      monto: pago.total,
      expiraEnSegundos: COBRO_EXPIRACION_SEGUNDOS,
    })
    return await guardarCobro(ctx, pago, cobro)
  } catch (error) {
    console.error('crearCobro falló', error instanceof Error ? error.message : 'error desconocido')
    await marcarFallido(ctx, pago)
    throw new ErrorRibu('SERVICIO_NO_DISPONIBLE', 'No se pudo generar el cobro. Intenta de nuevo.')
  }
}

/** Una consulta puede no traer el QR ni la llave: no se pierde lo que ya se le mostró al cliente. */
const cobroAlDia = (anterior: Cobro | null, cobro: Cobro): Cobro => ({
  ...cobro,
  qrBase64: cobro.qrBase64 ?? anterior?.qrBase64 ?? null,
  llaveBreB: cobro.llaveBreB ?? anterior?.llaveBreB ?? null,
  qrExpiraEn: cobro.qrExpiraEn ?? anterior?.qrExpiraEn ?? null,
})

async function guardarCobro(ctx: Contexto, pago: PagoDoc, cobro: Cobro) {
  return ctx.db.transaccion(async (tx) => {
    const actual = await tx.leer<PagoDoc>(rutaPago(pago.restauranteId, pago.id))
    if (!actual) return pago
    actual.cobro = cobro
    tx.actualizar(rutaPago(pago.restauranteId, pago.id), { cobro })
    if (actual.estado === 'esperando_pago') tx.actualizar(rutaReferencia(pago.id), { venceEn: fechaLimiteCobro(actual) })
    return actual
  })
}

async function marcarFallido(ctx: Contexto, pago: PagoDoc) {
  await ctx.db.transaccion(async (tx) => {
    const actual = await tx.leer<PagoDoc>(rutaPago(pago.restauranteId, pago.id))
    const cuenta = await tx.leer<CuentaDoc>(rutaCuenta(pago.restauranteId, pago.cuentaId))
    if (!actual || !cuenta || actual.estado !== 'esperando_pago') return
    soltarPago(tx, cuenta, actual, 'fallido')
    tx.guardar(rutaCuenta(pago.restauranteId, pago.cuentaId), recalcular(cuenta))
  })
}

/**
 * Marca el pago como pagado o, si otro ya cubrió lo mismo, como `pago_duplicado`, sin factura y sin sumar.
 * Solo se llama con un cobro `paid` que ya se consultó en Factus Pay. Repetirlo no cambia nada.
 */
export async function confirmarPago(
  ctx: Contexto,
  restauranteId: string,
  pagoId: string,
  cobro: Cobro,
  pagador: PagadorCobro | null = null,
): Promise<PagoDoc | null> {
  const ahora = ctx.ahora()
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaPago(restauranteId, pagoId)
    const pago = await tx.leer<PagoDoc>(ruta)
    if (!pago) return null
    const rutaDeFactura = rutaFactura(restauranteId, pagoId)
    const factura = await tx.leer<Factura>(rutaDeFactura)

    if (cobro.estado !== 'paid' || cobro.monto !== pago.total) {
      console.warn('Cobro sin confirmar: estado o monto distinto al del pago', pagoId)
      return pago
    }
    if (pago.estado === 'pagado') {
      if (factura && pagador && !factura.pagador) tx.actualizar(rutaDeFactura, { pagador })
      return pago
    }

    const rutaDeCuenta = rutaCuenta(restauranteId, pago.cuentaId)
    const cuenta = await tx.leer<CuentaDoc>(rutaDeCuenta)
    if (!cuenta) return null
    // Un QR ajeno que ya venció no debe hacer parecer ocupado lo que en realidad está libre.
    await vencerCobrosDeCuenta(tx, cuenta, ahora, pagoId)

    let vale: boolean
    if (pago.estado === 'esperando_pago') {
      vale = cuenta.estado !== 'cerrada' && cuenta.pagado + pago.subtotal <= cuenta.consumo
      if (!vale && pago.parte === null) moverCobertura(cuenta, pago.items, -1)
    } else {
      vale = aceptarPagoTardio(cuenta, pago)
    }

    pago.estado = 'pagado'
    pago.cobro = cobroAlDia(pago.cobro, cobro)
    pago.pagadoEn = cobro.recaudadoEn ?? iso(ahora)
    pago.incidencia = vale ? null : 'pago_duplicado'
    pago.estadoFactura = vale ? 'en_proceso' : 'sin_emitir'
    ponerResumen(cuenta, pago)

    tx.guardar(ruta, pago)
    tx.guardar(rutaDeCuenta, recalcular(cuenta))
    tx.actualizar(rutaReferencia(pagoId), {
      venceEn: null,
      reintentarEn: vale ? iso(sumarSegundos(ahora, ESPERA_RESPALDO_SEGUNDOS)) : null,
    })
    if (factura) {
      const estado = vale && puedePasar(TRANSICIONES_FACTURA, factura.estado, 'en_proceso') ? 'en_proceso' : factura.estado
      tx.actualizar(rutaDeFactura, { estado, pagador: pagador ?? factura.pagador })
    }
    return pago
  })
}

/** Aplica lo que respondió Factus Pay a un cobro que no está `paid`: QR nuevo, rechazo o vencimiento. */
async function reflejarCobro(ctx: Contexto, restauranteId: string, pagoId: string, cobro: Cobro | null) {
  const ahora = ctx.ahora()
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaPago(restauranteId, pagoId)
    const pago = await tx.leer<PagoDoc>(ruta)
    if (!pago) return null
    if (cobro) {
      pago.cobro = cobroAlDia(pago.cobro, cobro)
      tx.actualizar(ruta, { cobro: pago.cobro })
    }
    if (pago.estado !== 'esperando_pago') return pago

    const rechazado = cobro?.estado === 'failed' || cobro?.estado === 'rejected'
    if (!rechazado && !cobroVencido(pago, ahora)) {
      tx.actualizar(rutaReferencia(pagoId), { venceEn: fechaLimiteCobro(pago) })
      return pago
    }
    const rutaDeCuenta = rutaCuenta(restauranteId, pago.cuentaId)
    const cuenta = await tx.leer<CuentaDoc>(rutaDeCuenta)
    if (!cuenta) return pago
    soltarPago(tx, cuenta, pago, rechazado ? 'fallido' : 'vencido')
    tx.guardar(rutaDeCuenta, recalcular(cuenta))
    return pago
  })
}

/** Pregunta a Factus Pay por el pago y aplica la respuesta. Si no responde, igual revisa el vencimiento. */
export async function revisarCobroDePago(ctx: Contexto, restauranteId: string, pagoId: string) {
  let cobro: Cobro
  try {
    cobro = await ctx.cobros.consultarCobro(pagoId)
  } catch (error) {
    if (!(error instanceof ErrorIntegracion)) throw error
    return reflejarCobro(ctx, restauranteId, pagoId, null)
  }
  return aplicarCobro(ctx, restauranteId, pagoId, cobro)
}

/** Aplica un cobro ya consultado. Un `paid` con otro monto no marca nada, y el pago vence como cualquiera. */
export async function aplicarCobro(ctx: Contexto, restauranteId: string, pagoId: string, cobro: Cobro, pagador: PagadorCobro | null = null) {
  if (cobro.estado !== 'paid') return reflejarCobro(ctx, restauranteId, pagoId, cobro)
  const pago = await confirmarPago(ctx, restauranteId, pagoId, cobro, pagador)
  return pago?.estado === 'pagado' ? pago : reflejarCobro(ctx, restauranteId, pagoId, null)
}

/** Marca en transacción que se va a consultar. Devuelve false si ya se consultó hace poco. */
export async function reservarConsulta(ctx: Contexto, id: string) {
  const ahora = ctx.ahora()
  return ctx.db.transaccion(async (tx) => {
    const referencia = await tx.leer<Referencia>(rutaReferencia(id))
    if (!referencia) return false
    const desde = iso(sumarSegundos(ahora, -CONSULTA_COBRO_SEGUNDOS))
    if (referencia.consultadoEn && referencia.consultadoEn > desde) return false
    tx.actualizar(rutaReferencia(id), { consultadoEn: iso(ahora) })
    return true
  })
}

async function leerPagoDeMesa(ctx: Contexto, identidad: Identidad, token: string, pagoId: string) {
  const mesa = await leerMesa(ctx.db, identidad, token)
  const pago = await ctx.db.leer<PagoDoc>(rutaPago(mesa.restauranteId, pagoId))
  if (!pago || pago.mesaToken !== token) return fallar('NO_ENCONTRADO', 'Ese pago no existe')
  return pago
}

export async function verificarPago(ctx: Contexto, identidad: Identidad, token: string, pagoId: string) {
  const pago = await leerPagoDeMesa(ctx, identidad, token, pagoId)
  if (pago.medio !== 'factus_pay' || pago.estado === 'pagado') return pago
  if (!(await reservarConsulta(ctx, pagoId))) return pago
  return (await revisarCobroDePago(ctx, pago.restauranteId, pagoId)) ?? pago
}

export async function cancelarPago(ctx: Contexto, identidad: Identidad, token: string, pagoId: string) {
  const pago = await leerPagoDeMesa(ctx, identidad, token, pagoId)
  if (pago.creadoPor !== identidad.uid && !esPersonal(identidad.rol)) {
    fallar('SIN_PERMISO', 'Solo quien creó el pago lo puede cancelar')
  }
  return ctx.db.transaccion(async (tx) => {
    const actual = await tx.leer<PagoDoc>(rutaPago(pago.restauranteId, pagoId))
    const cuenta = await tx.leer<CuentaDoc>(rutaCuenta(pago.restauranteId, pago.cuentaId))
    if (!actual || !cuenta) return fallar('NO_ENCONTRADO', 'Ese pago no existe')
    soltarPago(tx, cuenta, actual, 'cancelado')
    tx.guardar(rutaCuenta(pago.restauranteId, pago.cuentaId), recalcular(cuenta))
    return actual
  })
}

export { leerPagoDeMesa }
