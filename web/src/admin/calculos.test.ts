import { beforeEach, describe, expect, test } from 'vitest'
import type { Cuenta, Factura, Nota, Pago, Producto } from '../../../contratos/tipos'
import type { AlCambiar, AlFallar, Cancelar } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { CLAVE_DEMO } from '../datos/semilla'
import {
  calcularDashboard,
  diaColombia,
  esVenta,
  pagosPorMedio,
  productosMasVendidos,
  rangoDePeriodo,
  resumirDuplicados,
  resumirFacturas,
  resumirMesasAbiertas,
  resumirNotas,
  resumirVentas,
} from './calculos'

const RESTAURANTE = 'fogon-del-manglar'
const CONSUMIDOR = { tipo: 'consumidor_final', correo: null } as const

const leer = <T,>(escuchar: (alCambiar: AlCambiar<T>, alFallar: AlFallar) => Cancelar) =>
  new Promise<T>((resolver, rechazar) => {
    const cancelar = escuchar(
      (valor) => {
        queueMicrotask(cancelar)
        resolver(valor)
      },
      (error) => {
        queueMicrotask(cancelar)
        rechazar(error)
      },
    )
  })

function escenario() {
  let reloj = new Date('2026-11-04T17:00:00Z')
  const tareas: (() => void)[] = []
  const fuente = crearFuenteMemoria({
    ahora: () => reloj,
    programar: (tarea) => tareas.push(tarea),
    dibujarQr: async (texto) => `qr:${texto}`,
  })
  return {
    fuente,
    ahora: () => reloj,
    irA: (fecha: string) => {
      reloj = new Date(fecha)
    },
    responderDian: () => {
      while (tareas.length) tareas.shift()?.()
    },
    responderUna: () => tareas.shift()?.(),
    leerTodo: async () => ({
      pagos: await leer<Pago[]>((a, f) => fuente.escucharPagos(RESTAURANTE, a, f)),
      facturas: await leer<Factura[]>((a, f) => fuente.escucharFacturas(RESTAURANTE, a, f)),
      notas: await leer<Nota[]>((a, f) => fuente.escucharNotas(RESTAURANTE, a, f)),
      cuentas: await leer<Cuenta[]>((a, f) => fuente.escucharCuentasAbiertas(RESTAURANTE, a, f)),
      productos: await leer<Producto[]>((a, f) => fuente.escucharProductos(RESTAURANTE, a, f)),
    }),
  }
}

/** El personal pide en la mesa y cobra en efectivo. El pago queda pagado sin pasar por el banco. */
async function venderEnEfectivo(
  mundo: ReturnType<typeof escenario>,
  mesa: string,
  items: { productoId: string; cantidad: number }[],
  propinaPorcentaje = 0,
  medio: Pago['medio'] = 'efectivo',
) {
  await mundo.fuente.agregarLineas(mesa, { items: items.map((item) => ({ ...item, nota: null })) })
  return mundo.fuente.crearPago(mesa, { destino: { tipo: 'saldo' }, propinaPorcentaje, comprador: CONSUMIDOR, medio })
}

describe('con la fuente en memoria', () => {
  let mundo: ReturnType<typeof escenario>

  beforeEach(async () => {
    mundo = escenario()
    await mundo.fuente.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
  })

  test('un restaurante sin movimiento no da ceros: da vacío', async () => {
    const tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.sinDatos).toBe(true)
    expect(tablero.hoy).toBeNull()
    expect(tablero.periodo).toBeNull()
    expect(tablero.medios).toEqual([])
    expect(tablero.facturas).toBeNull()
    expect(tablero.notas).toBeNull()
    expect(tablero.masVendidos.productos).toEqual([])
  })

  test('ventas, propina, impuesto y ticket salen de los pagos reales', async () => {
    // 2 mojarras a 32.400 = 64.800 con INC del 8 %: base 60.000, impuesto 4.800, propina del 10 % = 6.000.
    await venderEnEfectivo(mundo, 'demo-mesa-1', [{ productoId: 'mojarra-frita', cantidad: 2 }], 10)
    // 1 agua = 4.050: base 3.750, impuesto 300.
    await venderEnEfectivo(mundo, 'demo-mesa-2', [{ productoId: 'agua', cantidad: 1 }], 0, 'tarjeta_debito')

    const tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.sinDatos).toBe(false)
    expect(tablero.hoy).toEqual({
      ventas: 68_850,
      cobrado: 74_850,
      pagos: 2,
      ticketPromedio: 34_425,
      propinas: 6_000,
      impuestos: 5_100,
    })
    expect(tablero.medios.map((f) => [f.medio, f.pagos, f.monto])).toEqual([
      ['efectivo', 1, 70_800],
      ['tarjeta_debito', 1, 4_050],
    ])
    expect(tablero.medios[0]!.fraccion + tablero.medios[1]!.fraccion).toBeCloseTo(1)
    expect(tablero.masVendidos.productos[0]).toEqual({ nombre: 'Mojarra frita', unidades: 2, monto: 64_800 })
    // Eran las dos únicas mojarras: el stock llegó a 0 y la carta lo dice.
    expect(tablero.carta?.agotados).toEqual(['Mojarra frita'])
  })

  test('un cobro que no ha entrado no es venta, pero la mesa sigue abierta', async () => {
    await mundo.fuente.agregarLineas('demo-mesa-1', { items: [{ productoId: 'posta-negra', cantidad: 1, nota: null }] })
    await mundo.fuente.crearPago('demo-mesa-1', { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'factus_pay' })

    const tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.periodo).toBeNull()
    expect(tablero.facturas).toBeNull()
    expect(tablero.mesas).toEqual({ mesas: 1, porPagar: 0, enCobro: 37_800 })
    expect(tablero.sinDatos).toBe(false)
  })

  test('el dashboard sigue el estado de la factura: en proceso, rechazada, en validación y emitida', async () => {
    const facturas = async () => calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora()).facturas

    await venderEnEfectivo(mundo, 'demo-mesa-1', [{ productoId: 'agua', cantidad: 1 }])
    expect(await facturas()).toEqual({ emitidas: 0, enProceso: 1, enValidacion: 0, rechazadas: 0 })

    mundo.fuente.simulador.elegirRespuestaDian('rechazada')
    mundo.responderUna()
    expect(await facturas()).toEqual({ emitidas: 0, enProceso: 0, enValidacion: 0, rechazadas: 1 })

    await venderEnEfectivo(mundo, 'demo-mesa-2', [{ productoId: 'agua', cantidad: 1 }])
    mundo.fuente.simulador.elegirRespuestaDian('en_validacion')
    mundo.responderUna()
    expect(await facturas()).toEqual({ emitidas: 0, enProceso: 0, enValidacion: 1, rechazadas: 1 })

    // La DIAN responde en el reintento: la rechazada sigue esperando a que alguien la corrija.
    mundo.responderUna()
    expect(await facturas()).toEqual({ emitidas: 1, enProceso: 0, enValidacion: 0, rechazadas: 1 })
  })

  test('una nota crédito deja la devolución pendiente hasta que se registra', async () => {
    const pago = await venderEnEfectivo(mundo, 'demo-mesa-1', [{ productoId: 'posta-negra', cantidad: 1 }])
    mundo.responderDian()
    const nota = await mundo.fuente.crearNota(pago.id, { tipo: 'credito', concepto: 'anulacion', motivo: 'Error en el pedido' })
    let tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.notas?.creditos).toEqual({ cantidad: 0, total: 0 })
    expect(tablero.notas?.devolucionesPendientes).toEqual({ cantidad: 1, total: 37_800 })

    mundo.responderDian()
    await mundo.fuente.marcarDevolucionHecha(nota.id)
    tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.notas?.creditos).toEqual({ cantidad: 1, total: 37_800 })
    expect(tablero.notas?.devolucionesPendientes).toEqual({ cantidad: 0, total: 0 })
    // La venta no se toca: la nota no cambia la cuenta de la mesa.
    expect(tablero.hoy?.ventas).toBe(37_800)
  })

  test('lo vendido ayer sale del día pero queda en el periodo', async () => {
    await venderEnEfectivo(mundo, 'demo-mesa-1', [{ productoId: 'agua', cantidad: 1 }])
    mundo.irA('2026-11-05T17:00:00Z')
    const tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.hoy).toBeNull()
    expect(tablero.periodo?.ventas).toBe(4_050)
  })

  test('el pago en partes iguales no se cuenta como un producto', async () => {
    await mundo.fuente.agregarLineas('demo-mesa-1', { items: [{ productoId: 'posta-negra', cantidad: 2, nota: null }] })
    await mundo.fuente.dividirEnPartesIguales('demo-mesa-1', { partes: 2 })
    await mundo.fuente.crearPago('demo-mesa-1', { destino: { tipo: 'parte_igual', parte: 1 }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' })
    const tablero = calcularDashboard(await mundo.leerTodo(), 'siete', mundo.ahora())
    expect(tablero.periodo?.ventas).toBe(37_800)
    expect(tablero.masVendidos).toEqual({ productos: [], pagosSinDetalle: 1 })
  })
})

const pago = (p: Partial<Pago>): Pago => ({
  id: 'p',
  numero: 1,
  parte: null,
  subtotal: 10_800,
  total: 10_800,
  medio: 'efectivo',
  estado: 'pagado',
  estadoFactura: 'emitida',
  incidencia: null,
  creadoPor: 'u',
  restauranteId: RESTAURANTE,
  cuentaId: 'c',
  mesaToken: 'm',
  destino: { tipo: 'saldo' },
  items: [],
  impuesto: { tipo: 'INC', porcentaje: 8 },
  baseSinImpuesto: 10_000,
  propinaPorcentaje: 0,
  propina: 0,
  cobro: null,
  creadoEn: '2026-11-04T17:00:00Z',
  pagadoEn: '2026-11-04T17:00:00Z',
  ...p,
})

test('el día es el de Colombia: a las 8 p. m. del 3 ya es 4 en UTC', () => {
  expect(diaColombia('2026-11-04T01:00:00Z')).toBe('2026-11-03')
  expect(diaColombia('2026-11-04T05:00:00Z')).toBe('2026-11-04')
})

test('los periodos terminan hoy y cuentan los días de Colombia', () => {
  const ahora = new Date('2026-11-04T17:00:00Z')
  expect(rangoDePeriodo('siete', ahora)).toEqual({ desde: '2026-10-29', hasta: '2026-11-04' })
  expect(rangoDePeriodo('treinta', ahora)).toEqual({ desde: '2026-10-06', hasta: '2026-11-04' })
  expect(rangoDePeriodo('mes', ahora)).toEqual({ desde: '2026-11-01', hasta: '2026-11-04' })
  // La noche del 31 de octubre en Colombia todavía es octubre, aunque en UTC ya sea noviembre.
  expect(rangoDePeriodo('mes', new Date('2026-11-01T02:00:00Z'))).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
})

test('un pago duplicado no es venta, pero se avisa para devolverlo', () => {
  const duplicado = pago({ incidencia: 'pago_duplicado', total: 20_000 })
  expect(esVenta(duplicado)).toBe(false)
  expect(esVenta(pago({ estado: 'vencido' }))).toBe(false)
  expect(resumirDuplicados([duplicado, pago({})])).toEqual({ cantidad: 1, total: 20_000 })
  expect(resumirDuplicados([pago({})])).toBeNull()
})

test('sin pagos no hay ticket: nunca se divide entre cero', () => {
  expect(resumirVentas([])).toBeNull()
  expect(pagosPorMedio([])).toEqual([])
})

test('el ticket y el impuesto se redondean a pesos enteros', () => {
  const resumen = resumirVentas([
    pago({ subtotal: 100, baseSinImpuesto: 92.59, total: 100 }),
    pago({ subtotal: 101, baseSinImpuesto: 93.52, total: 101 }),
    pago({ subtotal: 101, baseSinImpuesto: 93.52, total: 101 }),
  ])
  expect(resumen?.ticketPromedio).toBe(101)
  expect(resumen?.impuestos).toBe(22)
})

test('los más vendidos van por unidades y respetan el límite', () => {
  const item = (nombre: string, cantidad: number, precio = 1_000) => ({ lineaId: nombre, nombre, cantidad, precio })
  const { productos } = productosMasVendidos(
    [pago({ items: [item('Agua', 3), item('Cocada', 1, 9_000)] }), pago({ items: [item('Agua', 1), item('Enyucado', 1), item('Limonada', 2)] })],
    3,
  )
  expect(productos.map((p) => [p.nombre, p.unidades])).toEqual([
    ['Agua', 4],
    ['Limonada', 2],
    ['Cocada', 1],
  ])
})

test('las facturas sin emitir no cuentan; las rechazadas viejas siguen por resolver', () => {
  const factura = (f: Partial<Factura>) => f as Factura
  const rango = { desde: '2026-11-04', hasta: '2026-11-04' }
  expect(resumirFacturas([factura({ estado: 'sin_emitir' })], rango)).toBeNull()
  expect(
    resumirFacturas(
      [
        factura({ estado: 'emitida', emitidaEn: '2026-11-04T17:00:00Z' }),
        factura({ estado: 'emitida', emitidaEn: '2026-10-01T17:00:00Z' }),
        factura({ estado: 'rechazada', emitidaEn: null }),
      ],
      rango,
    ),
  ).toEqual({ emitidas: 1, enProceso: 0, enValidacion: 0, rechazadas: 1 })
})

test('una nota rechazada no obliga a devolver plata', () => {
  const nota = (n: Partial<Nota>) => ({ tipo: 'credito', total: 5_000, devolucion: 'pendiente', emitidaEn: null, ...n }) as Nota
  const resumen = resumirNotas([nota({ estado: 'rechazada' }), nota({ estado: 'en_validacion' })], { desde: '2026-11-01', hasta: '2026-11-04' })
  expect(resumen?.devolucionesPendientes).toEqual({ cantidad: 1, total: 5_000 })
  expect(resumen?.rechazadas).toBe(1)
})

test('una mesa con dos cuentas vivas cuenta una vez; las cerradas no cuentan', () => {
  const cuenta = (c: Partial<Cuenta>) => ({ estado: 'abierta', mesaToken: 'a', porPagar: 0, enCobro: 0, ...c }) as Cuenta
  expect(resumirMesasAbiertas([cuenta({ porPagar: 100 }), cuenta({ enCobro: 50, estado: 'pagada' }), cuenta({ mesaToken: 'b', estado: 'cerrada', porPagar: 999 })])).toEqual({
    mesas: 1,
    porPagar: 100,
    enCobro: 50,
  })
})
