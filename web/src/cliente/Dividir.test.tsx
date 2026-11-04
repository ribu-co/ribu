import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { Cuenta, LineaPedido, ResumenPago } from '../../../contratos/tipos'
import { ProveedorDatos } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { ProveedorAvisos } from '../ui/Avisos'
import { divisionTerminada, itemsEleccion, lineasPorElegir, partesDeDivision, partesMaximas, subtotalEleccion, vistaPreviaPartes } from './cuenta'
import { OpcionesPago } from './Dividir'

const yo: Sesion = { uid: 'anonimo-yo', rol: 'cliente', restauranteId: null, nombre: null }

const linea = (l: Partial<LineaPedido>): LineaPedido => ({
  id: 'l',
  productoId: 'p',
  nombre: 'Mojarra frita',
  precio: 32_400,
  cantidad: 1,
  nota: null,
  ronda: 1,
  estado: 'confirmada',
  origen: 'cliente',
  motivo: null,
  cantidadCubierta: 0,
  creadaEn: '',
  ...l,
})

const pago = (p: Partial<ResumenPago>): ResumenPago => ({
  id: 'p1',
  numero: 1,
  parte: 1,
  subtotal: 45_900,
  total: 45_900,
  medio: 'factus_pay',
  estado: 'esperando_pago',
  estadoFactura: 'sin_emitir',
  incidencia: null,
  creadoPor: yo.uid,
  ...p,
})

const cuenta = (c: Partial<Cuenta>): Cuenta => ({
  id: 'c1',
  restauranteId: 'fogon-del-manglar',
  mesaToken: 'demo-mesa-3',
  numeroMesa: 3,
  estado: 'abierta',
  lineas: [
    linea({ id: 'mojarra', cantidad: 2 }),
    linea({ id: 'jugo', nombre: 'Jugo de corozo', precio: 8_100, cantidad: 2, cantidadCubierta: 1 }),
    linea({ id: 'patacon', nombre: 'Patacón', precio: 10_800, estado: 'pendiente' }),
  ],
  division: null,
  pagos: [],
  consumo: 81_000,
  pagado: 0,
  enCobro: 0,
  porPagar: 81_000,
  abiertaEn: '',
  cerradaEn: null,
  ...c,
})

test('cada parte dice si está libre, en cobro o pagada, y de quién', () => {
  const c = cuenta({
    division: { partes: 3, montos: [27_000, 27_000, 27_000] },
    pagos: [pago({ id: 'a', parte: 1, subtotal: 27_000, estado: 'pagado', creadoPor: 'otro' }), pago({ id: 'b', parte: 2, subtotal: 27_000 })],
  })
  expect(partesDeDivision(c, yo.uid).map((p) => [p.numero, p.estado, p.mia])).toEqual([
    [1, 'pagada', false],
    [2, 'en_cobro', true],
    [3, 'libre', false],
  ])
})

test('un pago vencido, cancelado o duplicado deja la parte libre', () => {
  const c = cuenta({
    division: { partes: 2, montos: [40_500, 40_500] },
    pagos: [
      pago({ id: 'a', parte: 1, subtotal: 40_500, estado: 'vencido' }),
      pago({ id: 'b', parte: 2, subtotal: 40_500, estado: 'pagado', incidencia: 'pago_duplicado' }),
    ],
  })
  expect(partesDeDivision(c, yo.uid).map((p) => p.estado)).toEqual(['libre', 'libre'])
})

test('las partes de una división anterior no cuentan en la nueva', () => {
  const c = cuenta({
    division: { partes: 2, montos: [18_900, 18_900] },
    pagos: [pago({ id: 'a', parte: 1, subtotal: 45_900, estado: 'pagado' }), pago({ id: 'b', parte: 2, subtotal: 45_900, estado: 'pagado' })],
  })
  const partes = partesDeDivision(c, yo.uid)
  expect(partes.map((p) => p.estado)).toEqual(['libre', 'libre'])
  expect(divisionTerminada(partes)).toBe(false)
})

test('la vista previa reparte como reglas.ts y avisa si una parte no alcanza el mínimo', () => {
  expect(vistaPreviaPartes(91_801, 3)).toEqual({ montos: [30_601, 30_600, 30_600], alcanza: true })
  expect(vistaPreviaPartes(39_000, 4).alcanza).toBe(false)
  expect(partesMaximas(39_000, 20)).toBe(3)
  expect(partesMaximas(1_000_000, 20)).toBe(20)
})

test('por productos solo se elige lo confirmado que nadie más paga', () => {
  const c = cuenta({})
  expect(lineasPorElegir(c).map((l) => l.id)).toEqual(['mojarra', 'jugo'])
  const eleccion = { mojarra: 1, jugo: 5, patacon: 1 }
  expect(subtotalEleccion(c, eleccion)).toBe(32_400 + 8_100)
  expect(itemsEleccion({ mojarra: 1, jugo: 0 })).toEqual([{ lineaId: 'mojarra', cantidad: 1 }])
})

const pintar = (c: Cuenta) =>
  renderToStaticMarkup(
    <ProveedorDatos fuente={crearFuenteMemoria()}>
      <ProveedorAvisos>
        <OpcionesPago cuenta={c} sesion={yo} token="demo-mesa-3" alPagar={() => {}} alVerPago={() => {}} />
      </ProveedorAvisos>
    </ProveedorDatos>,
  )

test('sin dividir se ofrece pagar todo, partes iguales o elegir productos', () => {
  const html = pintar(cuenta({}))
  expect(html).toContain('Pagar todo $81.000')
  expect(html).toContain('Partes iguales')
  expect(html).toContain('De 2 a 8 personas')
  expect(html).toContain('Elegir productos')
})

test('con un cobro activo en la mesa no se puede dividir', () => {
  const html = pintar(cuenta({ enCobro: 40_000, porPagar: 41_000, pagos: [pago({ parte: null, subtotal: 40_000, creadoPor: 'otro' })] }))
  expect(html).toContain('Hay un cobro activo')
  expect(html).toMatch(/<button class="accion-dividir" disabled=""/)
})

test('una cuenta pequeña no se divide: cada parte quedaría bajo el mínimo', () => {
  const html = pintar(cuenta({ porPagar: 15_000 }))
  expect(html).toContain('Cada parte necesita $10.000')
})

test('dividida, se ve cada parte y solo las libres se pagan', () => {
  const html = pintar(
    cuenta({
      division: { partes: 3, montos: [27_000, 27_000, 27_000] },
      pagos: [pago({ parte: 1, subtotal: 27_000, estado: 'pagado', creadoPor: 'otro' })],
    }),
  )
  expect(html).toContain('Dividida en 3 partes')
  expect(html).toContain('1 de 3 pagadas')
  expect(html).toContain('Pagada')
  expect(html.match(/>Pagar</g)).toHaveLength(2)
  expect(html).toContain('La división ya no cambia')
  expect(html).not.toContain('Quitar la división')
})

test('dividida y sin pagos, se puede quitar la división', () => {
  const html = pintar(cuenta({ division: { partes: 2, montos: [40_500, 40_500] } }))
  expect(html).toContain('Quitar la división')
})

test('con todas las partes pagadas y algo nuevo, se vuelve a ofrecer pagar o dividir', () => {
  const html = pintar(
    cuenta({
      division: { partes: 2, montos: [40_500, 40_500] },
      pagos: [pago({ id: 'a', parte: 1, subtotal: 40_500, estado: 'pagado' }), pago({ id: 'b', parte: 2, subtotal: 40_500, estado: 'pagado' })],
      consumo: 118_800,
      pagado: 81_000,
      porPagar: 37_800,
    }),
  )
  expect(html).toContain('Pagar todo $37.800')
  expect(html).not.toContain('Dividida en')
})
