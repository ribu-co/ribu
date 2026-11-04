// ServicioFacturacion contra Factus v2. El token, los rangos y los errores están en conexion.ts.

import { ErrorIntegracion } from '../contratos/reglas'
import type {
  Comprador,
  DatosFactura,
  Impuesto,
  LineaFactura,
  MedioPago,
  ResultadoEmision,
  ServicioFacturacion,
  SolicitudFactura,
  TipoDocumento,
} from '../contratos/tipos'
import { calcularTotales, dosDecimales, validarSolicitud } from './calculo'
import { crearConexionFactus, type ConfigFactus, type ConexionFactus, type Rango } from './conexion'

export type { ConfigFactus } from './conexion'

/** Lo que Factus llama `payment_method_code`. Bre-B no tiene código propio: va como transferencia. */
export const CODIGO_MEDIO_PAGO: Record<MedioPago, string> = {
  factus_pay: '47',
  efectivo: '10',
  tarjeta_debito: '49',
  tarjeta_credito: '48',
}

/** Lo que Factus llama `identification_document_code`. */
export const CODIGO_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  CC: '13',
  CE: '22',
  NIT: '31',
  PASAPORTE: '41',
  PPT: '48',
}

/** POR CONFIRMAR en el sandbox: las preguntas frecuentes dicen 222222222222 y el ejemplo oficial 22222222222. */
export const DOCUMENTO_CONSUMIDOR_FINAL = '222222222222'

/** Contado. */
const FORMA_DE_PAGO = '1'
/** Unidad. */
const UNIDAD_DE_MEDIDA = '94'
/** Estándar de adopción del contribuyente. */
const ESTANDAR_PRODUCTO = '999'
/** Propina: recargo de concepto 03. */
const CONCEPTO_PROPINA = '03'

/** Factus recibe los montos como texto con dos decimales. */
const texto = (valor: number) => dosDecimales(valor).toFixed(2)

export function clienteFactus(comprador: Comprador) {
  const correo = comprador.correo ? { email: comprador.correo } : {}
  switch (comprador.tipo) {
    case 'consumidor_final':
      return {
        identification_document_code: CODIGO_TIPO_DOCUMENTO.CC,
        identification: DOCUMENTO_CONSUMIDOR_FINAL,
        names: 'Consumidor Final',
        legal_organization_code: '2',
        ...correo,
      }
    case 'persona':
      return {
        identification_document_code: CODIGO_TIPO_DOCUMENTO[comprador.tipoDocumento],
        identification: comprador.documento.trim(),
        names: comprador.nombre.trim(),
        legal_organization_code: '2',
        ...correo,
      }
    case 'empresa':
      // Sin `dv`: Factus lo calcula a partir del NIT.
      return {
        identification_document_code: CODIGO_TIPO_DOCUMENTO.NIT,
        identification: comprador.nit.trim(),
        company: comprador.razonSocial.trim(),
        legal_organization_code: '1',
        ...correo,
      }
  }
}

/** POR CONFIRMAR en el sandbox: cómo se envía un restaurante sin impuesto al consumo. */
export function impuestosFactus(impuesto: Impuesto) {
  const rate = texto(impuesto.porcentaje)
  if (impuesto.tipo === 'INC') return [{ code: '04', rate }]
  if (impuesto.tipo === 'IVA') return [{ code: '01', rate }]
  return [{ code: '01', rate: texto(0), is_excluded: true }]
}

export function itemFactus(linea: LineaFactura, impuesto: Impuesto) {
  return {
    code_reference: linea.codigo,
    name: linea.descripcion,
    quantity: texto(linea.cantidad),
    discount_rate: texto(0),
    price: texto(linea.precioSinImpuesto),
    unit_measure_code: UNIDAD_DE_MEDIDA,
    standard_code: ESTANDAR_PRODUCTO,
    taxes: impuestosFactus(impuesto),
  }
}

/** El cuerpo de `POST /v2/bills/validate`. También es la base de las notas. */
export function cuerpoFactura(solicitud: SolicitudFactura, rangoId: number) {
  const { redondeo } = calcularTotales(solicitud)
  return {
    reference_code: solicitud.referencia,
    numbering_range_id: rangoId,
    // En el sandbox no envía nada; el correo se pide aparte con enviarCorreo.
    send_email: false,
    payment_details: [
      {
        payment_form: FORMA_DE_PAGO,
        payment_method_code: CODIGO_MEDIO_PAGO[solicitud.medio],
        amount: texto(solicitud.total),
      },
    ],
    cash_rounding_amount: texto(redondeo),
    customer: clienteFactus(solicitud.comprador),
    items: solicitud.lineas.map((linea) => itemFactus(linea, solicitud.impuesto)),
    ...(solicitud.propina && solicitud.propina.valor > 0
      ? {
          allowance_charges: [
            {
              concept_type: CONCEPTO_PROPINA,
              is_surcharge: true,
              reason: 'propina',
              base_amount: texto(solicitud.propina.base),
              amount: texto(solicitud.propina.valor),
            },
          ],
        }
      : {}),
  }
}

/** Lo que importa de la respuesta de `validate`. Lo demás se ignora. */
export interface DocumentoFactus {
  number?: string | null
  cufe?: string | null
  cude?: string | null
  is_validated?: boolean | number | null
  errors?: unknown
  links?: { qr?: string | null; public_url?: string | null } | null
}

/** `errors` llega como objeto indexado por la regla, por ejemplo `{ "FAJ44b": "..." }`, o como lista. */
export function erroresFactus(errores: unknown): string[] {
  if (!errores) return []
  if (typeof errores === 'string') return [errores]
  if (Array.isArray(errores)) return errores.flatMap(erroresFactus)
  if (typeof errores === 'object') {
    return Object.entries(errores).flatMap(([regla, valor]) =>
      erroresFactus(valor).map((mensaje) => (mensaje.includes(regla) ? mensaje : `${regla}: ${mensaje}`)),
    )
  }
  return [String(errores)]
}

/**
 * `is_validated` en true: emitida. Si no, la palabra "rechazo" en `errors` significa que la DIAN la rechazó.
 * Sin rechazo, la DIAN está demorada. Reglas como FAJ44b o RUT01 son notificaciones, no rechazos.
 */
export function interpretarEmision<Datos>(
  documento: DocumentoFactus,
  datos: (documento: DocumentoFactus) => Datos,
): ResultadoEmision<Datos> {
  const errores = erroresFactus(documento.errors)
  if (documento.is_validated === true || documento.is_validated === 1) {
    return { estado: 'emitida', datos: datos(documento) }
  }
  if (errores.some((error) => /rechazo/i.test(error))) return { estado: 'rechazada', errores }
  return { estado: 'en_validacion', detalle: errores.length > 0 ? errores.join('. ') : null }
}

/** Sin estos datos la factura no sirve: se trata como un fallo de Factus y se reintenta. */
function exigir(valor: string | null | undefined, campo: string): string {
  if (!valor) throw new ErrorIntegracion(`Factus validó el documento pero no envió ${campo}`, 'factus', 'servidor')
  return valor
}

export function datosFactura(documento: DocumentoFactus): DatosFactura {
  return {
    numero: exigir(documento.number, 'number'),
    cufe: exigir(documento.cufe, 'cufe'),
    qrUrl: exigir(documento.links?.qr, 'links.qr'),
    urlPublica: exigir(documento.links?.public_url, 'links.public_url'),
  }
}

/** Crea y valida un documento en su rango. Si Factus ya no acepta el rango guardado, lo olvida. */
export async function validarEnRango(
  conexion: ConexionFactus,
  rango: Rango,
  ruta: string,
  armar: (rangoId: number) => unknown,
): Promise<DocumentoFactus> {
  const rangoId = await conexion.rangoActivo(rango)
  try {
    const respuesta = await conexion.pedir<{ data?: DocumentoFactus | null }>('POST', ruta, { cuerpo: armar(rangoId) })
    if (!respuesta?.data) throw new ErrorIntegracion('Factus respondió sin `data`', 'factus', 'servidor')
    return respuesta.data
  } catch (error) {
    if (error instanceof ErrorIntegracion && error.tipo === 'validacion' && /numbering_range/i.test(error.message)) {
      conexion.olvidarRango(rango)
    }
    throw error
  }
}

export function crearFacturacionFactus(config: ConfigFactus): Pick<ServicioFacturacion, 'emitirFactura'> {
  const conexion = crearConexionFactus(config)

  return {
    async emitirFactura(solicitud) {
      validarSolicitud(solicitud)
      const documento = await validarEnRango(conexion, 'factura', '/v2/bills/validate', (rangoId) =>
        cuerpoFactura(solicitud, rangoId),
      )
      return interpretarEmision(documento, datosFactura)
    },
  }
}
