import { expect, test } from 'vitest'
import { almacenCompartido, almacenSesionDePestana } from './almacen'
import { crearFuenteMemoria } from './memoria'

function almacenFalso(): Storage {
  const datos = new Map<string, string>()
  return {
    get length() {
      return datos.size
    },
    clear: () => datos.clear(),
    getItem: (clave) => datos.get(clave) ?? null,
    key: (i) => [...datos.keys()][i] ?? null,
    removeItem: (clave) => void datos.delete(clave),
    setItem: (clave, valor) => void datos.set(clave, valor),
  }
}

test('el pedido sobrevive a recargar la página y se borra al reiniciar la demo', async () => {
  const local = almacenFalso()
  const almacen = { ...almacenCompartido('prueba', local), alCambiarFuera: () => () => {} }
  const antes = crearFuenteMemoria({ almacen, programar: () => {} })
  await antes.entrarComoCliente()
  await antes.agregarLineas('demo-mesa-1', { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })

  const despues = crearFuenteMemoria({ almacen, programar: () => {} })
  expect(despues.estado().mesas['demo-mesa-1']?.estado).toBe('ocupada')

  despues.simulador.reiniciar()
  expect(local.getItem('prueba')).toBeNull()
  expect(despues.estado().mesas['demo-mesa-1']?.estado).toBe('libre')
  expect(despues.simulador.mesasDemo().map((m) => m.numero)).toEqual([1, 2, 3, 4, 5])
})

test('la sesión vive en la pestaña y se borra al salir', async () => {
  const pestana = almacenFalso()
  const almacenSesion = almacenSesionDePestana('sesion', pestana)
  const fuente = crearFuenteMemoria({ almacenSesion })
  const sesion = await fuente.entrarComoCliente()
  expect(almacenSesion.leer()).toEqual(sesion)
  expect((await crearFuenteMemoria({ almacenSesion }).entrarComoCliente()).uid).toBe(sesion.uid)
  await fuente.salir()
  expect(pestana.getItem('sesion')).toBeNull()
})

test('un dato dañado no rompe la página', () => {
  const local = almacenFalso()
  local.setItem('prueba', '{no es json')
  expect(almacenCompartido('prueba', local).leer()).toBeNull()
})
