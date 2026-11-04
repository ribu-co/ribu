import { describe, expect, test } from 'vitest'
import { ErrorIntegracion } from '../contratos/reglas'
import type { ServicioFacturacion } from '../contratos/tipos'
import { crearEscenario, MESA_1, quien } from './apoyo-pruebas'
import { barrer } from './programado'

type Escenario = ReturnType<typeof crearEscenario>
const SALDO = { tipo: 'saldo' }
const CON_CORREO = { tipo: 'consumidor_final', correo: 'ana@ribu.test' } as const

const conflicto = () => new ErrorIntegracion('Factus respondió 409', 'factus', 'conflicto', 409)
const limite = (segundos: number) => new ErrorIntegracion('Factus respondió 429', 'factus', 'limite', 429, segundos)
const noSeAcepta = () => new ErrorIntegracion('Factus respondió 422', 'factus', 'validacion', 422)

/** Un pago hecho en efectivo, con la factura lista para que la emita el disparador. */
async function pagado(e: Escenario, comprador?: typeof CON_CORREO) {
  await e.pedido([['plato', 1]])
  const { datos } = await e.pagar(SALDO, { medio: 'efectivo', token: quien.mesero(), ...(comprador ? { comprador } : {}) })
  return datos.id as string
}

/** Cambia una operación de la facturación, contando las llamadas. */
function conFacturacion(e: Escenario, cambios: Partial<ServicioFacturacion>) {
  e.ctx.facturacion = { ...e.facturacion, ...cambios }
}

describe('la factura se emite una sola vez', () => {
  test('aunque compitan varios procesos', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    await Promise.all([e.emitirFactura(id), e.emitirFactura(id), e.emitirFactura(id), barrer(e.ctx)])
    expect(e.facturacion.emisiones).toHaveLength(1)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('mientras otro proceso la tiene reservada, nadie llama a Factus', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let soltar: () => void = () => undefined
    let llamadas = 0
    conFacturacion(e, {
      emitirFactura: async (solicitud) => {
        llamadas++
        await new Promise<void>((resolver) => (soltar = resolver))
        return e.facturacion.emitirFactura(solicitud)
      },
    })
    const primero = e.emitirFactura(id)
    await new Promise((resolver) => setTimeout(resolver, 10))
    await e.emitirFactura(id)
    await barrer(e.ctx)
    expect(llamadas).toBe(1)
    soltar()
    await primero
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('si el proceso muere, otro la retoma cuando vence la marca, con la misma referencia', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    conFacturacion(e, { emitirFactura: () => new Promise(() => undefined) })
    void e.emitirFactura(id)
    await new Promise((resolver) => setTimeout(resolver, 10))
    e.ctx.facturacion = e.facturacion
    await barrer(e.ctx)
    expect(e.facturacion.emisiones).toHaveLength(0)
    e.avanzar(200)
    await barrer(e.ctx)
    expect(e.facturacion.emisiones.map((s) => s.referencia)).toEqual([id])
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('una factura emitida no se vuelve a pedir', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    await e.emitirFactura(id)
    await e.emitirFactura(id)
    e.avanzar(600)
    await barrer(e.ctx)
    expect(e.facturacion.emisiones).toHaveLength(1)
  })

  test('reference_code es el id del pago', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    await e.emitirFactura(id)
    expect(e.facturacion.emisiones[0]?.referencia).toBe(id)
    expect(e.facturacion.documentos()[0]?.referencia).toBe(id)
  })
})

describe('en_validacion', () => {
  test('reintenta con la misma referencia y nunca se elimina', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let eliminadas = 0
    conFacturacion(e, { eliminarFactura: async () => void eliminadas++ })
    e.facturacion.escenario = 'en_validacion'
    await e.emitirFactura(id)
    const factura = await e.leerFactura(id)
    expect(factura).toMatchObject({ estado: 'en_validacion', datos: null, intentos: 1 })
    expect(factura.ultimoError).toBeTruthy()

    await barrer(e.ctx)
    expect(e.facturacion.emisiones).toHaveLength(1)
    e.avanzar(61)
    await barrer(e.ctx)
    e.facturacion.escenario = 'emitida'
    e.avanzar(200)
    await barrer(e.ctx)
    expect(e.facturacion.emisiones.map((s) => s.referencia)).toEqual([id, id, id])
    expect(eliminadas).toBe(0)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
    expect((await e.leerPago(id)).estadoFactura).toBe('emitida')
  })
})

describe('rechazada', () => {
  test('se elimina en seguida y espera la corrección del personal', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    e.facturacion.escenario = 'rechazada'
    await e.emitirFactura(id)
    expect(await e.leerFactura(id)).toMatchObject({ estado: 'rechazada', datos: null })
    expect((await e.leerFactura(id)).ultimoError).toContain('Rechazo')
    expect(e.facturacion.documentos()).toEqual([])

    e.avanzar(3600)
    await barrer(e.ctx)
    expect(e.facturacion.emisiones).toHaveLength(1)
    expect((await e.leerReferencia(id)).reintentarEn).toBeNull()
  })

  test('el personal corrige y se reemite con la misma referencia', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    e.facturacion.escenario = 'rechazada'
    await e.emitirFactura(id)
    e.facturacion.escenario = 'emitida'

    const ruta = `/api/mesas/${MESA_1}/pagos/${id}/factura/reintentar`
    const comprador = { tipo: 'empresa', nit: '900123456', razonSocial: 'Empresa de Prueba', correo: 'pagos@ribu.test' }
    expect((await e.pedir('POST', ruta, quien.cliente(), { comprador })).datos.codigo).toBe('SIN_PERMISO')
    const { status, datos } = await e.pedir('POST', ruta, quien.mesero(), { comprador })
    expect(status).toBe(200)
    expect(datos).toMatchObject({ estado: 'en_proceso', comprador, correo: { estado: 'pendiente', destino: 'pagos@ribu.test' } })
    expect((await e.leerPago(id)).estadoFactura).toBe('en_proceso')

    await e.emitirFactura(id)
    expect(e.facturacion.emisiones.at(-1)).toMatchObject({ referencia: id, comprador })
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('solo se reintenta una rechazada, con un comprador válido', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    const ruta = `/api/mesas/${MESA_1}/pagos/${id}/factura/reintentar`
    expect((await e.pedir('POST', ruta, quien.mesero(), { comprador: null })).datos.codigo).toBe('TRANSICION_INVALIDA')
    e.facturacion.escenario = 'rechazada'
    await e.emitirFactura(id)
    const malo = { tipo: 'empresa', nit: 'abc', razonSocial: '', correo: 'x' }
    expect((await e.pedir('POST', ruta, quien.mesero(), { comprador: malo })).datos.codigo).toBe('COMPRADOR_INVALIDO')
    expect((await e.pedir('POST', ruta, quien.mesero(), { comprador: null })).status).toBe(200)
  })

  test('un error desconocido no manda al personal a corregir: se reintenta', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    conFacturacion(e, { emitirFactura: async () => { throw new TypeError('algo raro') } })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('en_proceso')
    expect((await e.leerReferencia(id)).reintentarEn).not.toBeNull()
    expect((await e.leerFactura(id)).ultimoError).not.toContain('raro')
  })

  test('un 422 no deja nada en Factus: no se elimina y espera la corrección', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let eliminadas = 0
    conFacturacion(e, {
      emitirFactura: async () => { throw noSeAcepta() },
      eliminarFactura: async () => void eliminadas++,
    })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('rechazada')
    expect(eliminadas).toBe(0)
  })

  test('si eliminar falla por la red, se insiste y entre tanto no se reemite', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    e.facturacion.escenario = 'rechazada'
    let intentos = 0
    conFacturacion(e, {
      eliminarFactura: async (referencia) => {
        intentos++
        if (intentos === 1) throw new ErrorIntegracion('caído', 'factus', 'red')
        return e.facturacion.eliminarFactura(referencia)
      },
    })
    await e.emitirFactura(id)
    expect((await e.leerReferencia(id)).pendienteEliminar).toBe(true)
    const ruta = `/api/mesas/${MESA_1}/pagos/${id}/factura/reintentar`
    expect((await e.pedir('POST', ruta, quien.mesero(), { comprador: null })).datos.codigo).toBe('TRANSICION_INVALIDA')

    e.avanzar(600)
    await barrer(e.ctx)
    expect(intentos).toBe(2)
    expect((await e.leerReferencia(id)).pendienteEliminar).toBe(false)
    expect(e.facturacion.emisiones).toHaveLength(1)
    expect(e.facturacion.documentos()).toEqual([])
  })

  test('un 404 al eliminar es lo que se buscaba', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    e.facturacion.escenario = 'rechazada'
    conFacturacion(e, { eliminarFactura: async () => { throw new ErrorIntegracion('no existe', 'factus', 'validacion', 404) } })
    await e.emitirFactura(id)
    expect(await e.leerFactura(id)).toMatchObject({ estado: 'rechazada' })
    expect((await e.leerReferencia(id)).pendienteEliminar).toBe(false)
  })
})

describe('un 409 al eliminar significa que ya está validada: no se reintenta en bucle', () => {
  const datos = { numero: 'SETP1', cufe: 'abc', qrUrl: 'https://q', urlPublica: 'https://u' }

  test('se pide otra vez y se guarda la factura validada', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let emisiones = 0
    let eliminaciones = 0
    conFacturacion(e, {
      emitirFactura: async () => (++emisiones === 1 ? { estado: 'rechazada', errores: ['Rechazo'] } : { estado: 'emitida', datos }),
      eliminarFactura: async () => { eliminaciones++; throw conflicto() },
    })
    await e.emitirFactura(id)
    expect(eliminaciones).toBe(1)
    expect(await e.leerFactura(id)).toMatchObject({ estado: 'emitida', datos })
    e.avanzar(3600)
    await barrer(e.ctx)
    expect(eliminaciones).toBe(1)
    expect(emisiones).toBe(2)
  })

  test('si Factus se contradice, queda rechazada y nadie insiste', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let emisiones = 0
    let eliminaciones = 0
    conFacturacion(e, {
      emitirFactura: async () => (emisiones++, { estado: 'rechazada', errores: ['Rechazo'] }),
      eliminarFactura: async () => { eliminaciones++; throw conflicto() },
    })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('rechazada')
    for (let i = 0; i < 5; i++) {
      e.avanzar(3600)
      await barrer(e.ctx)
    }
    expect(eliminaciones).toBe(1)
    expect(emisiones).toBe(2)
    expect((await e.leerReferencia(id)).reintentarEn).toBeNull()
  })

  test('si la DIAN sigue demorada, queda en validación y no se vuelve a eliminar', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let emisiones = 0
    let eliminaciones = 0
    conFacturacion(e, {
      emitirFactura: async () => {
        emisiones++
        if (emisiones === 1) return { estado: 'rechazada', errores: ['Rechazo'] }
        if (emisiones === 2) return { estado: 'en_validacion', detalle: 'demorada' }
        return { estado: 'emitida', datos }
      },
      eliminarFactura: async () => { eliminaciones++; throw conflicto() },
    })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('en_validacion')
    e.avanzar(3600)
    await barrer(e.ctx)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
    expect(eliminaciones).toBe(1)
  })

  test('si la consulta se cae por la red, sigue en proceso y se reintenta sin volver a eliminar', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let emisiones = 0
    let eliminaciones = 0
    conFacturacion(e, {
      emitirFactura: async () => {
        emisiones++
        if (emisiones === 1) return { estado: 'rechazada', errores: ['Rechazo'] }
        if (emisiones === 2) throw new ErrorIntegracion('caído', 'factus', 'red')
        return { estado: 'emitida', datos }
      },
      eliminarFactura: async () => { eliminaciones++; throw conflicto() },
    })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('en_proceso')
    e.avanzar(3600)
    await barrer(e.ctx)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
    expect(eliminaciones).toBe(1)
  })
})

describe('un 409 o un 429 dejan en_proceso', () => {
  test('un 429 respeta esperarSegundos', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let llamadas = 0
    conFacturacion(e, {
      emitirFactura: async (solicitud) => {
        if (++llamadas === 1) throw limite(300)
        return e.facturacion.emitirFactura(solicitud)
      },
    })
    await e.emitirFactura(id)
    expect(await e.leerFactura(id)).toMatchObject({ estado: 'en_proceso', datos: null })
    e.avanzar(299)
    await barrer(e.ctx)
    expect(llamadas).toBe(1)
    e.avanzar(2)
    await barrer(e.ctx)
    expect(llamadas).toBe(2)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('un 409 de otro documento que bloquea el rango se reintenta sin mostrarse como error del cliente', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let llamadas = 0
    conFacturacion(e, {
      emitirFactura: async (solicitud) => {
        if (++llamadas === 1) throw conflicto()
        return e.facturacion.emitirFactura(solicitud)
      },
    })
    await e.emitirFactura(id)
    const factura = await e.leerFactura(id)
    expect(factura.estado).toBe('en_proceso')
    expect(factura.ultimoError).not.toContain('409')
    e.avanzar(61)
    await barrer(e.ctx)
    expect((await e.leerFactura(id)).estado).toBe('emitida')
  })

  test('un 409 con una factura en validación la deja en validación', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    e.facturacion.escenario = 'en_validacion'
    await e.emitirFactura(id)
    conFacturacion(e, { emitirFactura: async () => { throw conflicto() } })
    e.avanzar(61)
    await barrer(e.ctx)
    expect((await e.leerFactura(id)).estado).toBe('en_validacion')
  })

  test('las esperas crecen, para no gastar el límite de 80 por minuto', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    let llamadas = 0
    conFacturacion(e, { emitirFactura: async () => { llamadas++; throw conflicto() } })
    await e.emitirFactura(id)
    for (let i = 0; i < 10; i++) {
      e.avanzar(60)
      await barrer(e.ctx)
    }
    expect(llamadas).toBeGreaterThan(1)
    expect(llamadas).toBeLessThan(6)
  })

  test('credenciales rechazadas no son culpa de los datos: no se manda al personal a corregir', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    conFacturacion(e, {
      emitirFactura: async () => { throw new ErrorIntegracion('Factus respondió 401', 'factus', 'no_autorizado', 401) },
    })
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).estado).toBe('en_proceso')
    expect((await e.leerReferencia(id)).reintentarEn).not.toBeNull()
  })
})

describe('correo', () => {
  test('sale solo al quedar emitida, si el comprador dio uno', async () => {
    const e = crearEscenario()
    const id = await pagado(e, CON_CORREO)
    expect((await e.leerFactura(id)).correo).toMatchObject({ estado: 'pendiente', destino: 'ana@ribu.test' })
    await e.emitirFactura(id)
    const { correo, datos } = await e.leerFactura(id)
    expect(correo).toMatchObject({ estado: 'enviado', destino: 'ana@ribu.test', ultimoError: null })
    expect(correo.enviadoEn).toBeTruthy()
    expect(e.facturacion.correos).toEqual([{ rango: 'factura', numero: datos.numero, correo: 'ana@ribu.test' }])
  })

  test('sin correo no se envía nada', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    await e.emitirFactura(id)
    expect((await e.leerFactura(id)).correo.estado).toBe('sin_correo')
    expect(e.facturacion.correos).toEqual([])
  })

  test('un 422 del sandbox deja el correo fallido y nunca afecta la factura', async () => {
    const e = crearEscenario()
    const id = await pagado(e, CON_CORREO)
    let intentos = 0
    conFacturacion(e, {
      enviarCorreo: async () => {
        intentos++
        throw new ErrorIntegracion('Factus respondió 422: El correo no esta autorizado', 'factus', 'validacion', 422)
      },
    })
    await e.emitirFactura(id)
    const factura = await e.leerFactura(id)
    expect(factura.estado).toBe('emitida')
    expect(factura.datos).not.toBeNull()
    expect(factura.correo.estado).toBe('fallido')
    expect(factura.correo.ultimoError).toContain('422')
    e.avanzar(3600)
    await barrer(e.ctx)
    expect(intentos).toBe(1)
  })

  test('una caída se reintenta en la tarea de cada minuto', async () => {
    const e = crearEscenario()
    const id = await pagado(e, CON_CORREO)
    let intentos = 0
    conFacturacion(e, {
      enviarCorreo: async (numero, correo) => {
        if (++intentos === 1) throw new ErrorIntegracion('caído', 'factus', 'red')
        return e.facturacion.enviarCorreo(numero, correo)
      },
    })
    await e.emitirFactura(id)
    const antes = await e.leerFactura(id)
    expect(antes).toMatchObject({ estado: 'emitida', correo: { estado: 'pendiente' } })
    e.avanzar(120)
    await barrer(e.ctx)
    expect((await e.leerFactura(id)).correo.estado).toBe('enviado')
    expect(e.facturacion.emisiones).toHaveLength(1)
  })

  test('reenviar a otra dirección', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    const ruta = `/api/mesas/${MESA_1}/pagos/${id}/factura/correo`
    expect((await e.pedir('POST', ruta, quien.mesero(), { correo: 'a@ribu.test' })).datos.codigo).toBe('FACTURA_NO_DISPONIBLE')
    await e.emitirFactura(id)
    const { status, datos } = await e.pedir('POST', ruta, quien.mesero(), { correo: 'a@ribu.test' })
    expect(status).toBe(200)
    expect(datos.correo).toMatchObject({ estado: 'enviado', destino: 'a@ribu.test' })
    expect((await e.pedir('POST', ruta, quien.mesero(), { correo: 'no-es-correo' })).datos.codigo).toBe('CUERPO_INVALIDO')
  })

  test('solo quien creó el pago o el personal', async () => {
    const e = crearEscenario()
    await e.pedido([['plato', 1]])
    const { datos: pago } = await e.pagar(SALDO, { token: quien.cliente('duena') })
    e.cobros.marcarPagado(pago.id)
    await e.avisoDePago(pago.id)
    await e.emitirFactura(pago.id)
    const correo = `/api/mesas/${MESA_1}/pagos/${pago.id}/factura/correo`
    const pdf = `/api/mesas/${MESA_1}/pagos/${pago.id}/factura/pdf`
    expect((await e.pedir('POST', correo, quien.cliente('otra'), { correo: 'a@ribu.test' })).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('GET', pdf, quien.cliente('otra'))).datos.codigo).toBe('SIN_PERMISO')
    expect((await e.pedir('POST', correo, quien.cliente('duena'), { correo: 'a@ribu.test' })).status).toBe(200)
    expect((await e.pedir('GET', pdf, quien.cliente('duena'))).status).toBe(200)
    expect((await e.pedir('GET', pdf, quien.mesero())).status).toBe(200)
    expect((await e.pedir('GET', pdf, quien.mesero('rest-2'))).datos.codigo).toBe('SIN_PERMISO')
  })
})

describe('pdf', () => {
  test('sin emitir no hay PDF', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    const { datos } = await e.pedir('GET', `/api/mesas/${MESA_1}/pagos/${id}/factura/pdf`, quien.mesero())
    expect(datos.codigo).toBe('FACTURA_NO_DISPONIBLE')
  })

  test('llega como PDF binario, sin el base64', async () => {
    const e = crearEscenario()
    const id = await pagado(e)
    await e.emitirFactura(id)
    const { status, datos, cabeceras } = await e.pedir<ArrayBuffer>('GET', `/api/mesas/${MESA_1}/pagos/${id}/factura/pdf`, quien.mesero())
    expect(status).toBe(200)
    expect(cabeceras.get('content-disposition')).toMatch(/attachment; filename="SETP\d+\.pdf"/)
    expect(new TextDecoder().decode(datos).startsWith('%PDF-')).toBe(true)
  })
})
