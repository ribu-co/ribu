import { expect, test } from 'vitest'
import { semillaDemo } from '../datos/semilla'
import { agregar, aSolicitud, cambiarCantidad, quitarNoDisponibles, totalEstimado, unidades, unidadesDe, type Borrador } from './borrador'

const productos = semillaDemo().productos

test('el mismo producto con la misma nota se suma; con otra nota va aparte', () => {
  let borrador: Borrador = []
  borrador = agregar(borrador, 'jugo-corozo', 1, ' en  leche ')
  borrador = agregar(borrador, 'jugo-corozo', 1, 'en leche')
  borrador = agregar(borrador, 'jugo-corozo', 1, null)
  expect(borrador.map((i) => [i.cantidad, i.nota])).toEqual([
    [2, 'en leche'],
    [1, null],
  ])
  expect(unidades(borrador)).toBe(3)
  expect(unidadesDe(borrador, 'jugo-corozo')).toBe(3)
})

test('la solicitud no lleva precios y una cantidad en 0 quita el producto', () => {
  let borrador = agregar([], 'mojarra-frita', 2, '')
  borrador = agregar(borrador, 'agua', 1, null)
  expect(totalEstimado(borrador, productos)).toBe(2 * 32_400 + 4_050)
  borrador = cambiarCantidad(borrador, borrador[1]!.clave, 0)
  expect(aSolicitud(borrador)).toEqual({ items: [{ productoId: 'mojarra-frita', cantidad: 2, nota: null }] })
})

test('lo que se agota mientras el cliente decide sale del borrador', () => {
  const borrador = agregar(agregar([], 'cocada', 1, null), 'agua', 1, null)
  const agotada = productos.map((p) => (p.id === 'cocada' ? { ...p, disponible: false } : p))
  const { borrador: queda, quitados } = quitarNoDisponibles(borrador, agotada)
  expect(queda.map((i) => i.productoId)).toEqual(['agua'])
  expect(quitados).toEqual(['Cocada'])
})
