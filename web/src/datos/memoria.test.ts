import { beforeEach, describe, expect, test } from 'vitest'
import { calcularPropina, COBRO_EXPIRACION_SEGUNDOS } from '../../../contratos/reglas'
import type { Comprador, Cuenta, Factura, SolicitudPago } from '../../../contratos/tipos'
import { comoErrorDatos, ErrorDatos } from './fuente'
import { compradorValido, crearFuenteMemoria, pdfDePrueba, type Almacen, type EstadoMemoria } from './memoria'
import { CLAVE_DEMO } from './semilla'

const MESA = 'demo-mesa-3'
const RESTAURANTE = 'fogon-del-manglar'
const INC = { tipo: 'INC', porcentaje: 8 } as const
const CONSUMIDOR: Comprador = { tipo: 'consumidor_final', correo: null }

/** Varias "pestañas" que comparten el mismo estado, como varios celulares sobre Firestore. */
function almacenCompartidoDePrueba() {
  let guardado: EstadoMemoria | null = null
  const avisos = new Set<() => void>()
  return (): Almacen => {
    let propio: (() => void) | null = null
    return {
      leer: () => (guardado ? structuredClone(guardado) : null),
      guardar(estado) {
        guardado = structuredClone(estado)
        for (const aviso of avisos) if (aviso !== propio) aviso()
      },
      borrar() {
        guardado = null
      },
      alCambiarFuera(aviso) {
        propio = aviso
        avisos.add(aviso)
        return () => avisos.delete(aviso)
      },
    }
  }
}

function escenario() {
  let reloj = new Date('2026-11-04T17:00:00Z')
  const tareas: (() => void)[] = []
  const almacen = almacenCompartidoDePrueba()
  const telefono = () =>
    crearFuenteMemoria({
      almacen: almacen(),
      ahora: () => reloj,
      programar: (tarea) => tareas.push(tarea),
      dibujarQr: async (texto) => `qr:${texto}`,
    })
  return {
    telefono,
    avanzar(segundos: number) {
      reloj = new Date(reloj.getTime() + segundos * 1000)
    },
    /** La DIAN responde todo lo que tenía pendiente. */
    responderDian() {
      while (tareas.length) tareas.shift()?.()
    },
  }
}

const esperarError = async (promesa: Promise<unknown>) => {
  try {
    await promesa
  } catch (error) {
    return comoErrorDatos(error).codigo
  }
  throw new Error('Se esperaba un error')
}

const pagoCliente = (destino: SolicitudPago['destino'], propinaPorcentaje = 0): SolicitudPago => ({
  destino,
  propinaPorcentaje,
  comprador: CONSUMIDOR,
  medio: 'factus_pay',
})

const siguiente = <T,>(escuchar: (alCambiar: (valor: T) => void, alFallar: (error: ErrorDatos) => void) => () => void) =>
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

let mundo: ReturnType<typeof escenario>
let cliente: ReturnType<ReturnType<typeof escenario>['telefono']>
let otroCliente: typeof cliente
let mesero: typeof cliente
let cocina: typeof cliente
let admin: typeof cliente

beforeEach(async () => {
  mundo = escenario()
  cliente = mundo.telefono()
  otroCliente = mundo.telefono()
  mesero = mundo.telefono()
  cocina = mundo.telefono()
  admin = mundo.telefono()
  await cliente.entrarComoCliente()
  await otroCliente.entrarComoCliente()
  await mesero.entrarPersonal('mesero@ribu.demo', CLAVE_DEMO)
  await cocina.entrarPersonal('cocina@ribu.demo', CLAVE_DEMO)
  await admin.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
})

/** El pedido de la demo: 2 mojarras, 2 jugos y 1 patacón, ya confirmado. Consumo 91.800. */
async function pedidoDemoConfirmado(): Promise<Cuenta> {
  const cuenta = await cliente.agregarLineas(MESA, {
    items: [
      { productoId: 'mojarra-frita', cantidad: 2, nota: 'Bien dorada' },
      { productoId: 'jugo-corozo', cantidad: 2, nota: null },
      { productoId: 'patacon-suero', cantidad: 1, nota: '  ' },
    ],
  })
  return mesero.confirmarLineas(MESA, { lineaIds: cuenta.lineas.map((l) => l.id) })
}

describe('pedido', () => {
  test('lo que pide el cliente espera al mesero y no suma a la cuenta', async () => {
    const cuenta = await cliente.agregarLineas(MESA, { items: [{ productoId: 'agua', cantidad: 2, nota: ' sin hielo ' }] })
    expect(cuenta.lineas).toMatchObject([{ estado: 'pendiente', origen: 'cliente', ronda: 1, nota: 'sin hielo', precio: 4_050 }])
    expect(cuenta).toMatchObject({ consumo: 0, porPagar: 0, estado: 'abierta' })
    const mesa = await siguiente((a, b) => cliente.escucharMesa(MESA, a, b))
    expect(mesa).toMatchObject({ estado: 'ocupada', cuentaId: cuenta.id })
  })

  test('al confirmar baja el stock y la mojarra queda agotada en 0', async () => {
    const cuenta = await pedidoDemoConfirmado()
    expect(cuenta).toMatchObject({ consumo: 91_800, porPagar: 91_800 })
    const productos = admin.estado().productos
    expect(productos['mojarra-frita']).toMatchObject({ stock: 0, disponible: false })
    expect(productos['jugo-corozo']?.stock).toBe(38)
    expect(await esperarError(cliente.agregarLineas(MESA, { items: [{ productoId: 'mojarra-frita', cantidad: 1, nota: null }] }))).toBe(
      'PRODUCTO_NO_DISPONIBLE',
    )
  })

  test('no se pide más de lo que queda', async () => {
    const pedido = cliente.agregarLineas(MESA, { items: [{ productoId: 'mojarra-frita', cantidad: 3, nota: null }] })
    expect(await esperarError(pedido)).toBe('STOCK_INSUFICIENTE')
  })

  test('lo que pide el personal va directo a cocina, en otra ronda', async () => {
    await cliente.agregarLineas(MESA, { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    const cuenta = await mesero.agregarLineas(MESA, { items: [{ productoId: 'cocada', cantidad: 1, nota: null }] })
    expect(cuenta.lineas[1]).toMatchObject({ estado: 'confirmada', origen: 'personal', ronda: 2 })
    expect(cuenta.consumo).toBe(6_750)
  })

  test('el mesero rechaza con motivo y la cocina avanza solo por transiciones válidas', async () => {
    const cuenta = await cliente.agregarLineas(MESA, {
      items: [
        { productoId: 'agua', cantidad: 1, nota: null },
        { productoId: 'cocada', cantidad: 1, nota: null },
      ],
    })
    const [agua, cocada] = cuenta.lineas
    await mesero.rechazarLineas(MESA, { lineaIds: [agua!.id], motivo: 'Se acabó el agua fría' })
    await mesero.confirmarLineas(MESA, { lineaIds: [cocada!.id] })
    expect(await esperarError(cocina.avanzarLinea(MESA, cocada!.id, { estado: 'entregada' }))).toBe('TRANSICION_INVALIDA')
    await cocina.avanzarLinea(MESA, cocada!.id, { estado: 'en_preparacion' })
    const lista = await cocina.avanzarLinea(MESA, cocada!.id, { estado: 'lista' })
    expect(lista.lineas.map((l) => [l.estado, l.motivo])).toEqual([
      ['rechazada', 'Se acabó el agua fría'],
      ['lista', null],
    ])
    expect(await esperarError(cliente.confirmarLineas(MESA, { lineaIds: [cocada!.id] }))).toBe('SIN_PERMISO')
  })

  test('anular devuelve el stock, pero no si la línea ya está en un pago', async () => {
    const cuenta = await pedidoDemoConfirmado()
    const [mojarra, jugo] = cuenta.lineas
    await cliente.crearPago(MESA, pagoCliente({ tipo: 'productos', items: [{ lineaId: jugo!.id, cantidad: 2 }] }))
    expect(await esperarError(mesero.anularLineas(MESA, { lineaIds: [jugo!.id], motivo: 'error' }))).toBe('LINEA_CON_PAGO')
    await mesero.anularLineas(MESA, { lineaIds: [mojarra!.id], motivo: 'Se demoró mucho' })
    expect(admin.estado().productos['mojarra-frita']).toMatchObject({ stock: 2, disponible: true })
  })
})

describe('mesa', () => {
  test('el siguiente cliente no ve nada del anterior', async () => {
    await mesero.agregarLineas(MESA, { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(await esperarError(mesero.liberarMesa(MESA))).toBe('MESA_CON_SALDO')
    const pago = await mesero.crearPago(MESA, { ...pagoCliente({ tipo: 'saldo' }), medio: 'efectivo' })
    expect(pago.estado).toBe('pagado')
    const mesa = await mesero.liberarMesa(MESA)
    expect(mesa).toMatchObject({ estado: 'libre', cuentaId: null })
    const nueva = await otroCliente.agregarLineas(MESA, { items: [{ productoId: 'cocada', cantidad: 1, nota: null }] })
    expect(nueva.lineas).toHaveLength(1)
    expect(nueva.pagos).toEqual([])
  })

  test('no se libera con pedidos por confirmar', async () => {
    await cliente.agregarLineas(MESA, { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(await esperarError(mesero.liberarMesa(MESA))).toBe('MESA_CON_SALDO')
    expect(await esperarError(cliente.liberarMesa(MESA))).toBe('SIN_PERMISO')
  })
})

describe('pago con Factus Pay', () => {
  test('la propina sale de calcularPropina y el cobro tiene el monto exacto', async () => {
    await pedidoDemoConfirmado()
    const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }, 10))
    expect(pago).toMatchObject({ subtotal: 91_800, propina: 8_500, total: 100_300, estado: 'esperando_pago', baseSinImpuesto: 85_000 })
    expect(pago.propina).toBe(calcularPropina(91_800, INC, 10))
    expect(pago.cobro).toMatchObject({ monto: 100_300, referencia: pago.id, estado: 'started' })
    const conQr = await siguiente<typeof pago | null>((a, b) => cliente.escucharPago(RESTAURANTE, pago.id, a, b))
    expect(conQr?.cobro?.qrBase64).toBe(`qr:${pago.cobro?.llaveBreB}`)

    const cuenta = await siguiente<Cuenta | null>((a, b) => otroCliente.escucharCuenta(RESTAURANTE, pago.cuentaId, a, b))
    expect(cuenta).toMatchObject({ enCobro: 91_800, porPagar: 0 })
    expect(await esperarError(otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' })))).toBe('PAGO_EN_CURSO')
  })

  test('al pagar se emite la factura y solo quien pagó la ve', async () => {
    await pedidoDemoConfirmado()
    const pago = await cliente.crearPago(MESA, {
      ...pagoCliente({ tipo: 'saldo' }),
      comprador: { tipo: 'consumidor_final', correo: 'ana@ejemplo.com' },
    })
    cliente.simulador?.pagarCobro(pago.id)
    let factura = await siguiente<Factura | null>((a, b) => cliente.escucharFactura(RESTAURANTE, pago.id, a, b))
    expect(factura?.estado).toBe('en_proceso')
    mundo.responderDian()
    factura = await siguiente<Factura | null>((a, b) => cliente.escucharFactura(RESTAURANTE, pago.id, a, b))
    expect(factura).toMatchObject({ estado: 'emitida', correo: { estado: 'enviado', destino: 'ana@ejemplo.com' } })
    expect(factura?.datos?.cufe).toHaveLength(96)

    const ajena = siguiente<Factura | null>((a, b) => otroCliente.escucharFactura(RESTAURANTE, pago.id, a, b))
    await expect(ajena).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    expect(await esperarError(otroCliente.descargarFacturaPdf(MESA, pago.id))).toBe('SIN_PERMISO')
    const pdf = await cliente.descargarFacturaPdf(MESA, pago.id)
    expect(pdf.type).toBe('application/pdf')

    const cuenta = await siguiente<Cuenta | null>((a, b) => otroCliente.escucharCuenta(RESTAURANTE, pago.cuentaId, a, b))
    expect(cuenta).toMatchObject({ estado: 'pagada', pagado: 91_800, porPagar: 0 })
    expect(cuenta?.pagos[0]).toMatchObject({ estado: 'pagado', estadoFactura: 'emitida' })
  })

  test('si la DIAN se demora la factura queda en validación y se reintenta sola', async () => {
    await pedidoDemoConfirmado()
    cliente.simulador?.elegirRespuestaDian('en_validacion')
    const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    cliente.simulador?.pagarCobro(pago.id)
    mundo.responderDian()
    const factura = cliente.estado().facturas[pago.id]
    expect(factura).toMatchObject({ estado: 'emitida', intentos: 2 })
  })

  test('una factura rechazada espera al personal, que la reintenta con datos corregidos', async () => {
    await pedidoDemoConfirmado()
    cliente.simulador?.elegirRespuestaDian('rechazada')
    const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    cliente.simulador?.pagarCobro(pago.id)
    mundo.responderDian()
    expect(cliente.estado().facturas[pago.id]?.estado).toBe('rechazada')
    expect(await esperarError(cliente.reintentarFactura(MESA, pago.id, { comprador: null }))).toBe('SIN_PERMISO')
    const corregida: Comprador = { tipo: 'empresa', nit: '900123456', razonSocial: 'Empresa Inventada SAS', correo: 'pagos@ejemplo.com' }
    await mesero.reintentarFactura(MESA, pago.id, { comprador: corregida })
    mundo.responderDian()
    expect(cliente.estado().facturas[pago.id]).toMatchObject({ estado: 'emitida', comprador: corregida })
  })

  test('verificarPago vence el QR y libera lo que cubría', async () => {
    await pedidoDemoConfirmado()
    const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect((await cliente.verificarPago(MESA, pago.id)).estado).toBe('esperando_pago')
    mundo.avanzar(COBRO_EXPIRACION_SEGUNDOS)
    expect((await cliente.verificarPago(MESA, pago.id)).estado).toBe('vencido')
    const cuenta = cliente.estado().cuentas[pago.cuentaId]
    expect(cuenta).toMatchObject({ enCobro: 0, porPagar: 91_800 })
    expect(cuenta?.lineas.every((l) => l.cantidadCubierta === 0)).toBe(true)
  })

  test('si llega la plata de un QR cancelado y otro ya pagó lo mismo, queda como duplicado', async () => {
    await pedidoDemoConfirmado()
    const primero = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect(await esperarError(otroCliente.cancelarPago(MESA, primero.id))).toBe('SIN_PERMISO')
    await cliente.cancelarPago(MESA, primero.id)
    const segundo = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    otroCliente.simulador?.pagarCobro(segundo.id)
    cliente.simulador?.pagarCobro(primero.id)
    const estado = cliente.estado()
    expect(estado.pagos[primero.id]).toMatchObject({ estado: 'pagado', incidencia: 'pago_duplicado', estadoFactura: 'sin_emitir' })
    expect(estado.cuentas[primero.cuentaId]).toMatchObject({ pagado: 91_800, porPagar: 0 })
  })

  test('valida propina, comprador, monto y que solo el personal registre efectivo', async () => {
    await pedidoDemoConfirmado()
    expect(await esperarError(cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }, 7.5)))).toBe('PROPINA_INVALIDA')
    const persona: Comprador = { tipo: 'persona', tipoDocumento: 'CC', documento: '', nombre: 'Ana', correo: 'ana@ejemplo.com' }
    expect(await esperarError(cliente.crearPago(MESA, { ...pagoCliente({ tipo: 'saldo' }), comprador: persona }))).toBe(
      'COMPRADOR_INVALIDO',
    )
    expect(await esperarError(cliente.crearPago(MESA, { ...pagoCliente({ tipo: 'saldo' }), medio: 'efectivo' }))).toBe('SIN_PERMISO')
  })

  test('el mínimo de Factus Pay aplica al total y a cada parte', async () => {
    await mesero.agregarLineas(MESA, { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(await esperarError(cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' })))).toBe('MONTO_FUERA_DE_RANGO')
    const cuenta = await mesero.agregarLineas(MESA, { items: [{ productoId: 'posta-negra', cantidad: 1, nota: null }] })
    expect(cuenta.consumo).toBe(41_850)
    await mesero.dividirEnPartesIguales(MESA, { partes: 4 })
    expect(await esperarError(mesero.dividirEnPartesIguales(MESA, { partes: 5 }))).toBe('MONTO_FUERA_DE_RANGO')
  })

  test('crear un pago vence antes los cobros cuyo QR ya pasó, aunque nadie los consultara', async () => {
    await pedidoDemoConfirmado()
    const abandonado = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect(await esperarError(otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' })))).toBe('PAGO_EN_CURSO')
    mundo.avanzar(COBRO_EXPIRACION_SEGUNDOS)
    const nuevo = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect(nuevo.subtotal).toBe(91_800)
    expect(cliente.estado().pagos[abandonado.id]?.estado).toBe('vencido')
  })

  test('la cocina no divide ni cobra', async () => {
    await pedidoDemoConfirmado()
    expect(await esperarError(cocina.dividirEnPartesIguales(MESA, { partes: 2 }))).toBe('SIN_PERMISO')
    expect(await esperarError(cocina.crearPago(MESA, { ...pagoCliente({ tipo: 'saldo' }), medio: 'efectivo' }))).toBe('SIN_PERMISO')
  })
})

describe('dividir la cuenta', () => {
  test('en partes iguales: cada parte se paga una vez y la división no cambia con partes en cobro', async () => {
    await pedidoDemoConfirmado()
    const cuenta = await cliente.dividirEnPartesIguales(MESA, { partes: 3 })
    expect(cuenta.division).toEqual({ partes: 3, montos: [30_600, 30_600, 30_600] })
    expect(await esperarError(cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' })))).toBe('DIVISION_ACTIVA')
    const parte1 = await cliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 1 }, 10))
    expect(parte1).toMatchObject({ parte: 1, subtotal: 30_600, propina: calcularPropina(30_600, INC, 10) })
    expect(parte1.items).toEqual([{ lineaId: null, nombre: 'Consumo, parte 1 de 3', cantidad: 1, precio: 30_600 }])
    expect(await esperarError(otroCliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 1 })))).toBe('PAGO_EN_CURSO')
    expect(await esperarError(otroCliente.dividirEnPartesIguales(MESA, { partes: 2 }))).toBe('DIVISION_ACTIVA')
    expect(await esperarError(otroCliente.quitarDivision(MESA))).toBe('DIVISION_ACTIVA')
    cliente.simulador?.pagarCobro(parte1.id)
    expect(await esperarError(otroCliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 1 })))).toBe('PARTE_NO_DISPONIBLE')
    const parte2 = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 2 }))
    expect(parte2.estado).toBe('esperando_pago')
    expect(cliente.estado().cuentas[parte1.cuentaId]).toMatchObject({ pagado: 30_600, enCobro: 30_600, porPagar: 30_600 })
  })

  test('quitar la división devuelve las unidades', async () => {
    await pedidoDemoConfirmado()
    await cliente.dividirEnPartesIguales(MESA, { partes: 2 })
    const cuenta = await cliente.quitarDivision(MESA)
    expect(cuenta.division).toBeNull()
    expect(cuenta.lineas.every((l) => l.cantidadCubierta === 0)).toBe(true)
  })

  test('por productos: una unidad no puede estar en dos pagos', async () => {
    const cuenta = await pedidoDemoConfirmado()
    const jugo = cuenta.lineas.find((l) => l.productoId === 'jugo-corozo')!
    const mio = await cliente.crearPago(MESA, pagoCliente({ tipo: 'productos', items: [{ lineaId: jugo.id, cantidad: 2 }] }))
    expect(mio).toMatchObject({ subtotal: 16_200 })
    const otro = otroCliente.crearPago(MESA, pagoCliente({ tipo: 'productos', items: [{ lineaId: jugo.id, cantidad: 1 }] }))
    expect(await esperarError(otro)).toBe('PAGO_EN_CURSO')
    const deMas = otroCliente.crearPago(MESA, pagoCliente({ tipo: 'productos', items: [{ lineaId: jugo.id, cantidad: 3 }] }))
    expect(await esperarError(deMas)).toBe('CANTIDAD_NO_DISPONIBLE')
    const resto = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect(resto.subtotal).toBe(91_800 - 16_200)
  })

  test('la plata tardía de una parte cancelada no vale si la división ya no existe', async () => {
    await pedidoDemoConfirmado()
    await cliente.dividirEnPartesIguales(MESA, { partes: 2 })
    const parte1 = await cliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 1 }))
    await cliente.cancelarPago(MESA, parte1.id)
    await otroCliente.quitarDivision(MESA)

    cliente.simulador?.pagarCobro(parte1.id)
    expect(cliente.estado().pagos[parte1.id]).toMatchObject({ estado: 'pagado', incidencia: 'pago_duplicado', estadoFactura: 'sin_emitir' })
    expect(cliente.estado().cuentas[parte1.cuentaId]).toMatchObject({ pagado: 0, porPagar: 91_800 })

    const saldo = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }))
    expect(saldo.subtotal).toBe(91_800)
    otroCliente.simulador?.pagarCobro(saldo.id)
    expect(cliente.estado().cuentas[parte1.cuentaId]).toMatchObject({ pagado: 91_800, porPagar: 0, estado: 'pagada' })
  })

  test('la plata tardía de una parte cancelada vale si su división sigue y nadie tomó esa parte', async () => {
    await pedidoDemoConfirmado()
    await cliente.dividirEnPartesIguales(MESA, { partes: 2 })
    const parte1 = await cliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 1 }))
    await cliente.cancelarPago(MESA, parte1.id)
    cliente.simulador?.pagarCobro(parte1.id)
    expect(cliente.estado().pagos[parte1.id]).toMatchObject({ estado: 'pagado', incidencia: null })
    expect(cliente.estado().cuentas[parte1.cuentaId]).toMatchObject({ pagado: 45_900, porPagar: 45_900 })
  })

  test('con todas las partes pagadas, lo que se pide después se divide y la mesa se libera', async () => {
    await pedidoDemoConfirmado()
    await cliente.dividirEnPartesIguales(MESA, { partes: 2 })
    for (const parte of [1, 2]) {
      const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte }))
      cliente.simulador?.pagarCobro(pago.id)
    }
    const posta = await mesero.agregarLineas(MESA, { items: [{ productoId: 'posta-negra', cantidad: 1, nota: null }] })
    expect(posta).toMatchObject({ pagado: 91_800, porPagar: 37_800 })

    const redividida = await otroCliente.dividirEnPartesIguales(MESA, { partes: 2 })
    expect(redividida.division).toEqual({ partes: 2, montos: [18_900, 18_900] })
    await mesero.crearPago(MESA, { ...pagoCliente({ tipo: 'parte_igual', parte: 1 }), medio: 'efectivo' })
    const parte2 = await otroCliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte: 2 }))
    otroCliente.simulador?.pagarCobro(parte2.id)
    expect(cliente.estado().cuentas[posta.id]).toMatchObject({ pagado: 129_600, porPagar: 0, estado: 'pagada' })
    expect((await mesero.liberarMesa(MESA)).estado).toBe('libre')
  })

  test('con todas las partes pagadas se puede quitar la división y pagar lo nuevo como saldo', async () => {
    await pedidoDemoConfirmado()
    await cliente.dividirEnPartesIguales(MESA, { partes: 2 })
    for (const parte of [1, 2]) {
      const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'parte_igual', parte }))
      cliente.simulador?.pagarCobro(pago.id)
    }
    await mesero.agregarLineas(MESA, { items: [{ productoId: 'posta-negra', cantidad: 1, nota: null }] })
    const sinDivision = await cliente.quitarDivision(MESA)
    expect(sinDivision).toMatchObject({ division: null, pagado: 91_800, porPagar: 37_800 })
    const saldo = await mesero.crearPago(MESA, { ...pagoCliente({ tipo: 'saldo' }), medio: 'tarjeta_debito' })
    expect(saldo.subtotal).toBe(37_800)
    expect((await mesero.liberarMesa(MESA)).estado).toBe('libre')
  })
})

describe('carta', () => {
  test('mesero y cocina solo cambian "agotado"; administración todo', async () => {
    await cocina.actualizarProducto('cocada', { disponible: false })
    expect(await esperarError(mesero.actualizarProducto('cocada', { precio: 1 }))).toBe('SIN_PERMISO')
    const nuevo = await admin.crearProducto({
      nombre: 'Café tinto',
      descripcion: null,
      categoria: 'Bebidas',
      precio: 3_000,
      stock: null,
      disponible: true,
      imagenUrl: null,
    })
    expect(nuevo).toMatchObject({ restauranteId: RESTAURANTE, id: expect.stringMatching(/^cafe-tinto-/) })
    expect((await admin.actualizarProducto(nuevo.id, { stock: 0 })).disponible).toBe(false)
    await admin.borrarProducto(nuevo.id)
    expect(await esperarError(cliente.crearProducto({ ...nuevo }))).toBe('SIN_PERMISO')
  })

  test('el personal solo lee lo de su restaurante', async () => {
    await expect(siguiente((a, b) => cliente.escucharMesas(RESTAURANTE, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    const mesas = await siguiente((a, b) => mesero.escucharMesas(RESTAURANTE, a, b))
    expect(mesas).toHaveLength(5)
    await expect(siguiente((a, b) => mesero.escucharNotas(RESTAURANTE, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
  })

  test('una clave equivocada no entra', async () => {
    expect(await esperarError(mundo.telefono().entrarPersonal('mesero@ribu.demo', 'otra'))).toBe('NO_AUTORIZADO')
  })
})

describe('notas', () => {
  async function facturaEmitida(propina = 10) {
    await pedidoDemoConfirmado()
    const pago = await cliente.crearPago(MESA, pagoCliente({ tipo: 'saldo' }, propina))
    cliente.simulador?.pagarCobro(pago.id)
    mundo.responderDian()
    return pago
  }

  test('una nota crédito no acredita más que la factura y deja la devolución pendiente', async () => {
    const pago = await facturaEmitida()
    const rebaja = await admin.crearNota(pago.id, {
      tipo: 'credito',
      concepto: 'rebaja',
      motivo: 'El jugo llegó tarde',
      lineas: [{ descripcion: 'Rebaja jugo', cantidad: 1, precio: 8_100 }],
    })
    expect(rebaja).toMatchObject({ estado: 'en_proceso', devolucion: 'pendiente', total: 8_100 })
    mundo.responderDian()
    expect(await esperarError(admin.crearNota(pago.id, { tipo: 'credito', concepto: 'anulacion', motivo: 'error' }))).toBe(
      'NOTA_EXCEDE_FACTURA',
    )
    const hecha = await admin.marcarDevolucionHecha(rebaja.id)
    expect(hecha.devolucion).toBe('hecha')
    expect(await esperarError(admin.marcarDevolucionHecha(rebaja.id))).toBe('TRANSICION_INVALIDA')
    expect(admin.estado().facturas[pago.id]?.notas[0]).toMatchObject({ estado: 'emitida', numero: expect.stringMatching(/^NC/) })
  })

  test('la anulación copia la factura con la propina', async () => {
    const pago = await facturaEmitida()
    const nota = await admin.crearNota(pago.id, { tipo: 'credito', concepto: 'anulacion', motivo: 'Cliente inconforme' })
    expect(nota).toMatchObject({ total: 100_300, propina: { base: 85_000, valor: 8_500 } })
    expect(nota.lineas).toHaveLength(3)
  })

  test('una nota débito con Factus Pay se emite cuando entra el cobro', async () => {
    const pago = await facturaEmitida()
    const nota = await admin.crearNota(pago.id, {
      tipo: 'debito',
      concepto: 'otros',
      motivo: 'Se olvidó cobrar una limonada',
      lineas: [{ descripcion: 'Limonada de coco', cantidad: 1, precio: 12_000 }],
      medio: 'factus_pay',
    })
    expect(nota).toMatchObject({ estado: 'sin_emitir', devolucion: 'no_aplica', cobro: { monto: 12_000 } })
    admin.simulador?.pagarCobro(nota.id)
    mundo.responderDian()
    expect(admin.estado().notas[nota.id]?.estado).toBe('emitida')
    expect(await esperarError(cliente.crearNota(pago.id, { tipo: 'credito', concepto: 'anulacion', motivo: 'x' }))).toBe('SIN_PERMISO')
  })
})

test('compradorValido pide los datos que exige la factura a nombre de alguien', () => {
  expect(compradorValido(CONSUMIDOR)).toBe(true)
  expect(compradorValido({ tipo: 'consumidor_final', correo: 'no-es-correo' })).toBe(false)
  expect(compradorValido({ tipo: 'persona', tipoDocumento: 'CC', documento: '1234567', nombre: 'Ana Pérez', correo: 'ana@ejemplo.com' })).toBe(true)
  expect(compradorValido({ tipo: 'empresa', nit: '900123456-1', razonSocial: 'X SAS', correo: 'a@b.co' })).toBe(false)
})

test('comoErrorDatos conserva el código del backend y convierte lo demás en SERVICIO_NO_DISPONIBLE', () => {
  expect(comoErrorDatos({ codigo: 'PAGO_EN_CURSO', mensaje: 'x' }).codigo).toBe('PAGO_EN_CURSO')
  expect(comoErrorDatos(new TypeError('Failed to fetch')).codigo).toBe('SERVICIO_NO_DISPONIBLE')
})

test('pdfDePrueba arma un PDF válido', async () => {
  const texto = await pdfDePrueba(['Factura SETP1', 'Total: 100']).text()
  expect(texto.startsWith('%PDF-1.4')).toBe(true)
  expect(texto).toContain('startxref')
})
