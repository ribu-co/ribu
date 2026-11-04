// Los mocks guardan todo en memoria, pero `api`, los disparadores y el barrido corren en procesos distintos.
// Con emulador o RIBU_MOCKS=1, este envoltorio guarda en Firestore lo que los demás procesos deben ver.

import { createHash } from 'node:crypto'
import { crearCobrosMock } from '../cobros/mock'
import { ErrorIntegracion } from '../contratos/reglas'
import type {
  Cobro,
  DatosFactura,
  DatosNota,
  PdfFactura,
  ResultadoEmision,
  ServicioCobros,
  ServicioFacturacion,
  SolicitudFactura,
  SolicitudNota,
} from '../contratos/tipos'
import { crearFacturacionMock } from '../facturacion/mock'
import type { Rango } from '../facturacion/conexion'
import type { BaseDatos } from './base-datos'

const COBROS = '_mocks_cobros'
const DOCUMENTOS = '_mocks_documentos'

const PREFIJO: Record<Rango, string> = { factura: 'SETP', credito: 'NC', debito: 'ND' }

interface DocumentoGuardado {
  rango: Rango
  numero: string
  referencia: string
  datos: DatosFactura | DatosNota
}

const noExiste = (servicio: 'factus' | 'factus_pay', mensaje: string) =>
  new ErrorIntegracion(mensaje, servicio, 'validacion', 404)

/** Un número que no se repite aunque cada proceso tenga su propia memoria. */
function numeroDe(rango: Rango, referencia: string) {
  const resumen = createHash('sha256').update(`${rango}:${referencia}`).digest().readUInt32BE(0)
  return `${PREFIJO[rango]}${resumen}`
}

/** Una factura mínima: la nota del mock solo acepta números de su propia memoria. */
const FACTURA_MINIMA: SolicitudFactura = {
  referencia: 'factura-minima',
  comprador: { tipo: 'consumidor_final', correo: null },
  lineas: [{ codigo: 'x', descripcion: 'x', cantidad: 1, precioSinImpuesto: 1000 }],
  impuesto: { tipo: 'ninguno', porcentaje: 0 },
  propina: null,
  medio: 'efectivo',
  total: 1000,
}

export interface CobrosCompartidos extends ServicioCobros {
  /** Deja el recaudo en `paid`. Devuelve el cuerpo que enviaría Factus Pay en el webhook. */
  marcarPagado(referencia: string): Promise<unknown>
}

export const LLAVE_WEBHOOK_MOCK = 'llave-de-ejemplo-del-webhook-de-ribu'

export function crearCobrosCompartidos(db: BaseDatos, ahora: () => Date = () => new Date()): CobrosCompartidos {
  const mock = crearCobrosMock({ ahora })
  const ruta = (referencia: string) => `${COBROS}/${referencia}`

  return {
    leerWebhook: (clave, cuerpo) => mock.leerWebhook(clave, cuerpo),

    async crearCobro(solicitud) {
      const guardado = await db.leer<Cobro>(ruta(solicitud.referencia))
      if (guardado && guardado.monto !== solicitud.monto) {
        throw new ErrorIntegracion('La referencia ya existe con un monto diferente.', 'factus_pay', 'validacion', 422)
      }
      const nuevo = await crearCobrosMock({ ahora }).crearCobro(solicitud)
      if (guardado?.estado === 'paid') return guardado
      // Repetir la referencia renueva el QR y conserva la llave.
      const cobro = guardado ? { ...guardado, qrExpiraEn: nuevo.qrExpiraEn } : { ...nuevo, llaveBreB: `@RIBUMOCK${numeroDe('factura', solicitud.referencia)}` }
      await db.transaccion(async (tx) => tx.guardar(ruta(cobro.referencia), cobro))
      return cobro
    },

    async consultarCobro(referencia) {
      const cobro = await db.leer<Cobro>(ruta(referencia))
      if (!cobro) throw noExiste('factus_pay', `No existe el recaudo ${referencia}`)
      return cobro
    },

    async marcarPagado(referencia) {
      const cobro = await db.leer<Cobro>(ruta(referencia))
      if (!cobro) throw noExiste('factus_pay', `No existe el recaudo ${referencia}`)
      const pagado: Cobro = { ...cobro, estado: 'paid', recaudadoEn: ahora().toISOString() }
      await db.transaccion(async (tx) => tx.guardar(ruta(referencia), pagado))
      return { data: { reference_code: referencia, amount: cobro.monto, status: 'paid', collected_at: pagado.recaudadoEn } }
    },
  }
}

export function crearFacturacionCompartida(db: BaseDatos): ServicioFacturacion {
  const ruta = (rango: Rango, referencia: string) => `${DOCUMENTOS}/${rango}_${referencia}`

  async function porNumero(rango: Rango, numero: string) {
    const [fila] = await db.consultar<DocumentoGuardado>(DOCUMENTOS, { campo: 'numero', op: '==', valor: numero }, 1)
    if (!fila || fila.datos.rango !== rango) throw noExiste('factus', `No hay un documento emitido con el número ${numero}`)
    return fila.datos
  }

  /** Guarda lo emitido con un número propio. Con una referencia validada devuelve el mismo documento. */
  async function emitir<D extends DatosFactura | DatosNota>(
    rango: Rango,
    referencia: string,
    pedir: () => Promise<ResultadoEmision<D>>,
  ): Promise<ResultadoEmision<D>> {
    const guardado = await db.leer<DocumentoGuardado>(ruta(rango, referencia))
    if (guardado) return { estado: 'emitida', datos: guardado.datos as D }
    const resultado = await pedir()
    if (resultado.estado !== 'emitida') return resultado
    const numero = numeroDe(rango, referencia)
    const datos: D = {
      ...resultado.datos,
      numero,
      urlPublica: resultado.datos.urlPublica.replace(resultado.datos.numero, numero),
    }
    await db.transaccion(async (tx) => tx.guardar(ruta(rango, referencia), { rango, numero, referencia, datos }))
    return { estado: 'emitida', datos }
  }

  async function mockConFactura() {
    const mock = crearFacturacionMock()
    const factura = await mock.emitirFactura(FACTURA_MINIMA)
    return { mock, numero: (factura as { datos: DatosFactura }).datos.numero }
  }

  async function pdf(rango: Rango, numero: string): Promise<PdfFactura> {
    await porNumero(rango, numero)
    const { mock, numero: propio } = await mockConFactura()
    const { base64 } = await mock.descargarPdf(propio)
    return { nombreArchivo: `${numero}.pdf`, base64 }
  }

  return {
    emitirFactura: (solicitud) => emitir('factura', solicitud.referencia, () => crearFacturacionMock().emitirFactura(solicitud)),

    async emitirNota(solicitud: SolicitudNota) {
      await porNumero('factura', solicitud.numeroFactura).catch(() => {
        throw new ErrorIntegracion(`La factura ${solicitud.numeroFactura} no existe o no está validada`, 'factus', 'validacion', 422)
      })
      return emitir(solicitud.tipo, solicitud.referencia, async () => {
        const { mock, numero } = await mockConFactura()
        return mock.emitirNota({ ...solicitud, numeroFactura: numero })
      })
    },

    // El mock responde 404 con lo que no conoce, y esta memoria es de otro proceso: aquí no hay rechazos que borrar.
    eliminarFactura: async () => undefined,
    eliminarNota: async () => undefined,
    descargarPdf: (numero) => pdf('factura', numero),
    descargarPdfNota: (tipo, numero) => pdf(tipo, numero),
    enviarCorreo: async (numero) => void (await porNumero('factura', numero)),
    enviarCorreoNota: async (tipo, numero) => void (await porNumero(tipo, numero)),
  }
}
