import { describe, expect, test } from 'vitest'
import { MONTO_MINIMO_COBRO } from '../contratos/reglas'
import { crearEscenario, FINAL, lineaIdDe, MESA_1, quien, R1, R2 } from './apoyo-pruebas'
import { barrer } from './programado'

const SALDO = { tipo: 'saldo' }
const parte = (n: number) => ({ tipo: 'parte_igual', parte: n })

const cancelar = (e: ReturnType<typeof crearEscenario>, pagoId: string) =>
  e.pedir('POST', `/api/mesas/${MESA_1}/pagos/${pagoId}/cancelar`, quien.cliente())
const dividir = (e: ReturnType<typeof crearEscenario>, partes: number) =>
  e.pedir('PUT', `/api/mesas/${MESA_1}/division`, quien.cliente(), { partes })

describe('el flujo completo', () => {
  test('pedir, confirmar, pagar, aviso, factura y liberar, con los números de docs/datos-demo.md', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['mojarra', 2], ['bebida', 2]])
    expect(cuenta.consumo).toBe(81_000)

    const { status, datos: pago } = await e.pagar(SALDO, { propina: 10 })
    expect(status).toBe(201)
    expect(pago).toMatchObject({ estado: 'esperando_pago', subtotal: 81_000, propina: 7_500, total: 88_500, baseSinImpuesto: 75_000 })
    expect(pago.cobro).toMatchObject({ estado: 'ready', monto: 88_500 })
    expect(pago.cobro?.qrBase64).toBeTruthy()
    expect(pago.cobro?.llaveBreB).toBeTruthy()
    expect((await e.leerCuenta(cuenta.id))).toMatchObject({ enCobro: 81_000, porPagar: 0, pagado: 0 })

    e.cobros.marcarPagado(pago.id)
    expect((await e.avisoDePago(pago.id)).status).toBe(200)
    expect(await e.leerPago(pago.id)).toMatchObject({ estado: 'pagado', estadoFactura: 'en_proceso', incidencia: null })
    expect((await e.leerFactura(pago.id)).pagador).toMatchObject({ documento: '1000000001' })

    await e.emitirFactura(pago.id)
    const factura = await e.leerFactura(pago.id)
    expect(factura.estado).toBe('emitida')
    expect(factura.datos.numero).toBeTruthy()
    expect(factura.datos.cufe).toBeTruthy()
    expect(factura.datos.qrUrl).toBeTruthy()
    expect((await e.leerCuenta(cuenta.id))).toMatchObject({ estado: 'pagada', pagado: 81_000, enCobro: 0, porPagar: 0 })
    expect((await e.leerCuenta(cuenta.id)).pagos[0]?.estadoFactura).toBe('emitida')

    const pdf = await e.pedir('GET', `/api/mesas/${MESA_1}/pagos/${pago.id}/factura/pdf`, quien.cliente())
    expect(pdf.status).toBe(200)
    expect(pdf.cabeceras.get('content-type')).toBe('application/pdf')
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
  })

  test('la solicitud a Factus lleva la base por línea y la propina como { base, valor }', async () => {
    const e = crearEscenario()
    await e.pedido([['mojarra', 2], ['bebida', 2]])
    const pago = await e.pagoCompleto(SALDO, { propina: 10 })
    expect(e.facturacion.emisiones[0]).toMatchObject({
      referencia: pago.id,
      total: 88_500,
      medio: 'factus_pay',
      propina: { base: 75_000, valor: 7_500 },
      lineas: [
        { descripcion: 'Mojarra', cantidad: 2, precioSinImpuesto: 30_000 },
        { descripcion: 'Bebida', cantidad: 2, precioSinImpuesto: 7_500 },
      ],
    })
  })

  test('sin propina no se envía recargo', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pagoCompleto(SALDO)
    expect(e.facturacion.emisiones[0]?.propina).toBeNull()
  })

  test('una parte igual se factura como una sola línea', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 2]])
    await dividir(e, 3)
    await e.pagoCompleto(parte(2))
    expect(e.facturacion.emisiones[0]?.lineas).toEqual([
      { codigo: expect.any(String), descripcion: 'Consumo, parte 2 de 3', cantidad: 1, precioSinImpuesto: 33_333.33 },
    ])
  })
})

describe('una misma unidad no puede estar en dos pagos', () => {
  test('dos personas pagan el saldo a la vez: solo una entra', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const resultados = await Promise.all([e.pagar(SALDO), e.pagar(SALDO, { token: quien.cliente('cliente-2') })])
    expect(resultados.map((r) => r.status).sort()).toEqual([201, 409])
    expect(resultados.find((r) => r.status === 409)?.datos).toMatchObject({ codigo: 'PAGO_EN_CURSO' })
  })

  test('productos: lo que otro cobra no está disponible, pero el resto sí', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 3]])
    const linea = lineaIdDe(cuenta, 'plato')
    const productos = (cantidad: number) => ({ tipo: 'productos', items: [{ lineaId: linea, cantidad }] })
    expect((await e.pagar(productos(2))).status).toBe(201)
    expect((await e.pagar(productos(2))).datos.codigo).toBe('PAGO_EN_CURSO')
    expect((await e.pagar(productos(1))).status).toBe(201)
    expect((await e.pagar(productos(1))).datos.codigo).toBe('PAGO_EN_CURSO')
    expect((await e.leerCuenta(cuenta.id)).lineas[0]?.cantidadCubierta).toBe(3)
  })

  test('repetir la línea en el mismo pago no la cuenta dos veces', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const linea = lineaIdDe(cuenta, 'plato')
    const { datos } = await e.pagar({ tipo: 'productos', items: [{ lineaId: linea, cantidad: 1 }, { lineaId: linea, cantidad: 1 }] })
    expect(datos.codigo).toBe('CANTIDAD_NO_DISPONIBLE')
  })

  test('lo pendiente no se paga', async () => {
    const e = crearEscenario()
    const { datos: creada } = await e.pedir('POST', `/api/mesas/${MESA_1}/lineas`, quien.cliente(), { items: [{ productoId: 'plato', cantidad: 1, nota: null }] })
    expect((await e.pagar(SALDO)).datos.codigo).toBe('NADA_POR_PAGAR')
    const { datos } = await e.pagar({ tipo: 'productos', items: [{ lineaId: creada.lineas[0].id, cantidad: 1 }] })
    expect(datos.codigo).toBe('CANTIDAD_NO_DISPONIBLE')
  })

  test('una mesa sin cuenta no tiene nada por pagar', async () => {
    const e = crearEscenario()
    expect((await e.pagar(SALDO)).datos.codigo).toBe('NO_ENCONTRADO')
  })

  test('lo ya pagado no se vuelve a pagar', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pagoCompleto(SALDO)
    expect((await e.pagar(SALDO)).datos.codigo).toBe('NADA_POR_PAGAR')
  })
})

describe('partes iguales', () => {
  test('reparte lo que falta y los pesos sobrantes van a las primeras', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1], ['bebida', 1]])
    const { datos } = await dividir(e, 3)
    expect(datos.division.montos).toEqual([20_700, 20_700, 20_700])
    const { datos: otra } = await dividir(e, 4)
    expect(otra.division.montos).toEqual([15_525, 15_525, 15_525, 15_525])
    expect(otra.lineas.every((l: { cantidadCubierta: number; cantidad: number }) => l.cantidadCubierta === l.cantidad)).toBe(true)
  })

  test('una parte no se cobra dos veces, y lo dividido no se paga por productos', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    expect((await e.pagar(parte(1))).status).toBe(201)
    expect((await e.pagar(parte(1))).datos.codigo).toBe('PAGO_EN_CURSO')
    expect((await e.pagar(parte(3))).datos.codigo).toBe('PARTE_NO_DISPONIBLE')
    const { datos } = await e.pagar({ tipo: 'productos', items: [{ lineaId: cuenta.lineas[0]!.id, cantidad: 1 }] })
    expect(datos.codigo).toBe('CANTIDAD_NO_DISPONIBLE')
    expect((await e.pagar(SALDO)).datos.codigo).toBe('PAGO_EN_CURSO')
  })

  test('una parte pagada no se vuelve a pagar', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await dividir(e, 2)
    await e.pagoCompleto(parte(1))
    expect((await e.pagar(parte(1))).datos.codigo).toBe('PARTE_NO_DISPONIBLE')
  })

  test('sin división no hay partes', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    expect((await e.pagar(parte(1))).datos.codigo).toBe('PARTE_NO_DISPONIBLE')
  })

  test('con una parte activa o pagada no se cambia ni se quita la división', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: pago } = await e.pagar(parte(1))
    expect((await dividir(e, 3)).datos.codigo).toBe('DIVISION_ACTIVA')
    expect((await e.pedir('DELETE', `/api/mesas/${MESA_1}/division`, quien.cliente())).datos.codigo).toBe('DIVISION_ACTIVA')
    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    expect((await dividir(e, 3)).datos.codigo).toBe('DIVISION_ACTIVA')
  })

  test('un cobro de productos activo impide dividir', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 2]])
    await e.pagar({ tipo: 'productos', items: [{ lineaId: cuenta.lineas[0]!.id, cantidad: 1 }] })
    expect((await dividir(e, 2)).datos.codigo).toBe('PAGO_EN_CURSO')
  })

  test('sin nada por pagar no se divide', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pagoCompleto(SALDO)
    expect((await dividir(e, 2)).datos.codigo).toBe('NADA_POR_PAGAR')
  })

  test('una parte de $0 no existe, pero una pequeña sí, y se paga en efectivo', async () => {
    const e = crearEscenario()
    await e.pedido([['agua', 1]])
    const { status, datos } = await dividir(e, 2)
    expect(status).toBe(200)
    expect(datos.division.montos).toEqual([2_025, 2_025])
    expect((await e.pagar(parte(1))).datos.codigo).toBe('MONTO_FUERA_DE_RANGO')
    expect((await e.pagar(parte(1), { medio: 'efectivo', token: quien.mesero() })).status).toBe(201)
  })

  test('todas las partes pagadas dejan la cuenta pagada y la mesa libre', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    await e.pagoCompleto(parte(1))
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'abierta', pagado: 27_000, porPagar: 27_000 })
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).datos.codigo).toBe('MESA_CON_SALDO')
    await e.pagoCompleto(parte(2))
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'pagada', pagado: 54_000, porPagar: 0, division: null })
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
  })

  test('lo pedido después de dividir se paga aparte, sin tocar las partes', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    await e.pedido([['bebida', 2]])
    const { datos } = await e.pagar(SALDO)
    expect(datos.subtotal).toBe(16_200)
    expect((await e.pagar(parte(1))).status).toBe(201)
    expect((await e.leerCuenta(cuenta.id)).division?.montos).toEqual([27_000, 27_000])
  })
})

describe('tras pagar todas las partes y pedir algo más, la cuenta no queda bloqueada', () => {
  async function partesPagadasYAlgoMas(producto = 'bebida') {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    await e.pagoCompleto(parte(1))
    await e.pagoCompleto(parte(2))
    await e.pedido([[producto, 2]])
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'abierta', porPagar: producto === 'bebida' ? 16_200 : 8_100 })
    return { e, cuenta }
  }

  test('con Factus Pay', async () => {
    const { e, cuenta } = await partesPagadasYAlgoMas()
    await e.pagoCompleto(SALDO)
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'pagada', pagado: 70_200, porPagar: 0 })
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
  })

  test('en efectivo, por debajo del mínimo de Factus Pay', async () => {
    const { e, cuenta } = await partesPagadasYAlgoMas('agua')
    expect((await e.pagar(SALDO)).datos.codigo).toBe('MONTO_FUERA_DE_RANGO')
    const { status } = await e.pagar(SALDO, { medio: 'efectivo', token: quien.mesero() })
    expect(status).toBe(201)
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'pagada', pagado: 62_100, porPagar: 0 })
    expect((await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())).status).toBe(200)
  })

  test('también se puede volver a dividir, y las partes viejas no estorban', async () => {
    const { e, cuenta } = await partesPagadasYAlgoMas()
    const { datos } = await dividir(e, 2)
    expect(datos.division.montos).toEqual([8_100, 8_100])
    expect((await e.pagar(parte(1), { medio: 'efectivo', token: quien.mesero() })).status).toBe(201)
    expect((await e.pagar(parte(2), { medio: 'efectivo', token: quien.mesero() })).status).toBe(201)
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ estado: 'pagada', pagado: 70_200, porPagar: 0 })
  })
})

describe('montos', () => {
  test('Factus Pay tiene mínimo, con propina incluida. El efectivo y la tarjeta no', async () => {
    const e = crearEscenario()
    await e.pedido([['bebida', 1]])
    expect((await e.pagar(SALDO)).datos.codigo).toBe('MONTO_FUERA_DE_RANGO')
    const { status, datos } = await e.pagar(SALDO, { propina: 100 })
    expect(status).toBe(201)
    expect(datos.total).toBeGreaterThan(MONTO_MINIMO_COBRO)
  })

  test('el rechazo por monto no deja nada congelado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['agua', 1]])
    await e.pagar(SALDO, { propina: 0 })
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual).toMatchObject({ enCobro: 0, porPagar: 4_050 })
    expect(actual.lineas[0]?.cantidadCubierta).toBe(0)
    expect(actual.pagos).toEqual([])
  })

  test.each(['efectivo', 'tarjeta_debito', 'tarjeta_credito'])('%s sin mínimo: queda pagado y se factura', async (medio) => {
    const e = crearEscenario()
    await e.pedido([['agua', 1]])
    const { status, datos } = await e.pagar(SALDO, { medio, token: quien.mesero() })
    expect(status).toBe(201)
    expect(datos).toMatchObject({ estado: 'pagado', cobro: null, estadoFactura: 'en_proceso', total: 4_050 })
    await e.emitirFactura(datos.id)
    expect((await e.leerFactura(datos.id)).estado).toBe('emitida')
    expect(e.facturacion.emisiones[0]?.medio).toBe(medio)
  })

  test('el efectivo y la tarjeta solo los registra el personal', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    expect((await e.pagar(SALDO, { medio: 'efectivo' })).datos.codigo).toBe('SIN_PERMISO')
  })

  test('propina y comprador se validan', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    expect((await e.pagar(SALDO, { propina: 101 })).datos.codigo).toBe('PROPINA_INVALIDA')
    expect((await e.pagar(SALDO, { propina: 1.5 })).datos.codigo).toBe('PROPINA_INVALIDA')
    const persona = { tipo: 'persona', tipoDocumento: 'CC', documento: '', nombre: 'A', correo: 'a@b.co' } as never
    expect((await e.pagar(SALDO, { comprador: persona })).datos.codigo).toBe('COMPRADOR_INVALIDO')
    const empresa = { tipo: 'empresa', nit: '900', razonSocial: 'X', correo: 'no-es-correo' } as never
    expect((await e.pagar(SALDO, { comprador: empresa })).datos.codigo).toBe('COMPRADOR_INVALIDO')
  })
})

describe('un QR vencido sigue en ready', () => {
  test('antes de crear un pago se vencen los cobros cuyo QR ya pasó', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: primero } = await e.pagar(SALDO)
    e.avanzar(599)
    expect((await e.pagar(SALDO)).datos.codigo).toBe('PAGO_EN_CURSO')
    e.avanzar(2)
    // Factus Pay sigue diciendo `ready`: quien pagaba cerró la pestaña y nadie canceló.
    expect((await e.cobros.consultarCobro(primero.id)).estado).toBe('ready')
    const { status, datos: segundo } = await e.pagar(SALDO, { token: quien.cliente('cliente-2') })
    expect(status).toBe(201)
    expect(segundo.id).not.toBe(primero.id)
    expect((await e.leerPago(primero.id)).estado).toBe('vencido')
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ enCobro: 54_000, porPagar: 0 })
    expect((await e.leerCuenta(cuenta.id)).lineas[0]?.cantidadCubierta).toBe(1)
  })

  test('también al dividir', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await e.pagar(SALDO)
    expect((await dividir(e, 2)).datos.codigo).toBe('PAGO_EN_CURSO')
    e.avanzar(601)
    expect((await dividir(e, 2)).status).toBe(200)
  })

  test('una parte vencida queda libre otra vez', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    await dividir(e, 2)
    await e.pagar(parte(1))
    e.avanzar(601)
    expect((await e.pagar(parte(1))).status).toBe(201)
  })

  test('la tarea de cada minuto los vence sin que nadie haga nada, y antes pregunta', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    await barrer(e.ctx)
    expect((await e.leerPago(pago.id)).estado).toBe('esperando_pago')
    e.avanzar(601)
    await barrer(e.ctx)
    expect((await e.leerPago(pago.id)).estado).toBe('vencido')
    expect((await e.leerReferencia(pago.id)).venceEn).toBeNull()
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ enCobro: 0, porPagar: 54_000 })
  })

  test('si ya estaba pagado y el aviso se perdió, la tarea lo confirma en vez de vencerlo', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarPagado(pago.id)
    e.avanzar(601)
    await barrer(e.ctx)
    expect(await e.leerPago(pago.id)).toMatchObject({ estado: 'pagado', incidencia: null })
  })

  test('si Factus Pay no responde, igual vence', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.ctx.cobros = {
      ...e.cobros,
      consultarCobro: async () => {
        const { ErrorIntegracion } = await import('../contratos/reglas')
        throw new ErrorIntegracion('caído', 'factus_pay', 'red')
      },
    }
    e.avanzar(601)
    await barrer(e.ctx)
    expect((await e.leerPago(pago.id)).estado).toBe('vencido')
  })

  test('un pago sin QR, porque el proceso murió al crearlo, tampoco bloquea para siempre', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    await e.ctx.db.transaccion(async (tx) => tx.actualizar(`restaurantes/${R1}/pagos/${pago.id}`, { cobro: null }))
    e.avanzar(601)
    expect((await e.pagar(SALDO)).status).toBe(201)
    expect((await e.leerPago(pago.id)).estado).toBe('vencido')
    expect((await e.leerCuenta(cuenta.id)).enCobro).toBe(54_000)
  })
})

describe('si llega paid de un pago vencido o cancelado', () => {
  test('vale si lo que cubría sigue libre', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    await cancelar(e, pago.id)
    expect((await e.leerPago(pago.id)).estado).toBe('cancelado')
    expect((await e.leerCuenta(cuenta.id)).lineas[0]?.cantidadCubierta).toBe(0)

    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    expect(await e.leerPago(pago.id)).toMatchObject({ estado: 'pagado', incidencia: null, estadoFactura: 'en_proceso' })
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual).toMatchObject({ estado: 'pagada', pagado: 54_000 })
    expect(actual.lineas[0]?.cantidadCubierta).toBe(1)
    await e.emitirFactura(pago.id)
    expect((await e.leerFactura(pago.id)).estado).toBe('emitida')
  })

  test('si otro ya lo cubrió, queda pago_duplicado: sin factura y sin sumar', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    e.avanzar(601)
    await e.pagoCompleto(SALDO, { token: quien.cliente('cliente-2') })

    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect(await e.leerPago(viejo.id)).toMatchObject({ estado: 'pagado', incidencia: 'pago_duplicado', estadoFactura: 'sin_emitir' })
    expect((await e.leerFactura(viejo.id)).estado).toBe('sin_emitir')
    await e.emitirFactura(viejo.id)
    expect(e.facturacion.emisiones).toHaveLength(1)
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual).toMatchObject({ pagado: 54_000, consumo: 54_000, porPagar: 0 })
    expect(actual.lineas[0]?.cantidadCubierta).toBe(1)
  })

  test('si lo que cubre lo cobra otro en este momento, también es duplicado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    await cancelar(e, viejo.id)
    await e.pagar(SALDO, { token: quien.cliente('cliente-2') })
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ pagado: 0, enCobro: 54_000 })
  })

  test('un cobro ajeno ya vencido no hace parecer ocupado lo que está libre', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    await cancelar(e, viejo.id)
    const { datos: abandonado } = await e.pagar(SALDO, { token: quien.cliente('cliente-2') })
    e.avanzar(601)
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect(await e.leerPago(viejo.id)).toMatchObject({ estado: 'pagado', incidencia: null })
    expect((await e.leerPago(abandonado.id)).estado).toBe('vencido')
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(54_000)
  })

  test('un pago de una cuenta ya cerrada es duplicado', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    e.avanzar(601)
    await e.pagoCompleto(SALDO)
    await e.pedir('POST', `/api/mesas/${MESA_1}/liberar`, quien.mesero())
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
  })

  test('un pago anulado por otra línea anulada es duplicado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    await cancelar(e, viejo.id)
    await e.pedir('POST', `/api/mesas/${MESA_1}/lineas/anular`, quien.mesero(), { lineaIds: [cuenta.lineas[0]!.id], motivo: 'x' })
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(0)
  })
})

describe('partes canceladas y divisiones que cambian: el total pagado nunca supera el consumo', () => {
  test('parte cancelada y paid con la misma división: vale, si la parte sigue libre', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: pago } = await e.pagar(parte(1))
    await cancelar(e, pago.id)
    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    expect((await e.leerPago(pago.id)).incidencia).toBeNull()
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(27_000)
    expect((await e.pagar(parte(1))).datos.codigo).toBe('PARTE_NO_DISPONIBLE')
  })

  test('si otro ya tomó esa parte, es duplicado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: viejo } = await e.pagar(parte(1))
    await cancelar(e, viejo.id)
    await e.pagoCompleto(parte(1), { token: quien.cliente('cliente-2') })
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(27_000)
  })

  test('parte cancelada, división quitada y todo pagado aparte: es duplicado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: viejo } = await e.pagar(parte(1))
    await cancelar(e, viejo.id)
    await e.pedir('DELETE', `/api/mesas/${MESA_1}/division`, quien.cliente())
    await e.pagoCompleto(SALDO)
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect(await e.leerPago(viejo.id)).toMatchObject({ incidencia: 'pago_duplicado', estadoFactura: 'sin_emitir' })
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual.pagado).toBe(54_000)
    expect(actual.pagado).toBeLessThanOrEqual(actual.consumo)
  })

  test('parte cancelada y división quitada, sin más pagos: no toma lo que ya no es suyo', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: viejo } = await e.pagar(parte(1))
    await cancelar(e, viejo.id)
    await e.pedir('DELETE', `/api/mesas/${MESA_1}/division`, quien.cliente())
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ pagado: 0, porPagar: 54_000 })
    expect((await e.pagar(SALDO)).datos.subtotal).toBe(54_000)
  })

  test('parte cancelada de una división reemplazada por otra igual: no ocupa la nueva', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    await dividir(e, 2)
    const { datos: viejo } = await e.pagar(parte(1))
    await cancelar(e, viejo.id)
    await dividir(e, 2)
    e.cobros.marcarPagado(viejo.id)
    await e.avisoDePago(viejo.id)
    expect((await e.leerPago(viejo.id)).incidencia).toBe('pago_duplicado')
    expect((await e.pagar(parte(1))).status).toBe(201)
    await e.pagar(parte(2))
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(0)
  })

  test('muchos avisos tardíos de partes viejas nunca superan el consumo', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const viejos: string[] = []
    for (let i = 0; i < 3; i++) {
      await dividir(e, 2)
      viejos.push((await e.pagar(parte(1))).datos.id, (await e.pagar(parte(2))).datos.id)
      for (const id of viejos.slice(-2)) await cancelar(e, id)
    }
    await e.pedir('DELETE', `/api/mesas/${MESA_1}/division`, quien.cliente())
    await e.pagoCompleto(SALDO)
    for (const id of viejos) {
      e.cobros.marcarPagado(id)
      await e.avisoDePago(id)
    }
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual.pagado).toBe(54_000)
    expect(actual.consumo).toBe(54_000)
  })
})

describe('webhook', () => {
  test('sin la llave correcta responde 401 y no marca nada', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarPagado(pago.id)
    const { status, datos } = await e.avisoDePago(pago.id, 'llave-falsa')
    expect(status).toBe(401)
    expect(datos.codigo).toBe('NO_AUTORIZADO')
    expect((await e.leerPago(pago.id)).estado).toBe('esperando_pago')
  })

  test('no se le cree al aviso: sin paid en la consulta no se marca', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    expect((await e.avisoDePago(pago.id)).status).toBe(200)
    expect((await e.leerPago(pago.id)).estado).toBe('esperando_pago')
  })

  test('un monto distinto al del pago no se marca, y el pago vence como cualquiera', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const pagado = e.cobros.marcarPagado(pago.id)
    e.ctx.cobros = { ...e.cobros, consultarCobro: async () => ({ ...pagado, monto: 1_000 }) }
    expect((await e.avisoDePago(pago.id)).status).toBe(200)
    expect((await e.leerPago(pago.id)).estado).toBe('esperando_pago')
    expect((await e.leerFactura(pago.id)).estado).toBe('sin_emitir')
    e.avanzar(601)
    await barrer(e.ctx)
    expect((await e.leerPago(pago.id)).estado).toBe('vencido')
    expect((await e.leerReferencia(pago.id)).venceEn).toBeNull()
  })

  test('la referencia dice de qué restaurante es, no la URL', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarPagado(pago.id)
    const { status } = await e.avisoDePago(pago.id, undefined, R2)
    expect(status).toBe(200)
    expect((await e.leerPago(pago.id, R1)).estado).toBe('pagado')
    expect(await e.db.leer(`restaurantes/${R2}/pagos/${pago.id}`)).toBeNull()
  })

  test('la referencia es del backend: apunta al restaurante y dice qué es', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    expect(await e.leerReferencia(pago.id)).toMatchObject({ restauranteId: R1, tipo: 'pago' })
  })

  test('una referencia desconocida se responde 200: no hay nada que reintentar', async () => {
    const e = crearEscenario()
    const cuerpo = { data: { reference_code: 'de-otro-sistema', amount: 20_000, status: 'paid' } }
    const { status } = await e.pedir('POST', `/api/webhooks/factus-pay/x?key=llave-de-ejemplo-del-webhook-de-ribu`, null, cuerpo)
    expect(status).toBe(200)
  })

  test('un cuerpo sin referencia es inválido, y uno que no es JSON también', async () => {
    const e = crearEscenario()
    const ruta = '/api/webhooks/factus-pay/x?key=llave-de-ejemplo-del-webhook-de-ribu'
    expect((await e.pedir('POST', ruta, null, { data: {} })).datos.codigo).toBe('CUERPO_INVALIDO')
    expect((await e.pedir('POST', ruta, null, 'esto no es json')).datos.codigo).toBe('CUERPO_INVALIDO')
  })

  test('si la consulta falla responde 503, para que Factus Pay repita', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarPagado(pago.id)
    const original = e.cobros
    const { ErrorIntegracion } = await import('../contratos/reglas')
    e.ctx.cobros = { ...original, consultarCobro: async () => { throw new ErrorIntegracion('caído', 'factus_pay', 'red') } }
    const fallido = await e.avisoDePago(pago.id)
    expect(fallido.status).toBe(503)
    expect(JSON.stringify(fallido.datos)).not.toContain('caído')
    expect((await e.leerPago(pago.id)).estado).toBe('esperando_pago')
    e.ctx.cobros = original
    expect((await e.avisoDePago(pago.id)).status).toBe(200)
    expect((await e.leerPago(pago.id)).estado).toBe('pagado')
  })

  test('el aviso repetido no suma dos veces ni emite dos facturas', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarPagado(pago.id)
    await Promise.all([e.avisoDePago(pago.id), e.avisoDePago(pago.id), e.avisoDePago(pago.id)])
    await Promise.all([e.emitirFactura(pago.id), e.emitirFactura(pago.id)])
    await e.avisoDePago(pago.id)
    await e.emitirFactura(pago.id)
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(54_000)
    expect(e.facturacion.emisiones).toHaveLength(1)
  })

  test('un cobro failed o rejected suelta lo que cubría', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    e.cobros.marcarEstado(pago.id, 'failed')
    await e.avisoDePago(pago.id)
    expect((await e.leerPago(pago.id)).estado).toBe('fallido')
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ enCobro: 0, porPagar: 54_000 })
    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    expect((await e.leerPago(pago.id)).incidencia).toBeNull()
  })
})

describe('verificar', () => {
  test('sirve de respaldo del webhook', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const ruta = `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`
    expect((await e.pedir('POST', ruta, quien.cliente())).datos.estado).toBe('esperando_pago')
    e.cobros.marcarPagado(pago.id)
    e.avanzar(6)
    expect((await e.pedir('POST', ruta, quien.cliente())).datos.estado).toBe('pagado')
  })

  test('no consulta el mismo pago más de una vez cada CONSULTA_COBRO_SEGUNDOS', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    let consultas = 0
    const { cobros } = e
    e.ctx.cobros = { ...cobros, consultarCobro: (referencia) => (consultas++, cobros.consultarCobro(referencia)) }
    const ruta = `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`
    await e.pedir('POST', ruta, quien.cliente())
    await e.pedir('POST', ruta, quien.cliente())
    e.avanzar(4)
    await e.pedir('POST', ruta, quien.cliente())
    expect(consultas).toBe(1)
    e.avanzar(2)
    await e.pedir('POST', ruta, quien.cliente())
    expect(consultas).toBe(2)
  })

  test('lo puede consultar cualquier cliente de la mesa, no solo quien creó el pago', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO, { token: quien.cliente('duena') })
    e.cobros.marcarPagado(pago.id)
    const { status, datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`, quien.cliente('otra'))
    expect(status).toBe(200)
    expect(datos.estado).toBe('pagado')
  })

  test('marca vencido según qrExpiraEn, aunque Factus Pay siga diciendo ready', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const ruta = `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`
    e.avanzar(599)
    expect((await e.pedir('POST', ruta, quien.cliente('otra'))).datos.estado).toBe('esperando_pago')
    e.avanzar(6)
    const { datos } = await e.pedir('POST', ruta, quien.cliente('otra'))
    expect(datos.estado).toBe('vencido')
    expect(datos.cobro.estado).toBe('ready')
    expect(await e.leerCuenta(cuenta.id)).toMatchObject({ enCobro: 0, porPagar: 54_000 })
  })

  test.each(['vencido', 'cancelado'])('sigue consultando un pago %s, y si entró la plata vale', async (estado) => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const ruta = `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`
    if (estado === 'cancelado') await cancelar(e, pago.id)
    else e.avanzar(601)
    expect((await e.pedir('POST', ruta, quien.cliente())).datos.estado).toBe(estado)
    e.avanzar(6)
    expect((await e.pedir('POST', ruta, quien.cliente())).datos.estado).toBe(estado)
    e.cobros.marcarPagado(pago.id)
    e.avanzar(6)
    const { datos } = await e.pedir('POST', ruta, quien.cliente())
    expect(datos).toMatchObject({ estado: 'pagado', incidencia: null })
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(54_000)
  })

  test('sigue consultando un pago vencido, y si otro ya pagó queda duplicado', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const { datos: viejo } = await e.pagar(SALDO)
    e.avanzar(601)
    await e.pagoCompleto(SALDO, { token: quien.cliente('cliente-2') })
    e.cobros.marcarPagado(viejo.id)
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/pagos/${viejo.id}/verificar`, quien.cliente())
    expect(datos).toMatchObject({ estado: 'pagado', incidencia: 'pago_duplicado' })
    expect((await e.leerCuenta(cuenta.id)).pagado).toBe(54_000)
  })

  test('una consulta que no trae el QR no borra el que ya tenía el pago', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const { cobros } = e
    e.ctx.cobros = { ...cobros, consultarCobro: async (ref) => ({ ...(await cobros.consultarCobro(ref)), qrBase64: null, llaveBreB: null }) }
    const { datos } = await e.pedir('POST', `/api/mesas/${MESA_1}/pagos/${pago.id}/verificar`, quien.cliente())
    expect(datos.cobro).toMatchObject({ qrBase64: pago.cobro.qrBase64, llaveBreB: pago.cobro.llaveBreB })
  })

  test('un pago de otra mesa no existe aquí', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const { datos } = await e.pedir('POST', `/api/mesas/mesa-dos/pagos/${pago.id}/verificar`, quien.cliente())
    expect(datos.codigo).toBe('NO_ENCONTRADO')
  })
})

describe('cancelar', () => {
  test('solo quien lo creó o el personal', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO)
    const ruta = `/api/mesas/${MESA_1}/pagos/${pago.id}/cancelar`
    expect((await e.pedir('POST', ruta, quien.cliente('otro'))).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('POST', ruta, quien.mesero())).datos.estado).toBe('cancelado')
    expect((await e.pedir('POST', ruta, quien.mesero())).datos.codigo).toBe('TRANSICION_INVALIDA')
  })

  test('un pago hecho no se cancela', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const pago = await e.pagoCompleto(SALDO)
    expect((await cancelar(e, pago.id)).datos.codigo).toBe('TRANSICION_INVALIDA')
  })

  test('si crear el cobro falla, nada queda congelado y no se filtra el error', async () => {
    const e = crearEscenario()
    const cuenta = await e.pedido([['plato', 1]])
    const original = e.cobros
    const { ErrorIntegracion } = await import('../contratos/reglas')
    e.ctx.cobros = { ...original, crearCobro: async () => { throw new ErrorIntegracion('token-secreto en el mensaje', 'factus_pay', 'servidor', 500) } }
    const { status, datos } = await e.pagar(SALDO)
    expect(status).toBe(503)
    expect(datos.codigo).toBe('SERVICIO_NO_DISPONIBLE')
    expect(JSON.stringify(datos)).not.toContain('secreto')
    const actual = await e.leerCuenta(cuenta.id)
    expect(actual).toMatchObject({ enCobro: 0, porPagar: 54_000 })
    expect(actual.lineas[0]?.cantidadCubierta).toBe(0)
    expect(actual.pagos[0]?.estado).toBe('fallido')
  })
})

test('el comprador no sale en lo que ve toda la mesa', async () => {
  const e = crearEscenario()
  const cuenta = await e.pedido([['plato', 1]])
  const comprador = { tipo: 'persona', tipoDocumento: 'CC', documento: '123456', nombre: 'Ana Prueba', correo: 'ana@ribu.test' } as const
  const { datos: pago } = await e.pagar(SALDO, { comprador })
  expect(JSON.stringify(await e.leerCuenta(cuenta.id))).not.toContain('123456')
  expect(JSON.stringify(await e.leerPago(pago.id))).not.toContain('123456')
  expect((await e.leerFactura(pago.id)).comprador).toEqual(comprador)
  expect(FINAL.tipo).toBe('consumidor_final')
})
