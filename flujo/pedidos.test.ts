import { describe, expect, test } from 'vitest'
import { crearEscenario, lineaIdDe, MESA_1, MESA_R2, quien, R1 } from './apoyo-pruebas'

describe('pedir', () => {
  test('lo del cliente espera al mesero, abre la cuenta y no baja el stock', async () => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), {
      items: [{ productoId: 'plato', cantidad: 2, nota: 'sin sal' }],
    })
    expect(status).toBe(201)
    expect(datos.lineas[0]).toMatchObject({ estado: 'pendiente', origen: 'cliente', precio: 54_000, nota: 'sin sal', ronda: 1 })
    expect(datos.consumo).toBe(0)
    expect((await e.leerProducto('plato')).stock).toBe(20)
    expect(await e.db.leer(`mesas/${MESA_1}`)).toMatchObject({ estado: 'ocupada', cuentaId: datos.id })
  })

  test('lo del personal va directo a cocina y baja el stock', async () => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.mesero(), {
      items: [{ productoId: 'plato', cantidad: 2, nota: null }],
    })
    expect(datos.lineas[0]).toMatchObject({ estado: 'confirmada', origen: 'personal' })
    expect(datos.consumo).toBe(108_000)
    expect((await e.leerProducto('plato')).stock).toBe(18)
  })

  test('el precio sale de la carta, aunque el cuerpo traiga otro', async () => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), {
      items: [{ productoId: 'plato', cantidad: 1, nota: null, precio: 1 }],
    })
    expect(datos.lineas[0].precio).toBe(54_000)
  })

  test('cada pedido es una ronda nueva de la misma cuenta', async () => {
    const e = crearEscenario()
    const primera = await e.pedido([['plato', 1]])
    const segunda = await e.pedido([['bebida', 1]])
    expect(segunda.id).toBe(primera.id)
    expect(segunda.lineas.map((linea) => linea.ronda)).toEqual([1, 2])
  })

  test('errores del pedido', async () => {
    const e = crearEscenario()
    const pedirA = (mesa: string, productoId: string, cantidad = 1) =>
      e.pedir('POST', `/api/mesas/${mesa}/lineas`, quien.cliente(), { items: [{ productoId, cantidad, nota: null }] })
    expect((await pedirA('no-existe', 'plato')).datos.codigo).toBe('NO_ENCONTRADO')
    expect((await pedirA(MESA_1, 'no-existe')).datos.codigo).toBe('PRODUCTO_NO_DISPONIBLE')
    expect((await pedirA(MESA_1, 'mojarra', 3)).datos.codigo).toBe('STOCK_INSUFICIENTE')
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), {
      items: [
        { productoId: 'mojarra', cantidad: 2, nota: null },
        { productoId: 'mojarra', cantidad: 1, nota: null },
      ],
    })
    expect(datos.codigo).toBe('STOCK_INSUFICIENTE')
  })

  test('un restaurante inactivo no recibe pedidos ni pagos', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pedir('PATCH', `/api/restaurantes/${R1}`, quien.plataforma(), { activo: false })
    const pedido = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'plato', cantidad: 1, nota: null }] })
    expect(pedido.datos.codigo).toBe('RESTAURANTE_INACTIVO')
    expect((await e.pagar({ tipo: 'saldo' })).datos.codigo).toBe('RESTAURANTE_INACTIVO')
  })
})

describe('confirmar, rechazar y anular', () => {
  test('confirmar baja el stock y en 0 el producto queda no disponible', async () => {
    const e = crearEscenario()
    await e.pedido([['mojarra', 2]])
    expect(await e.leerProducto('mojarra')).toMatchObject({ stock: 0, disponible: false })
    const otro = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'mojarra', cantidad: 1, nota: null }] })
    expect(otro.datos.codigo).toBe('PRODUCTO_NO_DISPONIBLE')
  })

  test('dos pedidos no pueden pasarse del stock', async () => {
    const e = crearEscenario()
    const pedirMojarra = async () => {
      const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'mojarra', cantidad: 2, nota: null }] })
      return datos.lineas.at(-1).id as string
    }
    const [a, b] = [await pedirMojarra(), await pedirMojarra()]
    const confirmar = (id: string) => e.pedir('POST', `/api/mesas/${MESA_1}/lineas/confirmar`, quien.mesero(), { lineaIds: [id] })
    const resultados = await Promise.all([confirmar(a), confirmar(b)])
    expect(resultados.map((r) => r.status).sort()).toEqual([200, 409])
    expect(resultados.find((r) => r.status === 409)?.datos.codigo).toBe('STOCK_INSUFICIENTE')
    expect((await e.leerProducto('mojarra')).stock).toBe(0)
  })

  test('confirmar dos veces es una transición inválida', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas/confirmar`, quien.mesero(), { lineaIds: [cuenta.lineas[0]!.id] })
    expect(datos.codigo).toBe('TRANSICION_INVALIDA')
    expect((await e.leerProducto('plato')).stock).toBe(19)
  })

  test('rechazar deja el motivo y no suma', async () => {
    const e = crearEscenario()
    const { datos: creada } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'plato', cantidad: 1, nota: null }] })
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas/rechazar`, quien.mesero(), { lineaIds: [creada.lineas[0].id], motivo: 'Se acabó' })
    expect(datos.lineas[0]).toMatchObject({ estado: 'rechazada', motivo: 'Se acabó' })
    expect(datos.consumo).toBe(0)
  })

  test('anular devuelve el stock, y un producto agotado vuelve a estar disponible', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['mojarra', 2]])
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas/anular`, quien.mesero(), { lineaIds: [lineaIdDe(cuenta, 'mojarra')], motivo: 'Se equivocó' })
    expect(datos.lineas[0].estado).toBe('anulada')
    expect(datos.consumo).toBe(0)
    expect(await e.leerProducto('mojarra')).toMatchObject({ stock: 2, disponible: true })
  })

  test('no se anula algo en un pago o en una división', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const anular = () => e.pedir('POST', `/api/mesas/${MESA_1}/lineas/anular`, quien.mesero(), { lineaIds: [cuenta.lineas[0]!.id], motivo: 'x' })
    const { datos: pago } = await e.pagar({ tipo: 'saldo' })
    expect((await anular()).datos.codigo).toBe('LINEA_CON_PAGO')
    await e.pedir('POST', `/api/mesas/${MESA_1}/pagos/${pago.id}/cancelar`, quien.cliente())
    await e.pedir('PUT', `/api/mesas/${MESA_1}/division`, quien.cliente(), { partes: 2 })
    expect((await anular()).datos.codigo).toBe('LINEA_CON_PAGO')
    await e.pedir('DELETE', `/api/mesas/${MESA_1}/division`, quien.cliente())
    expect((await anular()).status).toBe(200)
  })

  test('un QR vencido no impide anular', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await e.pagar({ tipo: 'saldo' })
    e.avanzar(601)
    const { status } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas/anular`, quien.mesero(), { lineaIds: [cuenta.lineas[0]!.id], motivo: 'x' })
    expect(status).toBe(200)
  })

  test('la cocina avanza una línea y no se puede saltar hacia atrás', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const avanzar = (estado: string) => e.pedir('POST', `/api/mesas/${MESA_1}/lineas/${cuenta.lineas[0]!.id}/estado`, quien.cocina(), { estado })
    expect((await avanzar('en_preparacion')).datos.lineas[0].estado).toBe('en_preparacion')
    expect((await avanzar('lista')).datos.lineas[0].estado).toBe('lista')
    expect((await avanzar('en_preparacion')).datos.codigo).toBe('TRANSICION_INVALIDA')
    expect((await avanzar('entregada')).datos.lineas[0].estado).toBe('entregada')
  })
})

describe('liberar', () => {
  test('no se libera con pedidos por confirmar, cobros activos o saldo', async () => {
    const e = crearEscenario()
    const liberar = () => e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())
    await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'plato', cantidad: 1, nota: null }] })
    expect((await liberar()).datos.codigo).toBe('MESA_CON_SALDO')

    const e2 = crearEscenario()
    await e2.pedido([['plato', 1]])
    const liberar2 = () => e2.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())
    expect((await liberar2()).datos.codigo).toBe('MESA_CON_SALDO')
    await e2.pagar({ tipo: 'saldo' })
    expect((await liberar2()).datos.codigo).toBe('MESA_CON_SALDO')
  })

  test('al liberar, el siguiente cliente no ve nada del anterior y el token no cambia', async () => {
    const e = crearEscenario()
    const anterior = await e.pedido([['plato', 1]])
    await e.pagoCompleto({ tipo: 'saldo' })
    const { status, datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())
    expect(status).toBe(200)
    expect(datos).toMatchObject({ token: MESA_1, estado: 'libre', cuentaId: null })
    expect(await e.leerCuenta(anterior.id)).toMatchObject({ estado: 'cerrada' })

    const nueva = await e.pedido([['bebida', 1]], MESA_1, quien.cliente('cliente-2'))
    expect(nueva.id).not.toBe(anterior.id)
    expect(nueva.lineas).toHaveLength(1)
    expect(nueva.pagos).toEqual([])
  })

  test('las facturas en proceso no bloquean la mesa', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar({ tipo: 'saldo' })
    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    expect((await e.leerFactura(pago.id)).estado).toBe('en_proceso')
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
    await e.emitirFactura(pago.id)
    expect((await e.leerFactura(pago.id)).estado).toBe('emitida')
  })

  test('un QR vencido no impide liberar si otro ya pagó', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pagar({ tipo: 'saldo' })
    e.avanzar(601)
    await e.pagar({ tipo: 'saldo' }, { medio: 'efectivo', token: quien.mesero() })
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
  })
})

describe('el personal solo actúa sobre su restaurante', () => {
  test.each([
    ['POST', `/api/mesas/${MESA_1}/lineas`, { items: [{ productoId: 'plato', cantidad: 1, nota: null }] }],
    ['POST', `/api/mesas/${MESA_1}/lineas/confirmar`, { lineaIds: ['x'] }],
    ['POST', `/api/mesas/${MESA_1}/liberar`, undefined],
    ['PUT', `/api/mesas/${MESA_1}/division`, { partes: 2 }],
    ['POST', `/api/mesas/${MESA_1}/pagos`, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: { tipo: 'consumidor_final', correo: null }, medio: 'efectivo' }],
  ])('%s %s', async (metodo, ruta, cuerpo) => {
    const e = crearEscenario()
    const { status, datos } = await e.pedir(metodo, ruta, quien.mesero('rest-2'), cuerpo)
    expect(status).toBe(403)
    expect(datos.codigo).toBe('SIN_PERMISO')
  })

  test('el restaurante del cuerpo se ignora', async () => {
    const e = crearEscenario()
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_R2}/lineas`, quien.cliente(), {
      restauranteId: R1,
      rol: 'admin',
      items: [{ productoId: 'plato', cantidad: 1, nota: null }],
    })
    expect(datos.restauranteId).toBe('rest-2')
    expect(datos.lineas[0].estado).toBe('pendiente')
  })
})
