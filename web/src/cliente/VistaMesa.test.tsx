import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { Cuenta, Producto } from '../../../contratos/tipos'
import { ProveedorDatos } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { semillaDemo } from '../datos/semilla'
import { Carta } from './Carta'
import { Pedido } from './Pedido'
import { EsqueletoMesa } from '../ui/Esqueletos'
import { VistaMesa, type PestanaMesa } from './PaginaMesa'

const semilla = semillaDemo()
const restaurante = semilla.restaurantes[0]!
const mesa = { ...semilla.mesas[2]!, estado: 'ocupada' as const, cuentaId: 'cuenta-1' }
const cliente: Sesion = { uid: 'anonimo-1', rol: 'cliente', restauranteId: null, nombre: null }

function cuentaCon(lineas: Partial<Cuenta['lineas'][number]>[]): Cuenta {
  return {
    id: 'cuenta-1',
    restauranteId: restaurante.id,
    mesaToken: mesa.token,
    numeroMesa: mesa.numero,
    estado: 'abierta',
    lineas: lineas.map((l, i) => ({
      id: `l${i}`,
      productoId: 'jugo-corozo',
      nombre: 'Jugo de corozo',
      precio: 8_100,
      cantidad: 1,
      nota: null,
      ronda: 1,
      estado: 'pendiente',
      origen: 'cliente',
      motivo: null,
      cantidadCubierta: 0,
      creadaEn: '2026-11-04T17:00:00Z',
      ...l,
    })),
    division: null,
    pagos: [],
    consumo: 0,
    pagado: 0,
    enCobro: 0,
    porPagar: 0,
    abiertaEn: '2026-11-04T17:00:00Z',
    cerradaEn: null,
  }
}

const pintar = (cuenta: Cuenta | null, sesion: Sesion = cliente, pestanaInicial: PestanaMesa = 'carta', productos: Producto[] = semilla.productos) =>
  renderToStaticMarkup(
    <ProveedorDatos fuente={crearFuenteMemoria()}>
      <VistaMesa mesa={mesa} restaurante={restaurante} productos={productos} cuenta={cuenta} sesion={sesion} pestanaInicial={pestanaInicial} />
    </ProveedorDatos>,
  )

test('la carta se muestra por categorías con precios de carta', () => {
  const html = pintar(null)
  expect(html).toContain('Fogón del Manglar')
  expect(html).toContain('Mesa 3')
  for (const categoria of ['Entradas', 'Platos fuertes', 'Bebidas', 'Postres']) expect(html).toContain(categoria)
  expect(html).toContain('$32.400')
  expect(html).toContain('¿Qué se te antoja hoy?')
  expect(html).not.toContain('<img')
})

test('un producto agotado se ve, pero no se puede pedir', () => {
  const productos = semilla.productos.map((p) => (p.id === 'mojarra-frita' ? { ...p, disponible: false } : p))
  const html = renderToStaticMarkup(<Carta productos={productos} enBorrador={() => 0} alElegir={() => {}} />)
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Mojarra frita, \$32\.400, agotado"/)
  expect(html).toContain('Agotado por hoy')
})

test('el pedido muestra cada línea con su estado y el motivo del rechazo', () => {
  const cuenta = cuentaCon([
    { estado: 'pendiente', nota: 'en leche' },
    { id: 'x', estado: 'en_preparacion', ronda: 2, nombre: 'Mojarra frita', cantidad: 2 },
    { id: 'y', estado: 'rechazada', motivo: 'Se acabó el corozo' },
  ])
  const html = renderToStaticMarkup(<Pedido cuenta={cuenta} alVerCarta={() => {}} />)
  expect(html).toContain('Esperando al mesero')
  expect(html).toContain('En preparación')
  expect(html).toContain('“en leche”')
  expect(html).toContain('Se acabó el corozo')
  expect(html.indexOf('Ronda 2')).toBeLessThan(html.indexOf('Ronda 1'))
})

test('sin pedido, la pestaña de pedido invita a ver la carta', () => {
  const html = pintar(null, cliente, 'pedido')
  expect(html).toContain('Aún no hay pedidos en esta mesa')
})

test('el resumen de arriba cuenta lo que va en camino', () => {
  const html = pintar(cuentaCon([{ cantidad: 2 }, { estado: 'confirmada' }]))
  expect(html).toContain('2 por confirmar · 1 en cocina')
  expect(html).toContain('Tu pedido va en camino')
})

test('el personal en el mismo link pide directo a cocina', () => {
  const mesero: Sesion = { uid: 'personal-mesero', rol: 'mesero', restauranteId: restaurante.id, nombre: 'Marta (mesera)' }
  const html = pintar(null, mesero)
  expect(html).toContain('Pidiendo como Marta (mesera)')
  expect(html).toContain('Lo que pidas va directo a cocina')
})

test('el esqueleto de carga usa las mismas piezas que la página real', () => {
  const esqueleto = renderToStaticMarkup(<EsqueletoMesa />)
  const real = pintar(null)
  for (const clase of ['cabecera', 'marca__logo', 'pastilla', 'hero', 'pestanas__opcion', 'categorias__chip', 'producto__foto', 'producto__precio']) {
    expect(real).toContain(clase)
    expect(esqueleto).toContain(clase)
  }
  expect(esqueleto).toContain('aria-busy="true"')
})
