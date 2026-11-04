// Emite facturas y notas, una sola vez aunque el aviso se repita o dos procesos compitan.
// Quien va a llamar a Factus se reserva el documento en una transacción; si muere, otro lo toma al vencer la marca.

import { ErrorIntegracion, puedePasar, rutas, TRANSICIONES_FACTURA } from '../contratos/reglas'
import type { DatosFactura, DatosNota, EnvioCorreo, EstadoFactura, Factura, Nota, ResultadoEmision } from '../contratos/tipos'
import type { Transaccion } from './base-datos'
import { ponerResumen } from './cuenta'
import { iso, rutaReferencia, sumarSegundos, type Contexto, type CuentaDoc, type PagoDoc, type Referencia, type TipoReferencia } from './modelo'
import { rutaFactura, rutaPago } from './pagos'
import { rutaCuenta } from './pedidos'
import { solicitudFactura, solicitudNota } from './solicitudes'

/** Mayor que el tiempo máximo de una llamada a Factus, con su correo. */
const RESERVA_SEGUNDOS = 150
const ESPERA_MINIMA_SEGUNDOS = 60
const ESPERA_MAXIMA_SEGUNDOS = 900
const INTENTOS_CORREO = 10

export const rutaNota = (restauranteId: string, id: string) => `${rutas.notas(restauranteId)}/${id}`

export interface ClaveDocumento {
  tipo: TipoReferencia
  restauranteId: string
  id: string
}

type Documento = Factura | Nota
type Accion = 'emitir' | 'eliminar' | 'correo'

const rutaDe = ({ tipo, restauranteId, id }: ClaveDocumento) =>
  tipo === 'pago' ? rutaFactura(restauranteId, id) : rutaNota(restauranteId, id)

export const esperaDeReintento = (intentos: number, esperarSegundos = 0) =>
  Math.max(esperarSegundos, Math.min(ESPERA_MINIMA_SEGUNDOS * 2 ** Math.max(intentos - 1, 0), ESPERA_MAXIMA_SEGUNDOS))

function accionDe(documento: Documento, referencia: Referencia): Accion | null {
  if (documento.estado === 'rechazada') return referencia.pendienteEliminar ? 'eliminar' : null
  if (documento.estado === 'en_proceso' || documento.estado === 'en_validacion') return 'emitir'
  if (documento.estado === 'emitida' && documento.correo.estado === 'pendiente') return 'correo'
  return null
}

/** El disparador debe actuar solo cuando el documento entra a `en_proceso`, no con cada cambio. */
export function debeEmitir(antes: { estado?: EstadoFactura } | undefined, despues: { estado?: EstadoFactura } | undefined) {
  return despues?.estado === 'en_proceso' && antes?.estado !== 'en_proceso'
}

interface Reserva {
  accion: Accion
  marca: string
  documento: Documento
  pago: PagoDoc | null
}

async function reservar(ctx: Contexto, clave: ClaveDocumento, forzar: boolean): Promise<Reserva | null> {
  const ahora = ctx.ahora()
  const marca = ctx.nuevoId()
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaDe(clave)
    const documento = await tx.leer<Documento>(ruta)
    const referencia = await tx.leer<Referencia>(rutaReferencia(clave.id))
    if (!documento || !referencia) return null

    const accion = accionDe(documento, referencia)
    if (!accion) {
      if (referencia.reintentarEn) tx.actualizar(rutaReferencia(clave.id), { reintentarEn: null })
      return null
    }
    if (referencia.reservaHasta && referencia.reservaHasta > iso(ahora)) return null
    if (!forzar && referencia.reintentarEn && referencia.reintentarEn > iso(ahora)) return null

    const hasta = iso(sumarSegundos(ahora, RESERVA_SEGUNDOS))
    // Si este proceso muere, el barrido lo retoma cuando pase la reserva.
    tx.actualizar(rutaReferencia(clave.id), { reservaDe: marca, reservaHasta: hasta, reintentarEn: hasta })
    if (accion === 'emitir') {
      documento.intentos += 1
      tx.actualizar(ruta, { intentos: documento.intentos })
    }
    const pago = clave.tipo === 'pago' ? await tx.leer<PagoDoc>(rutaPago(clave.restauranteId, clave.id)) : null
    return { accion, marca, documento, pago }
  })
}

type CambiosDocumento = Partial<Omit<Factura, 'datos'>> & Partial<Omit<Nota, 'datos'>> & { datos?: DatosFactura | DatosNota }

interface Cierre {
  cambios?: CambiosDocumento
  reintentarEn?: string | null
  pendienteEliminar?: boolean
  intentosCorreo?: number
  /** Sigue con la marca: falta el correo. */
  conservarReserva?: boolean
}

/** Guarda el resultado y lo refleja en la cuenta o en la factura. Si otro tomó la reserva, su resultado manda. */
async function cerrar(ctx: Contexto, clave: ClaveDocumento, marca: string, cierre: Cierre) {
  return ctx.db.transaccion(async (tx) => {
    const ruta = rutaDe(clave)
    const documento = await tx.leer<Documento>(ruta)
    const referencia = await tx.leer<Referencia>(rutaReferencia(clave.id))
    if (!documento || referencia?.reservaDe !== marca) return false

    const cambios = cierre.cambios ?? {}
    if (Object.keys(cambios).length > 0) tx.actualizar(ruta, cambios)
    tx.actualizar(rutaReferencia(clave.id), {
      reintentarEn: cierre.reintentarEn ?? null,
      ...(cierre.conservarReserva ? {} : { reservaDe: null, reservaHasta: null }),
      ...(cierre.pendienteEliminar === undefined ? {} : { pendienteEliminar: cierre.pendienteEliminar }),
      ...(cierre.intentosCorreo === undefined ? {} : { intentosCorreo: cierre.intentosCorreo }),
    })
    if (cambios.estado && cambios.estado !== documento.estado) {
      await reflejarEstado(tx, clave, { ...documento, ...cambios } as Documento)
    }
    return true
  })
}

async function reflejarEstado(tx: Transaccion, { tipo, restauranteId, id }: ClaveDocumento, documento: Documento) {
  if (tipo === 'nota') {
    const nota = documento as Nota
    const rutaDeFactura = rutaFactura(restauranteId, nota.pagoId)
    const factura = await tx.leer<Factura>(rutaDeFactura)
    if (!factura) return
    const { id: notaId, tipo: tipoNota, numero, total, estado } = nota
    const notas = factura.notas.map((n) => (n.id === notaId ? { id: notaId, tipo: tipoNota, numero, total, estado } : n))
    tx.actualizar(rutaDeFactura, { notas })
    return
  }
  const pago = await tx.leer<PagoDoc>(rutaPago(restauranteId, id))
  if (!pago) return
  pago.estadoFactura = documento.estado
  tx.actualizar(rutaPago(restauranteId, id), { estadoFactura: documento.estado })
  const rutaDeCuenta = rutaCuenta(restauranteId, pago.cuentaId)
  const cuenta = await tx.leer<CuentaDoc>(rutaDeCuenta)
  if (cuenta) {
    ponerResumen(cuenta, pago)
    tx.actualizar(rutaDeCuenta, { pagos: cuenta.pagos })
  }
}

const estadoPosible = (desde: EstadoFactura, hacia: EstadoFactura) =>
  desde === hacia || puedePasar(TRANSICIONES_FACTURA, desde, hacia)

async function llamarEmision(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva): Promise<ResultadoEmision<DatosFactura | DatosNota>> {
  if (clave.tipo === 'pago') {
    return ctx.facturacion.emitirFactura(solicitudFactura(reserva.pago as PagoDoc, reserva.documento.comprador))
  }
  return ctx.facturacion.emitirNota(solicitudNota(reserva.documento as Nota))
}

const llamarEliminar = (ctx: Contexto, clave: ClaveDocumento, documento: Documento) =>
  clave.tipo === 'pago'
    ? ctx.facturacion.eliminarFactura(clave.id)
    : ctx.facturacion.eliminarNota((documento as Nota).tipo, clave.id)

/** Lo que se guarda al quedar emitido. Una nota lleva su número también en el resumen de la factura. */
function datosEmitidos(ctx: Contexto, clave: ClaveDocumento, datos: DatosFactura | DatosNota): CambiosDocumento {
  const base = { estado: 'emitida' as const, ultimoError: null, emitidaEn: iso(ctx.ahora()) }
  return clave.tipo === 'pago'
    ? { ...base, datos }
    : { ...base, datos, numero: datos.numero }
}

async function emitir(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva) {
  const { documento, marca } = reserva
  let resultado: ResultadoEmision<DatosFactura | DatosNota>
  try {
    resultado = await llamarEmision(ctx, clave, reserva)
  } catch (error) {
    await registrarFalloDeEmision(ctx, clave, reserva, error)
    return
  }

  if (resultado.estado === 'emitida') {
    await guardarEmitido(ctx, clave, reserva, resultado.datos)
    return
  }
  if (resultado.estado === 'en_validacion') {
    // La DIAN no ha respondido: se repite con la misma referencia y nunca se elimina.
    const espera = esperaDeReintento(documento.intentos)
    await cerrar(ctx, clave, marca, {
      cambios: { estado: 'en_validacion', ultimoError: resultado.detalle },
      reintentarEn: iso(sumarSegundos(ctx.ahora(), espera)),
    })
    return
  }
  await eliminarRechazado(ctx, clave, reserva, resultado.errores.join('. '))
}

async function guardarEmitido(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva, datos: DatosFactura | DatosNota) {
  const { documento, marca } = reserva
  const falta = documento.correo.estado === 'pendiente'
  const guardado = await cerrar(ctx, clave, marca, {
    cambios: datosEmitidos(ctx, clave, datos),
    pendienteEliminar: false,
    conservarReserva: falta,
    reintentarEn: falta ? iso(sumarSegundos(ctx.ahora(), RESERVA_SEGUNDOS)) : null,
  })
  if (guardado && falta) await enviarCorreoPendiente(ctx, clave, marca, datos.numero, documento.correo)
}

/** 409 o 429 no se muestran como error: el documento sigue igual y se reintenta. Un 422 espera al personal. */
async function registrarFalloDeEmision(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva, error: unknown) {
  const { documento, marca } = reserva
  if (error instanceof ErrorIntegracion && error.reintentable) {
    console.warn('Factus no pudo emitir; se reintenta', clave.tipo, clave.id, error.tipo, error.status ?? '')
    const espera = esperaDeReintento(documento.intentos, error.esperarSegundos)
    await cerrar(ctx, clave, marca, {
      cambios: { ultimoError: 'Factus no respondió; se reintenta sola' },
      reintentarEn: iso(sumarSegundos(ctx.ahora(), espera)),
    })
    return
  }
  if (error instanceof ErrorIntegracion && error.tipo === 'no_autorizado') {
    // Las credenciales no son culpa de los datos: rechazarla mandaría al personal a corregir lo que está bien.
    console.error('Factus rechazó las credenciales', clave.tipo, clave.id)
    await cerrar(ctx, clave, marca, {
      cambios: { ultimoError: 'Factus no respondió; se reintenta sola' },
      reintentarEn: iso(sumarSegundos(ctx.ahora(), ESPERA_MAXIMA_SEGUNDOS)),
    })
    return
  }
  const mensaje = error instanceof ErrorIntegracion ? error.message : 'No se pudo emitir'
  if (!(error instanceof ErrorIntegracion)) console.error('Error al emitir', clave.tipo, clave.id, error)
  if (!estadoPosible(documento.estado, 'rechazada')) return
  // Factus no lo aceptó, así que no hay nada que eliminar: espera la corrección del personal.
  await cerrar(ctx, clave, marca, { cambios: { estado: 'rechazada', ultimoError: mensaje } })
}

async function eliminarRechazado(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva, mensaje: string) {
  const { documento, marca } = reserva
  const rechazo = { estado: 'rechazada' as const, ultimoError: mensaje }
  try {
    await llamarEliminar(ctx, clave, documento)
  } catch (error) {
    if (error instanceof ErrorIntegracion && error.status === 404) {
      // Ya no está en Factus: es lo que se buscaba.
    } else if (error instanceof ErrorIntegracion && error.status === 409) {
      await resolverYaValidada(ctx, clave, reserva, mensaje)
      return
    } else {
      // El rechazo bloquea el rango: se sigue intentando eliminar, pero no se reemite hasta lograrlo.
      const espera = esperaDeReintento(documento.intentos, error instanceof ErrorIntegracion ? error.esperarSegundos : 0)
      await cerrar(ctx, clave, marca, {
        cambios: rechazo,
        pendienteEliminar: true,
        reintentarEn: iso(sumarSegundos(ctx.ahora(), espera)),
      })
      return
    }
  }
  await cerrar(ctx, clave, marca, { cambios: rechazo, pendienteEliminar: false })
}

/**
 * Un 409 al eliminar significa que el documento ya está validado: no se reintenta en bucle.
 * Repetir la referencia devuelve el mismo documento, así que se pide una vez para guardar sus datos.
 */
async function resolverYaValidada(ctx: Contexto, clave: ClaveDocumento, reserva: Reserva, mensaje: string) {
  const { documento, marca } = reserva
  try {
    const resultado = await llamarEmision(ctx, clave, reserva)
    if (resultado.estado === 'emitida') {
      await guardarEmitido(ctx, clave, reserva, resultado.datos)
      return
    }
  } catch (error) {
    if (error instanceof ErrorIntegracion && error.reintentable) {
      const espera = esperaDeReintento(documento.intentos, error.esperarSegundos)
      await cerrar(ctx, clave, marca, {
        cambios: { estado: documento.estado === 'rechazada' ? 'en_proceso' : documento.estado },
        pendienteEliminar: false,
        reintentarEn: iso(sumarSegundos(ctx.ahora(), espera)),
      })
      return
    }
  }
  await cerrar(ctx, clave, marca, { cambios: { estado: 'rechazada', ultimoError: mensaje }, pendienteEliminar: false })
}

const llamarCorreo = (ctx: Contexto, clave: ClaveDocumento, tipoNota: Nota['tipo'] | null, numero: string, correo: string) =>
  tipoNota === null ? ctx.facturacion.enviarCorreo(numero, correo) : ctx.facturacion.enviarCorreoNota(tipoNota, numero, correo)

/** El correo nunca afecta la factura. Un 422 lo deja `fallido`; un fallo de red se reintenta unas veces. */
async function enviarCorreoPendiente(ctx: Contexto, clave: ClaveDocumento, marca: string, numero: string, correo: EnvioCorreo) {
  const referencia = await ctx.db.leer<Referencia>(rutaReferencia(clave.id))
  const documento = await ctx.db.leer<Documento>(rutaDe(clave))
  if (!referencia || !documento || !correo.destino) return
  const tipoNota = clave.tipo === 'nota' ? (documento as Nota).tipo : null
  const intentos = referencia.intentosCorreo + 1
  try {
    await llamarCorreo(ctx, clave, tipoNota, numero, correo.destino)
    const enviado: EnvioCorreo = { estado: 'enviado', destino: correo.destino, ultimoError: null, enviadoEn: iso(ctx.ahora()) }
    await cerrar(ctx, clave, marca, { cambios: { correo: enviado }, intentosCorreo: 0 })
  } catch (error) {
    const reintentable = error instanceof ErrorIntegracion && error.reintentable && intentos < INTENTOS_CORREO
    const mensaje = error instanceof ErrorIntegracion ? error.message : 'No se pudo enviar el correo'
    const estado = reintentable ? 'pendiente' : 'fallido'
    const espera = esperaDeReintento(intentos, error instanceof ErrorIntegracion ? error.esperarSegundos : 0)
    await cerrar(ctx, clave, marca, {
      cambios: { correo: { ...correo, estado, ultimoError: mensaje } },
      intentosCorreo: reintentable ? intentos : 0,
      reintentarEn: reintentable ? iso(sumarSegundos(ctx.ahora(), espera)) : null,
    })
  }
}

/**
 * Hace lo que le falte al documento: emitir, eliminar un rechazo o enviar el correo.
 * Con `forzar` no espera a `reintentarEn`, pero nunca le pasa por encima a otra reserva.
 */
export async function procesarDocumento(ctx: Contexto, clave: ClaveDocumento, { forzar = false } = {}) {
  const reserva = await reservar(ctx, clave, forzar)
  if (!reserva) return
  const { accion, documento, marca } = reserva
  if (accion === 'emitir') {
    await emitir(ctx, clave, reserva)
  } else if (accion === 'eliminar') {
    await eliminarRechazado(ctx, clave, reserva, documento.ultimoError ?? 'Rechazada por la DIAN')
  } else {
    const numero = (documento.datos as DatosFactura | DatosNota).numero
    await enviarCorreoPendiente(ctx, clave, marca, numero, documento.correo)
  }
}

/** Pone el correo en cola y lo intenta en seguida. Lo llama la orden de reenviar. */
export async function pedirCorreo(ctx: Contexto, clave: ClaveDocumento, destino: string) {
  await ctx.db.transaccion(async (tx) => {
    const ruta = rutaDe(clave)
    const documento = await tx.leer<Documento>(ruta)
    if (!documento) return
    const correo: EnvioCorreo = { estado: 'pendiente', destino, ultimoError: null, enviadoEn: null }
    tx.actualizar(ruta, { correo })
    tx.actualizar(rutaReferencia(clave.id), { reintentarEn: iso(ctx.ahora()), intentosCorreo: 0 })
  })
  await procesarDocumento(ctx, clave, { forzar: true })
}
