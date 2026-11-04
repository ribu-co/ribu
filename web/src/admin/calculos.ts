// Los números del dashboard, sin React ni fuente de datos: entran documentos y salen cifras.
// Lo que no tiene datos devuelve null, para que la pantalla muestre un estado vacío y no un cero inventado.

import { MEDIOS_PAGO, type Cuenta, type Factura, type MedioPago, type Nota, type Pago, type Pesos, type Producto } from '../../../contratos/tipos'

/** Colombia no cambia de hora: "hoy" es el día del restaurante, no el del navegador ni el de UTC. */
export const ZONA_RESTAURANTE = 'America/Bogota'

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_RESTAURANTE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 2026-11-04 */
export const diaColombia = (fecha: Date | string) => formatoDia.format(new Date(fecha))

export const PERIODOS = ['siete', 'treinta', 'mes'] as const
export type Periodo = (typeof PERIODOS)[number]

export interface Rango {
  desde: string
  hasta: string
}

function restarDias(dia: string, dias: number) {
  const fecha = new Date(`${dia}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

export function rangoDePeriodo(periodo: Periodo, ahora: Date): Rango {
  const hoy = diaColombia(ahora)
  if (periodo === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy }
  return { desde: restarDias(hoy, periodo === 'siete' ? 6 : 29), hasta: hoy }
}

const dentroDe = (rango: Rango, fecha: string) => {
  const dia = diaColombia(fecha)
  return dia >= rango.desde && dia <= rango.hasta
}

/** Solo cuenta la plata que entró y se quedó: un `pago_duplicado` se devuelve por fuera. */
export const esVenta = (pago: Pago) => pago.estado === 'pagado' && pago.incidencia === null

const fechaDePago = (pago: Pago) => pago.pagadoEn ?? pago.creadoEn

export const ventasDentroDe = (pagos: readonly Pago[], rango: Rango) =>
  pagos.filter((pago) => esVenta(pago) && dentroDe(rango, fechaDePago(pago)))

export interface ResumenVentas {
  /** Lo consumido, con impuesto y sin propina. */
  ventas: Pesos
  /** Lo que entró de verdad: ventas + propinas. */
  cobrado: Pesos
  pagos: number
  /** Ventas entre pagos, sin propina. */
  ticketPromedio: Pesos
  propinas: Pesos
  /** Lo que ya viene incluido en las ventas. */
  impuestos: Pesos
}

export function resumirVentas(ventas: readonly Pago[]): ResumenVentas | null {
  if (ventas.length === 0) return null
  const sumar = (valor: (pago: Pago) => number) => ventas.reduce((suma, pago) => suma + valor(pago), 0)
  const total = sumar((pago) => pago.subtotal)
  return {
    ventas: total,
    cobrado: sumar((pago) => pago.total),
    pagos: ventas.length,
    ticketPromedio: Math.round(total / ventas.length),
    propinas: sumar((pago) => pago.propina),
    impuestos: Math.round(sumar((pago) => pago.subtotal - pago.baseSinImpuesto)),
  }
}

export interface FilaMedio {
  medio: MedioPago
  pagos: number
  monto: Pesos
  /** De 0 a 1, sobre todo lo cobrado. */
  fraccion: number
}

/** Con propina, porque es lo que entró por cada medio. La más grande primero. */
export function pagosPorMedio(ventas: readonly Pago[]): FilaMedio[] {
  const cobrado = ventas.reduce((suma, pago) => suma + pago.total, 0)
  return MEDIOS_PAGO.map((medio) => {
    const delMedio = ventas.filter((pago) => pago.medio === medio)
    const monto = delMedio.reduce((suma, pago) => suma + pago.total, 0)
    return { medio, pagos: delMedio.length, monto, fraccion: cobrado > 0 ? monto / cobrado : 0 }
  })
    .filter((fila) => fila.pagos > 0)
    .sort((a, b) => b.monto - a.monto)
}

export interface ResumenFacturas {
  /** Emitidas dentro del periodo. */
  emitidas: number
  /** Lo demás es lo que falta por resolver hoy, sin importar cuándo se pagó. */
  enProceso: number
  enValidacion: number
  rechazadas: number
}

export function resumirFacturas(facturas: readonly Factura[], rango: Rango): ResumenFacturas | null {
  // `sin_emitir` es un pago que no ha entrado: todavía no hay nada que facturar.
  const reales = facturas.filter((factura) => factura.estado !== 'sin_emitir')
  if (reales.length === 0) return null
  const contar = (estado: Factura['estado']) => reales.filter((factura) => factura.estado === estado).length
  return {
    emitidas: reales.filter((f) => f.estado === 'emitida' && f.emitidaEn !== null && dentroDe(rango, f.emitidaEn)).length,
    enProceso: contar('en_proceso'),
    enValidacion: contar('en_validacion'),
    rechazadas: contar('rechazada'),
  }
}

export interface ResumenNotas {
  creditos: { cantidad: number; total: Pesos }
  debitos: { cantidad: number; total: Pesos }
  /** Plata que el restaurante debe devolver por fuera. Una nota rechazada no obliga a devolver. */
  devolucionesPendientes: { cantidad: number; total: Pesos }
  rechazadas: number
}

export function resumirNotas(notas: readonly Nota[], rango: Rango): ResumenNotas | null {
  if (notas.length === 0) return null
  const acumular = (lista: readonly Nota[]) => ({ cantidad: lista.length, total: lista.reduce((suma, nota) => suma + nota.total, 0) })
  const emitidas = notas.filter((nota) => nota.estado === 'emitida' && nota.emitidaEn !== null && dentroDe(rango, nota.emitidaEn))
  return {
    creditos: acumular(emitidas.filter((nota) => nota.tipo === 'credito')),
    debitos: acumular(emitidas.filter((nota) => nota.tipo === 'debito')),
    devolucionesPendientes: acumular(notas.filter((nota) => nota.devolucion === 'pendiente' && nota.estado !== 'rechazada')),
    rechazadas: notas.filter((nota) => nota.estado === 'rechazada').length,
  }
}

export interface ResumenMesas {
  mesas: number
  porPagar: Pesos
  enCobro: Pesos
}

export function resumirMesasAbiertas(cuentas: readonly Cuenta[]): ResumenMesas {
  const abiertas = cuentas.filter((cuenta) => cuenta.estado !== 'cerrada')
  return {
    mesas: new Set(abiertas.map((cuenta) => cuenta.mesaToken)).size,
    porPagar: abiertas.reduce((suma, cuenta) => suma + cuenta.porPagar, 0),
    enCobro: abiertas.reduce((suma, cuenta) => suma + cuenta.enCobro, 0),
  }
}

export interface FilaProducto {
  nombre: string
  unidades: number
  monto: Pesos
}

export interface MasVendidos {
  productos: FilaProducto[]
  /** Pagos en partes iguales: se facturan como "consumo" y no dicen qué producto cubren. */
  pagosSinDetalle: number
}

export function productosMasVendidos(ventas: readonly Pago[], limite = 5): MasVendidos {
  const filas = new Map<string, FilaProducto>()
  let pagosSinDetalle = 0
  for (const pago of ventas) {
    if (pago.items.some((item) => item.lineaId === null)) pagosSinDetalle += 1
    for (const item of pago.items) {
      if (item.lineaId === null) continue
      const fila = filas.get(item.nombre) ?? { nombre: item.nombre, unidades: 0, monto: 0 }
      fila.unidades += item.cantidad
      fila.monto += item.precio * item.cantidad
      filas.set(item.nombre, fila)
    }
  }
  const productos = [...filas.values()]
    .sort((a, b) => b.unidades - a.unidades || b.monto - a.monto || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, limite)
  return { productos, pagosSinDetalle }
}

export interface ResumenCarta {
  productos: number
  /** Los que el cliente no puede pedir ahora. */
  agotados: string[]
}

export function resumirCarta(productos: readonly Producto[]): ResumenCarta | null {
  if (productos.length === 0) return null
  return {
    productos: productos.length,
    agotados: productos
      .filter((producto) => !producto.disponible || producto.stock === 0)
      .map((producto) => producto.nombre)
      .sort((a, b) => a.localeCompare(b, 'es')),
  }
}

export interface PagosDuplicados {
  cantidad: number
  total: Pesos
}

/** Entró dos veces la misma plata: no es venta, y alguien tiene que devolverla. */
export function resumirDuplicados(pagos: readonly Pago[]): PagosDuplicados | null {
  const duplicados = pagos.filter((pago) => pago.incidencia === 'pago_duplicado')
  if (duplicados.length === 0) return null
  return { cantidad: duplicados.length, total: duplicados.reduce((suma, pago) => suma + pago.total, 0) }
}

export interface DatosDashboard {
  pagos: readonly Pago[]
  facturas: readonly Factura[]
  notas: readonly Nota[]
  cuentas: readonly Cuenta[]
  productos: readonly Producto[]
}

export function calcularDashboard(datos: DatosDashboard, periodo: Periodo, ahora: Date) {
  const hoy = diaColombia(ahora)
  const rango = rangoDePeriodo(periodo, ahora)
  const ventasPeriodo = ventasDentroDe(datos.pagos, rango)
  return {
    /** Sin un solo documento de operación: el restaurante aún no ha vendido nada. */
    sinDatos: datos.pagos.length === 0 && datos.cuentas.length === 0 && datos.notas.length === 0,
    rango,
    hoy: resumirVentas(ventasDentroDe(datos.pagos, { desde: hoy, hasta: hoy })),
    periodo: resumirVentas(ventasPeriodo),
    medios: pagosPorMedio(ventasPeriodo),
    facturas: resumirFacturas(datos.facturas, rango),
    notas: resumirNotas(datos.notas, rango),
    mesas: resumirMesasAbiertas(datos.cuentas),
    masVendidos: productosMasVendidos(ventasPeriodo),
    carta: resumirCarta(datos.productos),
    duplicados: resumirDuplicados(datos.pagos),
  }
}
