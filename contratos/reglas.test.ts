import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  baseSinImpuesto,
  calcularPropina,
  calcularTotales,
  CODIGO_CORRECCION_NOTA_CREDITO,
  CODIGO_CORRECCION_NOTA_DEBITO,
  ErrorIntegracion,
  lineaSuma,
  MONTO_MAXIMO_COBRO,
  MONTO_MINIMO_COBRO,
  propinaValida,
  puedeLiberarMesa,
  puedePasar,
  repartirPartesIguales,
  rutas,
  saldoAcreditable,
  TRANSICIONES_CUENTA,
  TRANSICIONES_FACTURA,
  TRANSICIONES_LINEA,
  TRANSICIONES_PAGO,
  unidadesPorCubrir,
} from './reglas'
import {
  CODIGOS_ERROR,
  CONCEPTOS_NOTA_CREDITO,
  CONCEPTOS_NOTA_DEBITO,
  ESTADOS_COBRO,
  ESTADOS_CORREO,
  ESTADOS_CUENTA,
  ESTADOS_DEVOLUCION,
  ESTADOS_FACTURA,
  ESTADOS_LINEA,
  ESTADOS_MESA,
  ESTADOS_PAGO,
  INCIDENCIAS_PAGO,
  MEDIOS_PAGO,
  ORIGENES_LINEA,
  ROLES,
  ROLES_PERSONAL,
  TIPOS_DOCUMENTO,
  TIPOS_IMPUESTO,
  TIPOS_NOTA,
  type Impuesto,
  type LineaPedido,
  type ResumenNota,
  type ResumenPago,
} from './tipos'

const INC: Impuesto = { tipo: 'INC', porcentaje: 8 }
const SIN_IMPUESTO: Impuesto = { tipo: 'ninguno', porcentaje: 0 }

function linea(cambios: Partial<LineaPedido> = {}): LineaPedido {
  return {
    id: 'L-1',
    productoId: 'P-1',
    nombre: 'Bandeja',
    precio: 20_000,
    cantidad: 1,
    nota: null,
    ronda: 1,
    estado: 'confirmada',
    origen: 'cliente',
    motivo: null,
    cantidadCubierta: 0,
    creadaEn: '2026-11-04T15:00:00Z',
    ...cambios,
  }
}

function pago(cambios: Partial<ResumenPago> = {}): ResumenPago {
  return {
    id: 'P-1',
    numero: 1,
    parte: null,
    subtotal: 20_000,
    total: 20_000,
    medio: 'factus_pay',
    estado: 'pagado',
    estadoFactura: 'emitida',
    incidencia: null,
    creadoPor: 'uid-1',
    ...cambios,
  }
}

test('la base sin impuesto sale del precio de carta', () => {
  expect(baseSinImpuesto(25_000, INC)).toBe(23_148.15)
  expect(baseSinImpuesto(25_000, SIN_IMPUESTO)).toBe(25_000)
})

test('la propina se calcula sin impuesto y queda en pesos enteros', () => {
  expect(calcularPropina(25_000, INC, 10)).toBe(2_315)
  expect(calcularPropina(25_000, INC, 0)).toBe(0)
})

test('la propina es un porcentaje entero de 0 a 100', () => {
  for (const valido of [0, 7, 10, 100]) expect(propinaValida(valido)).toBe(true)
  for (const invalido of [-1, 7.5, 101, Number.NaN]) expect(propinaValida(invalido)).toBe(false)
})

test('las partes iguales suman el total y difieren en máximo un peso', () => {
  const partes = repartirPartesIguales(100_000, 3)
  expect(partes).toEqual([33_334, 33_333, 33_333])
  expect(partes.reduce((suma, parte) => suma + parte, 0)).toBe(100_000)
})

test('la cuenta se divide entre 2 y 20 partes', () => {
  for (const partes of [1, 21, 2.5]) expect(() => repartirPartesIguales(100_000, partes)).toThrow(RangeError)
})

test('solo cuenta lo confirmado por el mesero', () => {
  expect(ESTADOS_LINEA.filter(lineaSuma)).toEqual(['confirmada', 'en_preparacion', 'lista', 'entregada'])
  const { consumo } = calcularTotales(
    [
      linea({ cantidad: 2 }),
      linea({ estado: 'pendiente' }),
      linea({ estado: 'rechazada' }),
      linea({ estado: 'anulada' }),
    ],
    [],
  )
  expect(consumo).toBe(40_000)
})

test('una línea pendiente no se puede pagar', () => {
  expect(unidadesPorCubrir(linea({ estado: 'pendiente', cantidad: 3 }))).toBe(0)
  expect(unidadesPorCubrir(linea({ cantidad: 3, cantidadCubierta: 1 }))).toBe(2)
})

test('los totales separan lo pagado, lo que está en cobro y lo que falta', () => {
  const totales = calcularTotales(
    [linea({ cantidad: 5 })],
    [
      pago(),
      pago({ id: 'P-2', estado: 'esperando_pago', subtotal: 30_000 }),
      pago({ id: 'P-3', estado: 'vencido' }),
      pago({ id: 'P-4', incidencia: 'pago_duplicado' }),
    ],
  )
  expect(totales).toEqual({ consumo: 100_000, pagado: 20_000, enCobro: 30_000, porPagar: 50_000 })
})

test('una mesa se libera sin pendientes, cobros activos ni saldo', () => {
  const pagada = { lineas: [linea()], enCobro: 0, porPagar: 0 }
  expect(puedeLiberarMesa(pagada)).toBe(true)
  expect(puedeLiberarMesa({ lineas: [linea({ estado: 'rechazada' })], enCobro: 0, porPagar: 0 })).toBe(true)
  expect(puedeLiberarMesa({ ...pagada, porPagar: 1_000 })).toBe(false)
  expect(puedeLiberarMesa({ ...pagada, enCobro: 1_000 })).toBe(false)
  expect(puedeLiberarMesa({ ...pagada, lineas: [linea({ estado: 'pendiente' })] })).toBe(false)
})

test('el pedido del cliente pasa por el mesero antes de la cocina', () => {
  expect(puedePasar(TRANSICIONES_LINEA, 'pendiente', 'confirmada')).toBe(true)
  expect(puedePasar(TRANSICIONES_LINEA, 'pendiente', 'en_preparacion')).toBe(false)
  expect(TRANSICIONES_LINEA.rechazada).toEqual([])
})

test('si piden algo más después de pagar, la cuenta se abre de nuevo', () => {
  expect(puedePasar(TRANSICIONES_CUENTA, 'pagada', 'abierta')).toBe(true)
  expect(TRANSICIONES_CUENTA.cerrada).toEqual([])
})

test('un pago que ya no estaba activo todavía puede terminar pagado', () => {
  for (const estado of ['vencido', 'cancelado', 'fallido'] as const) {
    expect(puedePasar(TRANSICIONES_PAGO, estado, 'pagado')).toBe(true)
  }
  expect(TRANSICIONES_PAGO.pagado).toEqual([])
})

test('una factura solo se corrige si la DIAN la rechazó', () => {
  expect(puedePasar(TRANSICIONES_FACTURA, 'rechazada', 'en_proceso')).toBe(true)
  expect(puedePasar(TRANSICIONES_FACTURA, 'en_validacion', 'en_proceso')).toBe(false)
  expect(TRANSICIONES_FACTURA.emitida).toEqual([])
})

test('los errores de red, límite, conflicto y servidor se reintentan', () => {
  const error = (tipo: ErrorIntegracion['tipo']) => new ErrorIntegracion('falló', 'factus', tipo)
  for (const tipo of ['red', 'limite', 'conflicto', 'servidor'] as const) {
    expect(error(tipo).reintentable).toBe(true)
  }
  for (const tipo of ['no_autorizado', 'validacion'] as const) {
    expect(error(tipo).reintentable).toBe(false)
  }
})

test('las rutas de Firestore cuelgan del restaurante', () => {
  expect(rutas.paginaMesa('abc')).toBe('/m/abc')
  expect(rutas.facturas('r-1')).toBe('restaurantes/r-1/facturas')
  expect(rutas.notas('r-1')).toBe('restaurantes/r-1/notas')
  expect(rutas.personal('r-1')).toBe('restaurantes/r-1/personal')
})

test('los límites de cobro son los que acepta el sandbox de Factus Pay', () => {
  expect(MONTO_MINIMO_COBRO).toBe(10_000)
  expect(MONTO_MAXIMO_COBRO).toBe(12_000_000)
})

test('los conceptos de las notas usan los códigos de corrección de Factus', () => {
  expect(CODIGO_CORRECCION_NOTA_CREDITO.anulacion).toBe('2')
  expect(CODIGO_CORRECCION_NOTA_CREDITO.devolucion_parcial).toBe('1')
  expect(CODIGO_CORRECCION_NOTA_DEBITO.otros).toBe('4')
})

test('una factura no se puede acreditar por más de su valor', () => {
  const nota = (cambios: Partial<ResumenNota>): ResumenNota => ({
    id: 'N-1',
    tipo: 'credito',
    numero: null,
    total: 10_000,
    estado: 'emitida',
    ...cambios,
  })
  expect(saldoAcreditable(100_000, [])).toBe(100_000)
  expect(
    saldoAcreditable(100_000, [
      nota({ total: 30_000 }),
      nota({ total: 10_000, estado: 'rechazada' }),
      nota({ total: 5_000, tipo: 'debito' }),
      nota({ total: 7_000, tipo: 'debito', estado: 'sin_emitir' }),
    ]),
  ).toBe(75_000)
  expect(saldoAcreditable(100_000, [nota({ total: 120_000 })])).toBe(0)
})

const openapi = readFileSync(new URL('./openapi.yaml', import.meta.url), 'utf8')

const listaYaml = (texto: string) =>
  texto
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean)

test.each(
  Object.entries({
    TipoImpuesto: TIPOS_IMPUESTO,
    EstadoMesa: ESTADOS_MESA,
    EstadoLinea: ESTADOS_LINEA,
    OrigenLinea: ORIGENES_LINEA,
    EstadoCuenta: ESTADOS_CUENTA,
    MedioPago: MEDIOS_PAGO,
    EstadoPago: ESTADOS_PAGO,
    IncidenciaPago: INCIDENCIAS_PAGO,
    EstadoCobro: ESTADOS_COBRO,
    TipoDocumento: TIPOS_DOCUMENTO,
    EstadoFactura: ESTADOS_FACTURA,
    EstadoCorreo: ESTADOS_CORREO,
    TipoNota: TIPOS_NOTA,
    ConceptoNotaCredito: CONCEPTOS_NOTA_CREDITO,
    ConceptoNotaDebito: CONCEPTOS_NOTA_DEBITO,
    EstadoDevolucion: ESTADOS_DEVOLUCION,
    RolPersonal: ROLES_PERSONAL,
    CodigoError: CODIGOS_ERROR,
  }),
)('%s es igual en openapi.yaml y en tipos.ts', (esquema, valores) => {
  const encontrado = openapi.match(new RegExp(`^ {4}${esquema}: \\{ type: string, enum: \\[([^\\]]*)\\] \\}$`, 'm'))
  expect(encontrado, `falta ${esquema}`).not.toBeNull()
  expect(listaYaml(encontrado![1])).toEqual([...valores])
})

test('cada referencia de openapi.yaml existe', () => {
  const nombres = [...openapi.matchAll(/#\/components\/(?:schemas|parameters|responses)\/(\w+)/g)].map((m) => m[1])
  expect(nombres.length).toBeGreaterThan(0)
  for (const nombre of new Set(nombres)) {
    expect(openapi, `falta ${nombre}`).toMatch(new RegExp(`^ {4}${nombre}:`, 'm'))
  }
})

test('cada operación dice quién la llama y qué errores propios responde', () => {
  const operaciones = openapi.match(/^ {4}(?:get|post|put|patch|delete):$/gm) ?? []
  expect(operaciones.length).toBeGreaterThan(0)
  expect(openapi.match(/^ {6}operationId: /gm)).toHaveLength(operaciones.length)
  expect(openapi.match(/^ {6}x-roles: /gm)).toHaveLength(operaciones.length)
  expect(openapi.match(/^ {6}x-errores:/gm)).toHaveLength(operaciones.length)

  for (const [, roles] of openapi.matchAll(/^ {6}x-roles: \[([^\]]*)\]$/gm)) {
    for (const rol of listaYaml(roles)) expect(ROLES).toContain(rol)
  }
  const enLinea = [...openapi.matchAll(/^ {6}x-errores: \[([^\]]*)\]$/gm)].flatMap((m) => listaYaml(m[1]))
  const enBloque = [...openapi.matchAll(/^ {6}x-errores:\n((?: {8}- \w+\n)+)/gm)].flatMap((m) =>
    [...m[1].matchAll(/- (\w+)/g)].map((item) => item[1]),
  )
  expect(enBloque.length).toBeGreaterThan(0)
  for (const codigo of [...enLinea, ...enBloque]) expect(CODIGOS_ERROR).toContain(codigo)
})
