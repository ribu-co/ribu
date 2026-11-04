// Facturación simulada, sin llamar a Factus. Imita las reglas que importan para el flujo:
// una referencia validada devuelve la misma factura, un documento pendiente bloquea el rango con 409,
// un rechazo se queda en Factus hasta que se elimina y las notas solo corrigen facturas emitidas.

import { ErrorIntegracion } from '../contratos/reglas'
import type {
  DatosFactura,
  DatosNota,
  PdfFactura,
  ResultadoEmision,
  ServicioFacturacion,
  SolicitudFactura,
  SolicitudNota,
} from '../contratos/tipos'
import { validarNota, validarSolicitud } from './calculo'
import type { Rango } from './conexion'

export type EscenarioEmision = 'emitida' | 'en_validacion' | 'rechazada'

/** Decide cómo responde la DIAN. Puede lanzar un `ErrorIntegracion` para simular un 429 o un 5xx. */
export type DecidirEscenario = (solicitud: SolicitudFactura | SolicitudNota) => EscenarioEmision

export interface OpcionesFacturacionMock {
  /** Por defecto, `emitida`. */
  escenario?: EscenarioEmision | DecidirEscenario
}

export interface CorreoMock {
  rango: Rango
  numero: string
  correo: string
}

export interface DocumentoMock {
  rango: Rango
  referencia: string
  numero: string
  estado: EscenarioEmision
  /** La última solicitud con la que se creó o reintentó. */
  solicitud: SolicitudFactura | SolicitudNota
}

export interface FacturacionMock extends ServicioFacturacion {
  /** Se puede cambiar entre llamadas, por ejemplo para que un reintento quede emitido. */
  escenario: EscenarioEmision | DecidirEscenario
  /** Cada solicitud que llegó a Factus, en orden, incluidos los reintentos. */
  readonly emisiones: (SolicitudFactura | SolicitudNota)[]
  readonly correos: CorreoMock[]
  /** Lo que hay en Factus ahora. Lo eliminado ya no aparece. */
  documentos(): DocumentoMock[]
}

export const DETALLE_EN_VALIDACION = 'La DIAN no ha respondido (simulado)'
export const ERROR_RECHAZO = 'Regla FAK24, Rechazo: el documento del adquiriente no es válido (simulado)'

const PDF_BASE64 = btoa('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n')

const PREFIJO: Record<Rango, string> = { factura: 'SETP', credito: 'NC', debito: 'ND' }
const NUMERO_INICIAL: Record<Rango, number> = { factura: 990000000, credito: 0, debito: 0 }
const NOMBRE: Record<Rango, string> = { factura: 'factura', credito: 'nota crédito', debito: 'nota débito' }

/** 96 caracteres hexadecimales, como un CUFE, que siempre salen iguales para el mismo texto. */
function huella(texto: string) {
  let hash = 2166136261
  let salida = ''
  for (let vuelta = 0; salida.length < 96; vuelta++) {
    for (const letra of `${vuelta}:${texto}`) hash = Math.imul(hash ^ letra.charCodeAt(0), 16777619)
    salida += (hash >>> 0).toString(16).padStart(8, '0')
  }
  return salida.slice(0, 96)
}

const noEncontrado = (mensaje: string) => new ErrorIntegracion(mensaje, 'factus', 'validacion', 404)
const invalido = (mensaje: string) => new ErrorIntegracion(mensaje, 'factus', 'validacion', 422)
const conflicto = (mensaje: string) => new ErrorIntegracion(mensaje, 'factus', 'conflicto', 409)

export function crearFacturacionMock(opciones: OpcionesFacturacionMock = {}): FacturacionMock {
  const rangos: Record<Rango, Map<string, DocumentoMock>> = {
    factura: new Map(),
    credito: new Map(),
    debito: new Map(),
  }
  const consecutivos: Record<Rango, number> = { ...NUMERO_INICIAL }
  const emisiones: (SolicitudFactura | SolicitudNota)[] = []
  const correos: CorreoMock[] = []

  const mock: FacturacionMock = {
    escenario: opciones.escenario ?? 'emitida',
    emisiones,
    correos,
    documentos: () => Object.values(rangos).flatMap((rango) => [...rango.values()]),

    async emitirFactura(solicitud) {
      const documento = emitir('factura', solicitud)
      return resultado(documento, (): DatosFactura => {
        const { codigo, qrUrl, urlPublica } = enlaces(documento)
        return { numero: documento.numero, cufe: codigo, qrUrl, urlPublica }
      })
    },

    async emitirNota(solicitud) {
      validarNota(solicitud)
      const factura = [...rangos.factura.values()].find((doc) => doc.numero === solicitud.numeroFactura)
      if (factura?.estado !== 'emitida') {
        throw invalido(`La factura ${solicitud.numeroFactura} no existe o no está validada`)
      }
      const documento = emitir(solicitud.tipo, solicitud)
      return resultado(documento, (): DatosNota => {
        const { codigo, qrUrl, urlPublica } = enlaces(documento)
        return { numero: documento.numero, cude: codigo, qrUrl, urlPublica }
      })
    },

    eliminarFactura: async (referencia) => eliminar('factura', referencia),
    eliminarNota: async (tipo, referencia) => eliminar(tipo, referencia),
    descargarPdf: async (numero) => pdf('factura', numero),
    descargarPdfNota: async (tipo, numero) => pdf(tipo, numero),
    enviarCorreo: async (numero, correo) => enviar('factura', numero, correo),
    enviarCorreoNota: async (tipo, numero, correo) => enviar(tipo, numero, correo),
  }

  function emitir(rango: Rango, solicitud: SolicitudFactura | SolicitudNota): DocumentoMock {
    validarSolicitud(solicitud)
    emisiones.push(solicitud)
    const documentos = rangos[rango]
    const existente = documentos.get(solicitud.referencia)

    // Como Factus: con la referencia ya validada devuelve el mismo documento, aunque los datos cambien.
    if (existente?.estado === 'emitida') return existente
    if (existente?.estado === 'rechazada') {
      throw conflicto(`La ${NOMBRE[rango]} ${solicitud.referencia} fue rechazada: elimínala antes de reenviarla`)
    }
    const bloqueo = [...documentos.values()].find(
      (doc) => doc.estado !== 'emitida' && doc.referencia !== solicitud.referencia,
    )
    if (bloqueo) {
      throw conflicto(`La ${NOMBRE[rango]} ${bloqueo.referencia} está pendiente y bloquea el rango`)
    }

    const decidir = mock.escenario
    const estado = typeof decidir === 'function' ? decidir(solicitud) : decidir
    const numero = existente?.numero ?? `${PREFIJO[rango]}${++consecutivos[rango]}`
    const documento: DocumentoMock = { rango, referencia: solicitud.referencia, numero, estado, solicitud }
    documentos.set(solicitud.referencia, documento)
    return documento
  }

  function resultado<Datos>(documento: DocumentoMock, datos: () => Datos): ResultadoEmision<Datos> {
    if (documento.estado === 'emitida') return { estado: 'emitida', datos: datos() }
    if (documento.estado === 'rechazada') return { estado: 'rechazada', errores: [ERROR_RECHAZO] }
    return { estado: 'en_validacion', detalle: DETALLE_EN_VALIDACION }
  }

  function enlaces(documento: DocumentoMock) {
    const codigo = huella(`${documento.rango}:${documento.referencia}`)
    return {
      codigo,
      qrUrl: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${codigo}`,
      urlPublica: `https://factus.mock.invalid/documentos/${documento.numero}`,
    }
  }

  function eliminar(rango: Rango, referencia: string) {
    const documento = rangos[rango].get(referencia)
    if (!documento) throw noEncontrado(`No hay una ${NOMBRE[rango]} con la referencia ${referencia}`)
    if (documento.estado === 'emitida') throw invalido(`La ${NOMBRE[rango]} ${referencia} ya está validada`)
    if (documento.estado === 'en_validacion') {
      // El contrato lo prohíbe: la DIAN todavía puede validarla.
      throw invalido(`La ${NOMBRE[rango]} ${referencia} está en validación y no se elimina`)
    }
    rangos[rango].delete(referencia)
  }

  function emitida(rango: Rango, numero: string) {
    const documento = [...rangos[rango].values()].find((doc) => doc.numero === numero)
    if (documento?.estado !== 'emitida') throw noEncontrado(`No hay una ${NOMBRE[rango]} emitida con el número ${numero}`)
    return documento
  }

  function pdf(rango: Rango, numero: string): PdfFactura {
    emitida(rango, numero)
    return { nombreArchivo: `${numero}.pdf`, base64: PDF_BASE64 }
  }

  function enviar(rango: Rango, numero: string, correo: string) {
    emitida(rango, numero)
    correos.push({ rango, numero, correo })
  }

  return mock
}
