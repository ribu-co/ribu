// Lee los cuerpos de la API. La web nunca manda precios, totales ni estados de pago.

import { PARTES_MAXIMAS, PARTES_MINIMAS, PROPINA_SUGERIDA_MAXIMA } from '../contratos/reglas'
import {
  CONCEPTOS_NOTA_CREDITO,
  CONCEPTOS_NOTA_DEBITO,
  MEDIOS_PAGO,
  ROLES_PERSONAL,
  TIPOS_DOCUMENTO,
  TIPOS_IMPUESTO,
  type CambiosPersonal,
  type CambiosProducto,
  type CambiosRestaurante,
  type Comprador,
  type DestinoPago,
  type Impuesto,
  type LineaNota,
  type MedioPago,
  type NuevoPersonal,
  type NuevoProducto,
  type NuevoRestaurante,
  type RolPersonal,
  type SolicitudCorreo,
  type SolicitudDivision,
  type SolicitudEstadoLinea,
  type SolicitudIdsLineas,
  type SolicitudLineas,
  type SolicitudMesas,
  type SolicitudMotivoLineas,
  type SolicitudNotaNueva,
  type SolicitudPago,
  type SolicitudReintentoFactura,
  type TipoDocumento,
} from '../contratos/tipos'
import { fallar } from './errores'

const invalido = (mensaje = 'Revisa los datos enviados'): never => fallar('CUERPO_INVALIDO', mensaje)

const MAXIMO_ITEMS = 50
const CANTIDAD_MAXIMA = 99
const MOTIVO_MAXIMO = 500
const TEXTO_MAXIMO = 200
const PRECIO_MAXIMO = 100_000_000
const MESAS_MAXIMAS = 200
const CLAVE_MINIMA = 8

type Objeto = Record<string, unknown>

const objeto = (valor: unknown): Objeto =>
  valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Objeto) : invalido()

const texto = (valor: unknown, maximo = TEXTO_MAXIMO): string =>
  typeof valor === 'string' && valor.trim() !== '' && valor.length <= maximo ? valor.trim() : invalido()

const entero = (valor: unknown, minimo: number, maximo: number): number =>
  Number.isInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo
    ? (valor as number)
    : invalido()

const dentro = <T extends string>(lista: readonly T[], valor: unknown): valor is T =>
  typeof valor === 'string' && (lista as readonly string[]).includes(valor)

const sinCamposDeMas = (cuerpo: Objeto, permitidos: readonly string[]) => {
  if (Object.keys(cuerpo).some((campo) => !permitidos.includes(campo))) invalido('Hay campos que no se pueden cambiar')
}

// Los ids viajan a rutas de Firestore: una barra permitiría salirse de la colección.
export const idSeguro = (valor: string) => /^[A-Za-z0-9_-]{1,128}$/.test(valor)

export const correoValido = (valor: unknown): valor is string =>
  typeof valor === 'string' && valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)

export function leerSolicitudLineas(cuerpo: unknown): SolicitudLineas {
  const { items } = objeto(cuerpo)
  if (!Array.isArray(items) || items.length === 0 || items.length > MAXIMO_ITEMS) return invalido('El pedido está vacío')
  return {
    items: items.map((crudo) => {
      const item = objeto(crudo)
      const productoId = texto(item.productoId)
      if (!idSeguro(productoId)) invalido()
      return {
        productoId,
        cantidad: entero(item.cantidad, 1, CANTIDAD_MAXIMA),
        nota: item.nota === null || item.nota === undefined ? null : texto(item.nota),
      }
    }),
  }
}

function ids(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAXIMO_ITEMS * 2) return invalido()
  return valor.map((id) => texto(id))
}

export const leerIdsLineas = (cuerpo: unknown): SolicitudIdsLineas => ({ lineaIds: ids(objeto(cuerpo).lineaIds) })

export function leerMotivoLineas(cuerpo: unknown): SolicitudMotivoLineas {
  const { lineaIds, motivo } = objeto(cuerpo)
  return { lineaIds: ids(lineaIds), motivo: texto(motivo, MOTIVO_MAXIMO) }
}

export function leerEstadoLinea(cuerpo: unknown): SolicitudEstadoLinea {
  const { estado } = objeto(cuerpo)
  return dentro(['en_preparacion', 'lista', 'entregada'] as const, estado) ? { estado } : invalido()
}

export const leerDivision = (cuerpo: unknown): SolicitudDivision => ({
  partes: entero(objeto(cuerpo).partes, PARTES_MINIMAS, PARTES_MAXIMAS),
})

function leerDestino(valor: unknown): DestinoPago {
  const destino = objeto(valor)
  if (destino.tipo === 'saldo') return { tipo: 'saldo' }
  if (destino.tipo === 'parte_igual') return { tipo: 'parte_igual', parte: entero(destino.parte, 1, PARTES_MAXIMAS) }
  if (destino.tipo === 'productos') {
    const { items } = destino
    if (!Array.isArray(items) || items.length === 0 || items.length > MAXIMO_ITEMS * 2) return invalido()
    return {
      tipo: 'productos',
      items: items.map((crudo) => {
        const item = objeto(crudo)
        return { lineaId: texto(item.lineaId), cantidad: entero(item.cantidad, 1, CANTIDAD_MAXIMA) }
      }),
    }
  }
  return invalido()
}

const compradorInvalido = (mensaje: string): never => fallar('COMPRADOR_INVALIDO', mensaje)

/** Los errores de contenido son COMPRADOR_INVALIDO; la web los muestra junto al formulario. */
export function leerComprador(valor: unknown): Comprador {
  const crudo = objeto(valor)
  const nombre = (campo: unknown, etiqueta: string) =>
    typeof campo === 'string' && campo.trim() !== '' && campo.length <= TEXTO_MAXIMO
      ? campo.trim()
      : compradorInvalido(`Falta ${etiqueta}`)
  const correoExigido = (campo: unknown) =>
    correoValido(campo) ? campo.trim() : compradorInvalido('El correo no parece válido')

  if (crudo.tipo === 'consumidor_final') {
    if (crudo.correo === null || crudo.correo === undefined) return { tipo: 'consumidor_final', correo: null }
    return { tipo: 'consumidor_final', correo: correoExigido(crudo.correo) }
  }
  if (crudo.tipo === 'persona') {
    if (!dentro<TipoDocumento>(TIPOS_DOCUMENTO, crudo.tipoDocumento)) return compradorInvalido('Falta el tipo de documento')
    const documento = nombre(crudo.documento, 'el documento')
    if (!/^[A-Za-z0-9-]{3,20}$/.test(documento)) compradorInvalido('El documento no parece válido')
    return {
      tipo: 'persona',
      tipoDocumento: crudo.tipoDocumento,
      documento,
      nombre: nombre(crudo.nombre, 'el nombre'),
      correo: correoExigido(crudo.correo),
    }
  }
  if (crudo.tipo === 'empresa') {
    const nit = nombre(crudo.nit, 'el NIT')
    if (!/^\d{5,15}$/.test(nit)) compradorInvalido('El NIT va sin dígito de verificación')
    return { tipo: 'empresa', nit, razonSocial: nombre(crudo.razonSocial, 'la razón social'), correo: correoExigido(crudo.correo) }
  }
  return compradorInvalido('Falta el tipo de comprador')
}

/** La propina y el comprador se revisan en el servicio, con su propio código de error. */
export function leerSolicitudPago(cuerpo: unknown): SolicitudPago {
  const crudo = objeto(cuerpo)
  if (!dentro<MedioPago>(MEDIOS_PAGO, crudo.medio)) return invalido('Falta el medio de pago')
  if (crudo.comprador === undefined) return invalido('Falta el comprador')
  if (typeof crudo.propinaPorcentaje !== 'number') return invalido('La propina es obligatoria')
  return {
    destino: leerDestino(crudo.destino),
    propinaPorcentaje: crudo.propinaPorcentaje,
    comprador: crudo.comprador as Comprador,
    medio: crudo.medio,
  }
}

export function leerCorreo(cuerpo: unknown): SolicitudCorreo {
  const { correo } = objeto(cuerpo)
  return correoValido(correo) ? { correo: correo.trim() } : invalido('Ese correo no parece válido')
}

export function leerReintento(cuerpo: unknown): SolicitudReintentoFactura {
  const { comprador } = objeto(cuerpo)
  if (comprador === undefined) return invalido('Falta el comprador')
  return { comprador: comprador === null ? null : leerComprador(comprador) }
}

const notaInvalida = (mensaje: string): never => fallar('NOTA_INVALIDA', mensaje)

function lineasNota(valor: unknown): LineaNota[] {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > MAXIMO_ITEMS) return notaInvalida('La nota no tiene líneas')
  return valor.map((crudo) => {
    const linea = objeto(crudo)
    const { descripcion, cantidad, precio } = linea
    if (typeof descripcion !== 'string' || descripcion.trim() === '' || descripcion.length > TEXTO_MAXIMO) {
      return notaInvalida('Falta la descripción de una línea')
    }
    if (!Number.isInteger(cantidad) || (cantidad as number) < 1) return notaInvalida('La cantidad debe ser un entero positivo')
    if (!Number.isInteger(precio) || (precio as number) < 1 || (precio as number) > PRECIO_MAXIMO) {
      return notaInvalida('El precio debe ser un entero positivo')
    }
    return { descripcion: descripcion.trim(), cantidad: cantidad as number, precio: precio as number }
  })
}

export function leerSolicitudNota(cuerpo: unknown): SolicitudNotaNueva {
  const crudo = objeto(cuerpo)
  const { tipo, concepto } = crudo
  if (typeof crudo.motivo !== 'string' || crudo.motivo.trim() === '' || crudo.motivo.length > MOTIVO_MAXIMO) {
    return notaInvalida(`El motivo va de 1 a ${MOTIVO_MAXIMO} caracteres`)
  }
  const motivo = crudo.motivo.trim()

  if (tipo === 'credito') {
    if (concepto === 'anulacion') return { tipo, concepto, motivo }
    if (!dentro(CONCEPTOS_NOTA_CREDITO, concepto)) return notaInvalida('Ese concepto no es de una nota crédito')
    return { tipo, concepto, motivo, lineas: lineasNota(crudo.lineas) }
  }
  if (tipo === 'debito') {
    if (!dentro(CONCEPTOS_NOTA_DEBITO, concepto)) return notaInvalida('Ese concepto no es de una nota débito')
    if (!dentro<MedioPago>(MEDIOS_PAGO, crudo.medio)) return notaInvalida('Falta el medio de pago')
    return { tipo, concepto, motivo, lineas: lineasNota(crudo.lineas), medio: crudo.medio }
  }
  return notaInvalida('La nota es crédito o débito')
}

function leerImpuesto(valor: unknown): Impuesto {
  const { tipo, porcentaje } = objeto(valor)
  if (!dentro(TIPOS_IMPUESTO, tipo) || typeof porcentaje !== 'number') return invalido('Revisa el impuesto')
  if (tipo === 'ninguno' ? porcentaje !== 0 : !(porcentaje > 0 && porcentaje <= 100)) return invalido('Revisa el impuesto')
  return { tipo, porcentaje }
}

function leerPropinas(valor: unknown): number[] {
  if (!Array.isArray(valor) || valor.length > 10) return invalido('Revisa las propinas sugeridas')
  return valor.map((propina) => entero(propina, 0, PROPINA_SUGERIDA_MAXIMA))
}

export function leerNuevoRestaurante(cuerpo: unknown): NuevoRestaurante {
  const crudo = objeto(cuerpo)
  return {
    nombre: texto(crudo.nombre),
    impuesto: leerImpuesto(crudo.impuesto),
    propinasSugeridas: leerPropinas(crudo.propinasSugeridas),
    mesas: entero(crudo.mesas, 1, MESAS_MAXIMAS),
  }
}

export function leerCambiosRestaurante(cuerpo: unknown): CambiosRestaurante {
  const crudo = objeto(cuerpo)
  sinCamposDeMas(crudo, ['nombre', 'impuesto', 'propinasSugeridas', 'activo'])
  const cambios: CambiosRestaurante = {}
  if (crudo.nombre !== undefined) cambios.nombre = texto(crudo.nombre)
  if (crudo.impuesto !== undefined) cambios.impuesto = leerImpuesto(crudo.impuesto)
  if (crudo.propinasSugeridas !== undefined) cambios.propinasSugeridas = leerPropinas(crudo.propinasSugeridas)
  if (crudo.activo !== undefined) cambios.activo = typeof crudo.activo === 'boolean' ? crudo.activo : invalido()
  return cambios
}

export const leerMesas = (cuerpo: unknown): SolicitudMesas => ({
  cantidad: entero(objeto(cuerpo).cantidad, 1, MESAS_MAXIMAS),
})

const claveNueva = (valor: unknown): string =>
  typeof valor === 'string' && valor.length >= CLAVE_MINIMA && valor.length <= 128
    ? valor
    : invalido(`La clave debe tener al menos ${CLAVE_MINIMA} caracteres`)

export function leerNuevoPersonal(cuerpo: unknown): NuevoPersonal {
  const crudo = objeto(cuerpo)
  if (!correoValido(crudo.correo)) return invalido('Ese correo no parece válido')
  if (!dentro<RolPersonal>(ROLES_PERSONAL, crudo.rol)) return invalido('Ese rol no existe')
  return { correo: crudo.correo.trim().toLowerCase(), nombre: texto(crudo.nombre), rol: crudo.rol, clave: claveNueva(crudo.clave) }
}

export function leerCambiosPersonal(cuerpo: unknown): CambiosPersonal {
  const crudo = objeto(cuerpo)
  sinCamposDeMas(crudo, ['nombre', 'rol', 'activo', 'clave'])
  const cambios: CambiosPersonal = {}
  if (crudo.nombre !== undefined) cambios.nombre = texto(crudo.nombre)
  if (crudo.rol !== undefined) cambios.rol = dentro<RolPersonal>(ROLES_PERSONAL, crudo.rol) ? crudo.rol : invalido('Ese rol no existe')
  if (crudo.activo !== undefined) cambios.activo = typeof crudo.activo === 'boolean' ? crudo.activo : invalido()
  if (crudo.clave !== undefined) cambios.clave = claveNueva(crudo.clave)
  return cambios
}

const textoONulo = (valor: unknown, maximo?: number): string | null => (valor === null ? null : texto(valor, maximo))
const stock = (valor: unknown): number | null => (valor === null ? null : entero(valor, 0, 1_000_000))

export function leerNuevoProducto(cuerpo: unknown): NuevoProducto {
  const crudo = objeto(cuerpo)
  if (typeof crudo.disponible !== 'boolean') return invalido()
  return {
    nombre: texto(crudo.nombre),
    descripcion: textoONulo(crudo.descripcion ?? null, MOTIVO_MAXIMO),
    categoria: texto(crudo.categoria),
    precio: entero(crudo.precio, 0, PRECIO_MAXIMO),
    stock: stock(crudo.stock ?? null),
    disponible: crudo.disponible,
    imagenUrl: textoONulo(crudo.imagenUrl ?? null, 2_000),
  }
}

export function leerCambiosProducto(cuerpo: unknown): CambiosProducto {
  const crudo = objeto(cuerpo)
  sinCamposDeMas(crudo, ['nombre', 'descripcion', 'categoria', 'precio', 'stock', 'disponible', 'imagenUrl'])
  const cambios: CambiosProducto = {}
  if (crudo.nombre !== undefined) cambios.nombre = texto(crudo.nombre)
  if (crudo.descripcion !== undefined) cambios.descripcion = textoONulo(crudo.descripcion, MOTIVO_MAXIMO)
  if (crudo.categoria !== undefined) cambios.categoria = texto(crudo.categoria)
  if (crudo.precio !== undefined) cambios.precio = entero(crudo.precio, 0, PRECIO_MAXIMO)
  if (crudo.stock !== undefined) cambios.stock = stock(crudo.stock)
  if (crudo.disponible !== undefined) cambios.disponible = typeof crudo.disponible === 'boolean' ? crudo.disponible : invalido()
  if (crudo.imagenUrl !== undefined) cambios.imagenUrl = textoONulo(crudo.imagenUrl, 2_000)
  return cambios
}
