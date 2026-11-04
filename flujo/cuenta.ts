// Las reglas de la cuenta, sin base de datos. Lo que importa aquí es que el dinero cuadre:
// `cantidadCubierta` dice qué unidades ya tienen dueño, y cada pago o división las toma o las suelta.

import {
  calcularTotales,
  lineaSuma,
  puedePasar,
  repartirPartesIguales,
  TRANSICIONES_LINEA,
  unidadesPorCubrir,
} from '../contratos/reglas'
import type {
  DestinoPago,
  EstadoLinea,
  ItemNuevo,
  ItemPago,
  LineaPedido,
  OrigenLinea,
  Pesos,
  Producto,
} from '../contratos/tipos'
import { fallar } from './errores'
import type { CuentaDoc, DivisionDoc, PagoDoc, ResumenDoc } from './modelo'

const pagosDeDivision = (cuenta: CuentaDoc, division: DivisionDoc) =>
  cuenta.pagos.filter((pago) => pago.divisionId === division.id && pago.incidencia === null)

const pagoOcupa = (pago: ResumenDoc) => pago.estado === 'esperando_pago' || pago.estado === 'pagado'

/** El pago que tiene ocupada esa parte, con un cobro activo o ya pagada. */
export function ocupanteDeParte(cuenta: CuentaDoc, parte: number) {
  if (!cuenta.division) return null
  return pagosDeDivision(cuenta, cuenta.division).find((pago) => pago.parte === parte && pagoOcupa(pago)) ?? null
}

/**
 * Deja al día los totales y el estado. Con todas las partes pagadas, la división ya cumplió y se
 * retira, para que lo que se pida después se pueda pagar o dividir sin que nada quede bloqueado.
 */
export function recalcular(cuenta: CuentaDoc): CuentaDoc {
  if (cuenta.division) {
    const pagadas = pagosDeDivision(cuenta, cuenta.division).filter((pago) => pago.estado === 'pagado')
    if (pagadas.length >= cuenta.division.partes) cuenta.division = null
  }
  const totales = calcularTotales(cuenta.lineas, cuenta.pagos)
  Object.assign(cuenta, totales)
  if (cuenta.estado !== 'cerrada') {
    cuenta.estado = totales.consumo > 0 && totales.pagado >= totales.consumo ? 'pagada' : 'abierta'
  }
  return cuenta
}

export function ponerResumen(cuenta: CuentaDoc, pago: PagoDoc) {
  const resumen: ResumenDoc = {
    id: pago.id,
    numero: pago.numero,
    parte: pago.parte,
    subtotal: pago.subtotal,
    total: pago.total,
    medio: pago.medio,
    estado: pago.estado,
    estadoFactura: pago.estadoFactura,
    incidencia: pago.incidencia,
    creadoPor: pago.creadoPor,
    divisionId: pago.divisionId,
  }
  const indice = cuenta.pagos.findIndex((otro) => otro.id === pago.id)
  if (indice === -1) cuenta.pagos.push(resumen)
  else cuenta.pagos[indice] = resumen
}

export function moverCobertura(cuenta: CuentaDoc, items: readonly { lineaId: string | null; cantidad: number }[], signo: 1 | -1) {
  for (const { lineaId, cantidad } of items) {
    const linea = cuenta.lineas.find((otra) => otra.id === lineaId)
    if (linea) linea.cantidadCubierta = Math.max(linea.cantidadCubierta + signo * cantidad, 0)
  }
}

export const subtotalDe = (items: readonly ItemPago[]): Pesos =>
  items.reduce((suma, item) => suma + item.precio * item.cantidad, 0)

const itemDe = (linea: LineaPedido, cantidad: number): ItemPago => ({
  lineaId: linea.id,
  nombre: linea.nombre,
  cantidad,
  precio: linea.precio,
})

function cubrirSaldo(cuenta: CuentaDoc): ItemPago[] {
  const items = cuenta.lineas.filter((linea) => unidadesPorCubrir(linea) > 0).map((linea) => itemDe(linea, unidadesPorCubrir(linea)))
  if (items.length > 0) return items
  if (cuenta.enCobro > 0) return fallar('PAGO_EN_CURSO', 'Alguien ya está pagando lo que falta')
  if (cuenta.division) return fallar('CANTIDAD_NO_DISPONIBLE', 'La cuenta está dividida: paga una parte o quita la división')
  return fallar('NADA_POR_PAGAR', 'No hay nada por pagar')
}

function cubrirProductos(cuenta: CuentaDoc, pedidos: readonly { lineaId: string; cantidad: number }[]): ItemPago[] {
  const porLinea = new Map<string, number>()
  for (const { lineaId, cantidad } of pedidos) porLinea.set(lineaId, (porLinea.get(lineaId) ?? 0) + cantidad)

  const cobroConUnidades = cuenta.pagos.some((pago) => pago.estado === 'esperando_pago' && pago.parte === null)
  return [...porLinea].map(([lineaId, cantidad]) => {
    const linea = cuenta.lineas.find((otra) => otra.id === lineaId)
    if (!linea || !lineaSuma(linea.estado)) return fallar('CANTIDAD_NO_DISPONIBLE', 'Ese producto no está en lo confirmado')
    if (unidadesPorCubrir(linea) < cantidad) {
      if (cobroConUnidades) return fallar('PAGO_EN_CURSO', `Alguien ya está pagando ${linea.nombre}`)
      return fallar('CANTIDAD_NO_DISPONIBLE', `Ya no quedan tantas unidades de ${linea.nombre} por pagar`)
    }
    return itemDe(linea, cantidad)
  })
}

function cubrirParte(cuenta: CuentaDoc, parte: number): ItemPago[] {
  const { division } = cuenta
  if (!division || parte < 1 || parte > division.partes) {
    return fallar('PARTE_NO_DISPONIBLE', 'Esa parte no existe')
  }
  const ocupante = ocupanteDeParte(cuenta, parte)
  if (ocupante?.estado === 'esperando_pago') return fallar('PAGO_EN_CURSO', 'Alguien ya está pagando esa parte')
  if (ocupante) return fallar('PARTE_NO_DISPONIBLE', 'Esa parte ya está pagada')
  const monto = division.montos[parte - 1] as Pesos
  // Las unidades siguen congeladas, pero el total pagado nunca puede superar el consumo.
  if (monto > cuenta.porPagar) return fallar('PARTE_NO_DISPONIBLE', 'Lo que cubría esa parte ya no está libre')
  return [{ lineaId: null, nombre: `Consumo, parte ${parte} de ${division.partes}`, cantidad: 1, precio: monto }]
}

/** Qué cubre un pago nuevo, o por qué no se puede. La cuenta debe estar recalculada y sin cobros vencidos. */
export function cubrirDestino(cuenta: CuentaDoc, destino: DestinoPago): { items: ItemPago[]; parte: number | null; division: DivisionDoc | null } {
  if (destino.tipo === 'saldo') return { items: cubrirSaldo(cuenta), parte: null, division: null }
  if (destino.tipo === 'productos') return { items: cubrirProductos(cuenta, destino.items), parte: null, division: null }
  return { items: cubrirParte(cuenta, destino.parte), parte: destino.parte, division: cuenta.division }
}

/**
 * Llegó `paid` de un pago vencido, cancelado o fallido: la plata entró y no hay reversos. Solo vale si
 * lo que cubría sigue libre, y en ese caso lo vuelve a tomar. El total pagado nunca supera el consumo.
 */
export function aceptarPagoTardio(cuenta: CuentaDoc, pago: PagoDoc) {
  if (cuenta.estado === 'cerrada') return false
  if (pago.subtotal > calcularTotales(cuenta.lineas, cuenta.pagos).porPagar) return false
  if (pago.parte !== null) {
    return cuenta.division !== null && cuenta.division.id === pago.divisionId && ocupanteDeParte(cuenta, pago.parte) === null
  }
  const libres = pago.items.every(({ lineaId, cantidad }) => {
    const linea = cuenta.lineas.find((otra) => otra.id === lineaId)
    return linea !== undefined && unidadesPorCubrir(linea) >= cantidad
  })
  if (libres) moverCobertura(cuenta, pago.items, 1)
  return libres
}

/** Mientras ninguna parte tenga un cobro activo o un pago hecho. */
function exigirDivisionLibre(cuenta: CuentaDoc) {
  if (cuenta.division && pagosDeDivision(cuenta, cuenta.division).some(pagoOcupa)) {
    fallar('DIVISION_ACTIVA', 'Ya hay una parte pagada o con un cobro activo')
  }
}

export function quitarDivision(cuenta: CuentaDoc) {
  exigirDivisionLibre(cuenta)
  if (cuenta.division) moverCobertura(cuenta, cuenta.division.cubre, -1)
  cuenta.division = null
  return recalcular(cuenta)
}

/** Reparte lo que nadie cubre, y lo congela hasta que se paguen las partes. */
export function dividir(cuenta: CuentaDoc, partes: number, id: string) {
  exigirDivisionLibre(cuenta)
  if (cuenta.enCobro > 0) fallar('PAGO_EN_CURSO', 'Espera a que termine el cobro que está en curso')
  if (cuenta.division) moverCobertura(cuenta, cuenta.division.cubre, -1)
  cuenta.division = null

  const cubre = cuenta.lineas
    .filter((linea) => unidadesPorCubrir(linea) > 0)
    .map((linea) => ({ lineaId: linea.id, cantidad: unidadesPorCubrir(linea), precio: linea.precio }))
  const total = cubre.reduce((suma, { cantidad, precio }) => suma + precio * cantidad, 0)
  if (total === 0) fallar('NADA_POR_PAGAR', 'No hay nada por dividir')

  const montos = repartirPartesIguales(total, partes)
  // Factus Pay tiene mínimo, pero una parte pequeña aún se paga en efectivo. Lo que no existe es una parte de $0.
  if (montos.some((monto) => monto < 1)) fallar('MONTO_FUERA_DE_RANGO', 'La cuenta no alcanza para tantas partes')

  moverCobertura(cuenta, cubre, 1)
  cuenta.division = { id, partes, montos, cubre: cubre.map(({ lineaId, cantidad }) => ({ lineaId, cantidad })) }
  return recalcular(cuenta)
}

export function buscarLineas(cuenta: CuentaDoc, ids: readonly string[]) {
  return ids.map((id) => cuenta.lineas.find((linea) => linea.id === id) ?? fallar('NO_ENCONTRADO', 'Esa línea no existe'))
}

export function cambiarEstadoLinea(linea: LineaPedido, estado: EstadoLinea) {
  if (!puedePasar(TRANSICIONES_LINEA, linea.estado, estado)) {
    fallar('TRANSICION_INVALIDA', `${linea.nombre} no puede pasar de ${linea.estado} a ${estado}`)
  }
  linea.estado = estado
}

export function descontarStock(producto: Producto, cantidad: number) {
  if (producto.stock === null) return
  if (producto.stock < cantidad) fallar('STOCK_INSUFICIENTE', `Quedan ${producto.stock} de ${producto.nombre}`)
  producto.stock -= cantidad
  if (producto.stock === 0) producto.disponible = false
}

/** Si estaba agotado porque llegó a 0, vuelve a estar disponible. Un "agotado" manual no se toca. */
export function devolverStock(producto: Producto, cantidad: number) {
  if (producto.stock === null) return
  if (producto.stock === 0) producto.disponible = true
  producto.stock += cantidad
}

interface LineasNuevas {
  items: readonly ItemNuevo[]
  productos: ReadonlyMap<string, Producto | null>
  origen: OrigenLinea
  ahora: string
  nuevoId: () => string
}

/** Lo que pide el cliente espera al mesero y aún no baja el stock. Lo que pide el personal va directo a cocina. */
export function agregarLineas(cuenta: CuentaDoc, { items, productos, origen, ahora, nuevoId }: LineasNuevas) {
  const ronda = cuenta.lineas.reduce((mayor, linea) => Math.max(mayor, linea.ronda), 0) + 1
  const pedidas = new Map<string, number>()
  for (const { productoId, cantidad } of items) pedidas.set(productoId, (pedidas.get(productoId) ?? 0) + cantidad)

  for (const [productoId, cantidad] of pedidas) {
    const producto = productos.get(productoId)
    if (!producto || !producto.disponible) fallar('PRODUCTO_NO_DISPONIBLE', 'Ese producto no está disponible')
    if (producto.stock !== null && producto.stock < cantidad) {
      fallar('STOCK_INSUFICIENTE', `Quedan ${producto.stock} de ${producto.nombre}`)
    }
    if (origen === 'personal') descontarStock(producto, cantidad)
  }

  for (const { productoId, cantidad, nota } of items) {
    const producto = productos.get(productoId) as Producto
    cuenta.lineas.push({
      id: nuevoId(),
      productoId,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad,
      nota,
      ronda,
      estado: origen === 'personal' ? 'confirmada' : 'pendiente',
      origen,
      motivo: null,
      cantidadCubierta: 0,
      creadaEn: ahora,
    })
  }
  return recalcular(cuenta)
}
