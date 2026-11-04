// Lo que escribe la persona pasa por aquí antes de volverse una orden. Son las mismas reglas del contrato,
// para avisar antes de enviar; el backend las vuelve a revisar.

import { MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO, saldoAcreditable } from '../../../contratos/reglas'
import {
  type CambiosProducto,
  type Comprador,
  type ConceptoNotaCredito,
  type ConceptoNotaDebito,
  type ItemPago,
  type LineaNota,
  type MedioPago,
  type NuevoPersonal,
  type NuevoProducto,
  type Pesos,
  type Producto,
  type ResumenNota,
  type RolPersonal,
  type SolicitudNotaNueva,
  type SolicitudReintentoFactura,
  type TipoNota,
} from '../../../contratos/tipos'
import { armarComprador } from '../cliente/HojaPagar'
import { compradorValido, correoValido } from '../datos/comprador'
import { comoErrorDatos, type FuenteDatos } from '../datos/fuente'
import { pesos } from '../ui/formato'

export type Errores<Campo extends string> = Partial<Record<Campo, string>>

/** "32.400", "$ 32 400" o "32400" son el mismo entero. null si no lo es. */
export function leerEntero(texto: string): number | null {
  const limpio = texto.replace(/[\s.$]/g, '')
  return /^\d+$/.test(limpio) ? Number(limpio) : null
}

// Producto

export interface FormularioProducto {
  nombre: string
  descripcion: string
  categoria: string
  precio: string
  llevaStock: boolean
  stock: string
  disponible: boolean
  imagenUrl: string
}

export type CampoProducto = 'nombre' | 'categoria' | 'precio' | 'stock'

export const formularioDeProducto = (producto?: Producto): FormularioProducto => ({
  nombre: producto?.nombre ?? '',
  descripcion: producto?.descripcion ?? '',
  categoria: producto?.categoria ?? '',
  precio: producto ? String(producto.precio) : '',
  llevaStock: producto ? producto.stock !== null : false,
  stock: producto?.stock === null || producto?.stock === undefined ? '' : String(producto.stock),
  disponible: producto?.disponible ?? true,
  imagenUrl: producto?.imagenUrl ?? '',
})

export function leerProducto(formulario: FormularioProducto): { valor: NuevoProducto } | { errores: Errores<CampoProducto> } {
  const errores: Errores<CampoProducto> = {}
  const nombre = formulario.nombre.trim()
  const categoria = formulario.categoria.trim()
  const precio = leerEntero(formulario.precio)
  const stock = formulario.llevaStock ? leerEntero(formulario.stock) : null
  if (!nombre) errores.nombre = 'Escribe el nombre.'
  if (!categoria) errores.categoria = 'Escribe la categoría.'
  if (precio === null || precio < 1) errores.precio = 'Escribe el precio en pesos, sin centavos.'
  if (formulario.llevaStock && stock === null) errores.stock = 'Escribe cuántas unidades quedan.'
  if (Object.keys(errores).length > 0 || precio === null) return { errores }
  return {
    valor: {
      nombre,
      descripcion: formulario.descripcion.trim() || null,
      categoria,
      precio,
      stock,
      // Con stock en 0 el producto queda agotado, como dice el contrato.
      disponible: stock === 0 ? false : formulario.disponible,
      imagenUrl: formulario.imagenUrl.trim() || null,
    },
  }
}

/** Solo lo que cambió: el stock baja mientras el formulario está abierto y no se debe pisar. */
export function cambiosDeProducto(antes: Producto, despues: NuevoProducto): CambiosProducto {
  const cambios: Record<string, unknown> = {}
  for (const clave of Object.keys(despues) as (keyof NuevoProducto)[]) {
    if (despues[clave] !== antes[clave]) cambios[clave] = despues[clave]
  }
  return cambios as CambiosProducto
}

// Personal

export const CLAVE_MINIMA = 8

export interface FormularioPersonal {
  correo: string
  nombre: string
  rol: RolPersonal
  clave: string
}

export type CampoPersonal = 'correo' | 'nombre' | 'clave'

export const FORMULARIO_PERSONAL_VACIO: FormularioPersonal = { correo: '', nombre: '', rol: 'mesero', clave: '' }

export function leerPersonal(formulario: FormularioPersonal): { valor: NuevoPersonal } | { errores: Errores<CampoPersonal> } {
  const errores: Errores<CampoPersonal> = {}
  const correo = formulario.correo.trim().toLowerCase()
  const nombre = formulario.nombre.trim()
  if (!correoValido(correo)) errores.correo = 'Ese correo no parece válido.'
  if (!nombre) errores.nombre = 'Escribe el nombre.'
  if (formulario.clave.length < CLAVE_MINIMA) errores.clave = `La clave necesita al menos ${CLAVE_MINIMA} caracteres.`
  if (Object.keys(errores).length > 0) return { errores }
  return { valor: { correo, nombre, rol: formulario.rol, clave: formulario.clave } }
}

export type ResultadoPersonal =
  | { estado: 'creado' }
  | { estado: 'invalido'; errores: Errores<CampoPersonal> }
  /** El correo ya existe: se marca en su campo, sin perder lo que se escribió. */
  | { estado: 'correo_en_uso' }
  | { estado: 'error'; error: unknown }

export async function enviarPersonal(
  operaciones: Pick<FuenteDatos, 'crearPersonal'>,
  restauranteId: string,
  formulario: FormularioPersonal,
): Promise<ResultadoPersonal> {
  const leido = leerPersonal(formulario)
  if ('errores' in leido) return { estado: 'invalido', errores: leido.errores }
  try {
    await operaciones.crearPersonal(restauranteId, leido.valor)
    return { estado: 'creado' }
  } catch (error) {
    return comoErrorDatos(error).codigo === 'CORREO_EN_USO' ? { estado: 'correo_en_uso' } : { estado: 'error', error }
  }
}

// Comprador, para corregir una factura o una nota rechazada

export type DatosComprador = Parameters<typeof armarComprador>[1]

export function datosDeComprador(comprador: Comprador): DatosComprador {
  const base: DatosComprador = { correo: comprador.correo ?? '', tipoDocumento: 'CC', documento: '', nombre: '', nit: '', razonSocial: '' }
  if (comprador.tipo === 'persona') return { ...base, tipoDocumento: comprador.tipoDocumento, documento: comprador.documento, nombre: comprador.nombre }
  if (comprador.tipo === 'empresa') return { ...base, nit: comprador.nit, razonSocial: comprador.razonSocial }
  return base
}

/** Si nada cambió, `comprador` va en null: es lo que el contrato pide cuando el error no estaba ahí. */
export function solicitudReintento(original: Comprador, tipo: Comprador['tipo'], datos: DatosComprador): SolicitudReintentoFactura | null {
  const nuevo = armarComprador(tipo, datos)
  if (!compradorValido(nuevo)) return null
  const igual = JSON.stringify(nuevo) === JSON.stringify(armarComprador(original.tipo, datosDeComprador(original)))
  return { comprador: igual ? null : nuevo }
}

// Notas

export interface LineaFormulario {
  descripcion: string
  cantidad: string
  precio: string
}

export interface FormularioNota {
  tipo: TipoNota
  concepto: ConceptoNotaCredito | ConceptoNotaDebito
  motivo: string
  lineas: LineaFormulario[]
  medio: MedioPago
}

export const LINEA_VACIA: LineaFormulario = { descripcion: '', cantidad: '1', precio: '' }

export const lineaDeItem = (item: ItemPago): LineaFormulario => ({ descripcion: item.nombre, cantidad: '1', precio: String(item.precio) })

export function leerLineas(lineas: readonly LineaFormulario[]): LineaNota[] | null {
  const leidas: LineaNota[] = []
  for (const linea of lineas) {
    const cantidad = leerEntero(linea.cantidad)
    const precio = leerEntero(linea.precio)
    if (!linea.descripcion.trim() || cantidad === null || cantidad < 1 || precio === null || precio < 1) return null
    leidas.push({ descripcion: linea.descripcion.trim(), cantidad, precio })
  }
  return leidas.length > 0 ? leidas : null
}

export interface ContextoNota {
  /** Lo que pagó el cliente, con impuesto y propina. */
  totalPago: Pesos
  notas: readonly ResumenNota[]
}

export const saldoDe = ({ totalPago, notas }: ContextoNota) => saldoAcreditable(totalPago, notas)

/** Una anulación copia la factura completa: si ya se acreditó una parte, no cabe. */
export const puedeAnular = (contexto: ContextoNota) => contexto.totalPago <= saldoDe(contexto)

export type NotaLeida = { solicitud: SolicitudNotaNueva; total: Pesos } | { error: string; total: Pesos | null }

/** Devuelve la orden lista para enviar, o qué falta. `total` se muestra aunque aún haya errores. */
export function leerNota(formulario: FormularioNota, contexto: ContextoNota): NotaLeida {
  const motivo = formulario.motivo.trim()
  const saldo = saldoDe(contexto)

  if (formulario.tipo === 'credito' && formulario.concepto === 'anulacion') {
    const total = contexto.totalPago
    if (!puedeAnular(contexto)) return { error: `Ya se acreditó parte de esta factura. Quedan ${pesos(saldo)}: usa otro concepto.`, total }
    if (!motivo) return { error: 'Escribe el motivo de la nota.', total }
    return { solicitud: { tipo: 'credito', concepto: 'anulacion', motivo }, total }
  }

  const lineas = leerLineas(formulario.lineas)
  if (!lineas) return { error: 'Cada línea necesita descripción, cantidad y precio.', total: null }
  const total = lineas.reduce((suma, linea) => suma + linea.precio * linea.cantidad, 0)

  if (formulario.tipo === 'credito') {
    if (total > saldo) return { error: `La nota supera lo que queda por acreditar: ${pesos(saldo)}.`, total }
    if (!motivo) return { error: 'Escribe el motivo de la nota.', total }
    return { solicitud: { tipo: 'credito', concepto: formulario.concepto as Exclude<ConceptoNotaCredito, 'anulacion'>, motivo, lineas }, total }
  }

  if (formulario.medio === 'factus_pay' && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)) {
    return { error: `Factus Pay solo cobra de ${pesos(MONTO_MINIMO_COBRO)} a ${pesos(MONTO_MAXIMO_COBRO)}. Usa efectivo o tarjeta.`, total }
  }
  if (!motivo) return { error: 'Escribe el motivo de la nota.', total }
  return { solicitud: { tipo: 'debito', concepto: formulario.concepto as ConceptoNotaDebito, motivo, lineas, medio: formulario.medio }, total }
}
