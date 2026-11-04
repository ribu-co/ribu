import { expect, test } from 'vitest'
import { ErrorIntegracion, MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO } from '../contratos/reglas'
import { ESTADOS_COBRO } from '../contratos/tipos'
import {
  crearCobrosMock,
  LLAVE_WEBHOOK_DE_EJEMPLO,
  PAGADOR_DE_EJEMPLO,
  QR_DE_EJEMPLO,
} from './mock'

const RELOJ = new Date('2026-11-04T15:00:00.000Z')
const nuevo = () => crearCobrosMock({ ahora: () => RELOJ })
const solicitud = { referencia: 'pago-1', monto: 25_000, expiraEnSegundos: 600 }

test('crearCobro devuelve un recaudo listo, con QR y llave Bre-B', async () => {
  const cobro = await nuevo().crearCobro(solicitud)
  expect(cobro).toEqual({
    referencia: 'pago-1',
    monto: 25_000,
    estado: 'ready',
    qrBase64: QR_DE_EJEMPLO,
    llaveBreB: '@RIBUMOCK0001',
    qrExpiraEn: '2026-11-04T15:10:00.000Z',
    recaudadoEn: null,
  })
  expect(ESTADOS_COBRO).toContain(cobro.estado)
})

test('el QR no lleva el prefijo data: y la llave Bre-B empieza con arroba', async () => {
  const cobro = await nuevo().crearCobro(solicitud)
  expect(cobro.qrBase64).not.toMatch(/^data:/)
  expect(cobro.llaveBreB).toMatch(/^@/)
})

test('cada recaudo nuevo recibe su propia llave', async () => {
  const cobros = nuevo()
  const uno = await cobros.crearCobro(solicitud)
  const otro = await cobros.crearCobro({ ...solicitud, referencia: 'pago-2' })
  expect(otro.llaveBreB).not.toBe(uno.llaveBreB)
})

test('consultarCobro devuelve lo que se creó', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  expect(await cobros.consultarCobro('pago-1')).toMatchObject({ referencia: 'pago-1', estado: 'ready' })
})

test('consultarCobro de una referencia que no existe falla como 404', async () => {
  await expect(nuevo().consultarCobro('no-existe')).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    servicio: 'factus_pay',
    tipo: 'validacion',
    status: 404,
  })
})

test('marcarPagado completa el camino: paid, fecha de recaudo y pagador en el webhook', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  const pagado = cobros.marcarPagado('pago-1')

  expect(pagado.estado).toBe('paid')
  expect(pagado.recaudadoEn).toBe('2026-11-04T15:00:00.000Z')
  expect(await cobros.consultarCobro('pago-1')).toEqual(pagado)
  expect(cobros.leerWebhook(LLAVE_WEBHOOK_DE_EJEMPLO, cobros.cuerpoWebhook('pago-1'))).toEqual({
    referencia: 'pago-1',
    monto: 25_000,
    recaudadoEn: '2026-11-04T15:00:00.000Z',
    pagador: PAGADOR_DE_EJEMPLO,
  })
})

test('marcarPagado sin pagador deja el webhook sin `payer`', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  cobros.marcarPagado('pago-1', null)
  const cuerpo = cobros.cuerpoWebhook('pago-1') as { data: Record<string, unknown> }
  expect(cuerpo.data.payer).toBeUndefined()
  expect(cobros.leerWebhook(LLAVE_WEBHOOK_DE_EJEMPLO, cuerpo).pagador).toBeNull()
})

test('marcarEstado sirve para los caminos de error', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  expect(cobros.marcarEstado('pago-1', 'rejected').estado).toBe('rejected')
  expect((await cobros.consultarCobro('pago-1')).recaudadoEn).toBeNull()
})

test('vencerQr solo cambia la fecha: un QR vencido sigue en ready', async () => {
  const cobros = nuevo()
  const antes = await cobros.crearCobro(solicitud)
  const vencido = cobros.vencerQr('pago-1')
  expect(Date.parse(vencido.qrExpiraEn!)).toBeLessThan(RELOJ.getTime())
  expect(vencido).toEqual({ ...antes, qrExpiraEn: vencido.qrExpiraEn })
  // Probado en el sandbox: el vencimiento se mira con qrExpiraEn, no con el estado.
  expect((await cobros.consultarCobro('pago-1')).estado).toBe('ready')
})

test('repetir la referencia y el monto con el QR vigente devuelve el mismo recaudo', async () => {
  const cobros = nuevo()
  const primero = await cobros.crearCobro(solicitud)
  // Aunque pidan otra expiración: Factus Pay responde "Recaudo ya existente" y no toca el QR.
  expect(await cobros.crearCobro({ ...solicitud, expiraEnSegundos: 3600 })).toEqual(primero)
})

test('repetir la referencia y el monto con el QR vencido lo renueva y conserva la llave', async () => {
  const cobros = nuevo()
  const primero = await cobros.crearCobro(solicitud)
  cobros.vencerQr('pago-1')
  const renovado = await cobros.crearCobro({ ...solicitud, expiraEnSegundos: 300 })
  expect(renovado.qrExpiraEn).toBe('2026-11-04T15:05:00.000Z')
  expect(renovado.llaveBreB).toBe(primero.llaveBreB)
  expect(renovado.estado).toBe('ready')
})

test('un QR que vence justo ahora ya se renueva', async () => {
  let ahora = new Date(RELOJ)
  const cobros = crearCobrosMock({ ahora: () => ahora })
  await cobros.crearCobro(solicitud)
  ahora = new Date(RELOJ.getTime() + 600 * 1000)
  const renovado = await cobros.crearCobro({ ...solicitud, expiraEnSegundos: 600 })
  expect(renovado.qrExpiraEn).toBe('2026-11-04T15:20:00.000Z')
})

test('un recaudo pagado no se renueva', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  cobros.marcarPagado('pago-1')
  expect(await cobros.crearCobro(solicitud)).toMatchObject({ estado: 'paid' })
})

test('repetir la referencia con otro monto responde 422, como el sandbox', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  await expect(cobros.crearCobro({ ...solicitud, monto: 30_000 })).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    tipo: 'validacion',
    status: 422,
    message: 'La referencia ya existe con un monto diferente.',
  })
})

test('el rango de montos es el que se probó en el sandbox: 10.000 a 12.000.000', () => {
  expect([MONTO_MINIMO_COBRO, MONTO_MAXIMO_COBRO]).toEqual([10_000, 12_000_000])
})

test.each([
  ['monto por debajo del mínimo', { monto: MONTO_MINIMO_COBRO - 1 }],
  ['monto por encima del máximo', { monto: MONTO_MAXIMO_COBRO + 1 }],
  ['monto con decimales', { monto: 25_000.5 }],
  ['referencia vacía', { referencia: '' }],
  ['referencia de más de 100 caracteres', { referencia: 'x'.repeat(101) }],
  ['expiración en cero', { expiraEnSegundos: 0 }],
])('crearCobro rechaza %s', async (_caso, cambio) => {
  await expect(nuevo().crearCobro({ ...solicitud, ...cambio })).rejects.toMatchObject({
    name: 'ErrorIntegracion',
    tipo: 'validacion',
    status: 422,
  })
})

test('una referencia de 100 caracteres sí se acepta', async () => {
  const referencia = 'x'.repeat(100)
  expect(await nuevo().crearCobro({ ...solicitud, referencia })).toMatchObject({ referencia })
})

test('leerWebhook con la llave errada lanza no_autorizado', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  const cuerpo = cobros.cuerpoWebhook('pago-1')
  for (const clave of [null, '', 'otra-llave', `${LLAVE_WEBHOOK_DE_EJEMPLO} `]) {
    expect(() => cobros.leerWebhook(clave, cuerpo)).toThrowError(
      expect.objectContaining({ name: 'ErrorIntegracion', tipo: 'no_autorizado' }),
    )
  }
})

test('leerWebhook sin `data.reference_code` lanza validacion', () => {
  const cobros = nuevo()
  for (const cuerpo of [null, {}, { data: {} }, { data: { reference_code: 7 } }]) {
    expect(() => cobros.leerWebhook(LLAVE_WEBHOOK_DE_EJEMPLO, cuerpo)).toThrowError(
      expect.objectContaining({ tipo: 'validacion' }),
    )
  }
})

test('la llave del webhook se puede cambiar al crear el mock', async () => {
  const cobros = crearCobrosMock({ ahora: () => RELOJ, llaveWebhook: 'otra' })
  await cobros.crearCobro(solicitud)
  expect(cobros.leerWebhook('otra', cobros.cuerpoWebhook('pago-1')).referencia).toBe('pago-1')
})

test('limpiar olvida los recaudos', async () => {
  const cobros = nuevo()
  await cobros.crearCobro(solicitud)
  cobros.limpiar()
  await expect(cobros.consultarCobro('pago-1')).rejects.toBeInstanceOf(ErrorIntegracion)
})
