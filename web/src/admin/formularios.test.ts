import { describe, expect, test } from 'vitest'
import type { Comprador, Personal, Producto, ResumenNota } from '../../../contratos/tipos'
import { ErrorDatos } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { CLAVE_DEMO } from '../datos/semilla'
import {
  cambiosDeProducto,
  datosDeComprador,
  enviarPersonal,
  formularioDeProducto,
  leerEntero,
  leerNota,
  leerPersonal,
  leerProducto,
  LINEA_VACIA,
  puedeAnular,
  solicitudReintento,
  type FormularioNota,
  type FormularioProducto,
} from './formularios'
import { ordenarPersonal } from './personal'

const producto: Producto = {
  id: 'agua',
  restauranteId: 'r',
  nombre: 'Agua',
  descripcion: null,
  categoria: 'Bebidas',
  precio: 4_050,
  stock: 10,
  disponible: true,
  imagenUrl: null,
}

test('el precio se puede escribir con puntos o con signo', () => {
  expect(leerEntero('32.400')).toBe(32_400)
  expect(leerEntero(' $ 32 400 ')).toBe(32_400)
  expect(leerEntero('32,5')).toBeNull()
  expect(leerEntero('')).toBeNull()
  expect(leerEntero('-4')).toBeNull()
})

describe('producto', () => {
  const formulario = (f: Partial<FormularioProducto>): FormularioProducto => ({ ...formularioDeProducto(producto), ...f })

  test('dice qué falta', () => {
    expect(leerProducto(formulario({ nombre: ' ', categoria: '', precio: '0', stock: 'x' }))).toEqual({
      errores: { nombre: expect.any(String), categoria: expect.any(String), precio: expect.any(String), stock: expect.any(String) },
    })
  })

  test('sin conteo el stock es null, y con stock en 0 queda agotado', () => {
    expect(leerProducto(formulario({ llevaStock: false, stock: '' }))).toMatchObject({ valor: { stock: null, disponible: true } })
    expect(leerProducto(formulario({ stock: '0', disponible: true }))).toMatchObject({ valor: { stock: 0, disponible: false } })
  })

  test('al editar solo envía lo que cambió: no pisa el stock que bajó mientras tanto', () => {
    const leido = leerProducto(formulario({ precio: '5.000' }))
    if ('errores' in leido) throw new Error('Debía ser válido')
    expect(cambiosDeProducto(producto, leido.valor)).toEqual({ precio: 5_000 })
  })

  test('lo que produce el formulario lo acepta la fuente en memoria', async () => {
    const fuente = crearFuenteMemoria()
    await fuente.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
    const leido = leerProducto({ ...formularioDeProducto(), nombre: 'Café', categoria: 'Bebidas', precio: '3.500', llevaStock: true, stock: '0' })
    if ('errores' in leido) throw new Error('Debía ser válido')
    const creado = await fuente.crearProducto(leido.valor)
    expect(creado).toMatchObject({ nombre: 'Café', precio: 3_500, stock: 0, disponible: false, restauranteId: 'fogon-del-manglar' })
    const cambiado = await fuente.actualizarProducto(creado.id, { stock: 4, disponible: true })
    expect(cambiado).toMatchObject({ stock: 4, disponible: true })
    await fuente.borrarProducto(creado.id)
    expect(fuente.estado().productos[creado.id]).toBeUndefined()
  })
})

describe('personal', () => {
  const valido = { correo: ' Nuevo@Ribu.Demo ', nombre: ' Ana ', rol: 'cocina', clave: '12345678' } as const

  test('valida correo, nombre y la clave mínima del contrato', () => {
    expect(leerPersonal({ correo: 'x', nombre: '', rol: 'mesero', clave: '1234567' })).toEqual({
      errores: { correo: expect.any(String), nombre: expect.any(String), clave: expect.any(String) },
    })
    expect(leerPersonal(valido)).toEqual({ valor: { correo: 'nuevo@ribu.demo', nombre: 'Ana', rol: 'cocina', clave: '12345678' } })
  })

  test('CORREO_EN_USO se distingue de los demás errores', async () => {
    const fallar = (codigo: ErrorDatos['codigo']) => ({
      crearPersonal: async () => {
        throw new ErrorDatos(codigo)
      },
    })
    expect(await enviarPersonal(fallar('CORREO_EN_USO'), 'r', valido)).toEqual({ estado: 'correo_en_uso' })
    expect(await enviarPersonal(fallar('SIN_PERMISO'), 'r', valido)).toMatchObject({ estado: 'error' })
  })

  test('no llama al backend si el formulario está mal, y envía limpio si está bien', async () => {
    const enviados: unknown[] = []
    const operaciones = {
      crearPersonal: async (restauranteId: string, personal: unknown) => {
        enviados.push([restauranteId, personal])
        return {} as Personal
      },
    }
    expect((await enviarPersonal(operaciones, 'r', { ...valido, clave: 'corta' })).estado).toBe('invalido')
    expect(enviados).toEqual([])
    expect(await enviarPersonal(operaciones, 'r', valido)).toEqual({ estado: 'creado' })
    expect(enviados).toEqual([['r', { correo: 'nuevo@ribu.demo', nombre: 'Ana', rol: 'cocina', clave: '12345678' }]])
  })

  test('contra la fuente en memoria: crea, avisa CORREO_EN_USO y desactiva', async () => {
    const fuente = crearFuenteMemoria()
    await fuente.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
    expect(await enviarPersonal(fuente, 'fogon-del-manglar', valido)).toEqual({ estado: 'creado' })
    expect(await enviarPersonal(fuente, 'fogon-del-manglar', valido)).toEqual({ estado: 'correo_en_uso' })
    expect(await enviarPersonal(fuente, 'fogon-del-manglar', { ...valido, correo: 'admin@ribu.demo' })).toEqual({ estado: 'correo_en_uso' })
    const nueva = fuente.estado().personal.find((p) => p.correo === 'nuevo@ribu.demo')
    const desactivada = await fuente.actualizarPersonal('fogon-del-manglar', nueva!.uid, { activo: false })
    expect(desactivada.activo).toBe(false)
  })

  test('primero los activos, por nombre', () => {
    const persona = (nombre: string, activo: boolean) => ({ nombre, activo }) as Personal
    expect(ordenarPersonal([persona('Zoe', true), persona('Ana', false), persona('Luz', true)]).map((p) => p.nombre)).toEqual(['Luz', 'Zoe', 'Ana'])
  })
})

describe('corregir el comprador', () => {
  const empresa: Comprador = { tipo: 'empresa', nit: '900123456', razonSocial: 'Manglar SAS', correo: 'a@b.co' }

  test('sin cambios envía null', () => {
    expect(solicitudReintento(empresa, 'empresa', datosDeComprador(empresa))).toEqual({ comprador: null })
    const final: Comprador = { tipo: 'consumidor_final', correo: null }
    expect(solicitudReintento(final, 'consumidor_final', datosDeComprador(final))).toEqual({ comprador: null })
  })

  test('con cambios envía el comprador corregido', () => {
    expect(solicitudReintento(empresa, 'empresa', { ...datosDeComprador(empresa), nit: '900555111' })).toEqual({
      comprador: { tipo: 'empresa', nit: '900555111', razonSocial: 'Manglar SAS', correo: 'a@b.co' },
    })
  })

  test('datos inválidos no producen orden', () => {
    expect(solicitudReintento(empresa, 'empresa', { ...datosDeComprador(empresa), nit: '12' })).toBeNull()
  })
})

describe('notas', () => {
  const contexto = (notas: ResumenNota[] = []) => ({ totalPago: 50_000, notas })
  const resumen = (tipo: ResumenNota['tipo'], total: number, estado: ResumenNota['estado'] = 'emitida'): ResumenNota => ({ id: 'n', tipo, numero: null, total, estado })
  const base: FormularioNota = { tipo: 'credito', concepto: 'rebaja', motivo: 'Cortesía', lineas: [{ descripcion: 'Rebaja', cantidad: '1', precio: '10.000' }], medio: 'efectivo' }

  test('la anulación copia la factura y no lleva líneas', () => {
    expect(leerNota({ ...base, concepto: 'anulacion', lineas: [LINEA_VACIA] }, contexto())).toEqual({
      solicitud: { tipo: 'credito', concepto: 'anulacion', motivo: 'Cortesía' },
      total: 50_000,
    })
  })

  test('no se puede anular lo que ya se acreditó en parte', () => {
    const conRebaja = contexto([resumen('credito', 10_000)])
    expect(puedeAnular(conRebaja)).toBe(false)
    expect(leerNota({ ...base, concepto: 'anulacion' }, conRebaja)).toMatchObject({ error: expect.stringContaining('$40.000') })
    // Una nota rechazada no cuenta contra el saldo.
    expect(puedeAnular(contexto([resumen('credito', 10_000, 'rechazada')]))).toBe(true)
  })

  test('respeta saldoAcreditable: una débito emitida lo sube y una en camino no', () => {
    const sobra = { ...base, lineas: [{ descripcion: 'x', cantidad: '1', precio: '60000' }] }
    expect(leerNota(sobra, contexto())).toMatchObject({ error: expect.stringContaining('$50.000'), total: 60_000 })
    expect(leerNota(sobra, contexto([resumen('debito', 10_000)]))).toMatchObject({ solicitud: { tipo: 'credito' }, total: 60_000 })
    expect(leerNota(sobra, contexto([resumen('debito', 10_000, 'sin_emitir')]))).toHaveProperty('error')
  })

  test('el total multiplica cantidad por precio y exige el motivo', () => {
    const dos = { ...base, motivo: ' ', lineas: [{ descripcion: 'Agua', cantidad: '3', precio: '4.050' }] }
    expect(leerNota(dos, contexto())).toEqual({ error: 'Escribe el motivo de la nota.', total: 12_150 })
    expect(leerNota({ ...base, lineas: [LINEA_VACIA] }, contexto())).toMatchObject({ total: null })
  })

  test('una débito con Factus Pay respeta el rango del cobro; con efectivo no aplica', () => {
    const debito: FormularioNota = { ...base, tipo: 'debito', concepto: 'otros', medio: 'factus_pay', lineas: [{ descripcion: 'Domicilio', cantidad: '1', precio: '5.000' }] }
    expect(leerNota(debito, contexto())).toHaveProperty('error')
    expect(leerNota({ ...debito, medio: 'efectivo' }, contexto())).toMatchObject({ solicitud: { tipo: 'debito', medio: 'efectivo' }, total: 5_000 })
    expect(leerNota({ ...debito, lineas: [{ descripcion: 'Domicilio', cantidad: '1', precio: '10.000' }] }, contexto())).toMatchObject({ solicitud: { medio: 'factus_pay' } })
  })

  test('la fuente en memoria acepta lo que produce el formulario y rechaza lo que excede', async () => {
    const fuente = crearFuenteMemoria({ programar: (tarea) => tarea(), dibujarQr: async () => 'qr' })
    await fuente.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
    await fuente.agregarLineas('demo-mesa-1', { items: [{ productoId: 'posta-negra', cantidad: 1, nota: null }] })
    const pago = await fuente.crearPago('demo-mesa-1', { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: { tipo: 'consumidor_final', correo: null }, medio: 'efectivo' })
    const ctx = { totalPago: pago.total, notas: [] }
    const leida = leerNota({ ...base, lineas: [{ descripcion: 'Rebaja', cantidad: '1', precio: '10.000' }] }, ctx)
    if (!('solicitud' in leida)) throw new Error(leida.error)
    const nota = await fuente.crearNota(pago.id, leida.solicitud)
    expect(nota).toMatchObject({ tipo: 'credito', total: 10_000, devolucion: 'pendiente', estado: 'emitida' })
    await expect(fuente.crearNota(pago.id, { tipo: 'credito', concepto: 'anulacion', motivo: 'x' })).rejects.toMatchObject({ codigo: 'NOTA_EXCEDE_FACTURA' })
    // Los PDF que ofrece la pantalla: la factura se pide con la mesa del pago, la nota con su id.
    expect((await fuente.descargarFacturaPdf(pago.mesaToken, pago.id)).type).toBe('application/pdf')
    expect((await fuente.descargarNotaPdf(nota.id)).type).toBe('application/pdf')
  })
})
