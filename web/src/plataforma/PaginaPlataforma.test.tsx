import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Restaurante } from '../../../contratos/tipos'
import { ProveedorDatos, type Lectura } from '../datos/contexto'
import { ErrorDatos } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { EntradaPlataforma, ListaRestaurantes, PaginaPlataforma, SinAcceso } from './PaginaPlataforma'

vi.mock('./plataforma.css', () => ({}))

const conFuente = (nodo: React.ReactNode) => renderToStaticMarkup(<ProveedorDatos fuente={crearFuenteMemoria()}>{nodo}</ProveedorDatos>)

const nada = () => {}
const lista = (lectura: Lectura<Restaurante[]>) =>
  conFuente(
    <ListaRestaurantes
      lectura={lectura}
      cambiando={null}
      alCrear={nada}
      alVerMesas={nada}
      alCrearAdministrador={nada}
      alDesactivar={nada}
      alActivar={nada}
    />,
  )

const RESTAURANTE: Restaurante = {
  id: 'r1',
  nombre: 'La Ñapa',
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propinasSugeridas: [0, 5, 10],
  activo: true,
}

describe('lista de restaurantes', () => {
  test('cargando', () => {
    expect(lista({ estado: 'cargando' })).toContain('Cargando los restaurantes')
  })

  test('vacía, ofrece crear el primero', () => {
    expect(lista({ estado: 'listo', valor: [] })).toContain('Crear un restaurante')
  })

  test('con error, traduce el código', () => {
    expect(lista({ estado: 'error', error: new ErrorDatos('SIN_PERMISO') })).toContain('Esto no está disponible desde tu sesión')
  })

  test('muestra el impuesto y las propinas; el 0 no se cuenta como sugerida', () => {
    const html = lista({ estado: 'listo', valor: [RESTAURANTE] })
    expect(html).toContain('La Ñapa')
    expect(html).toContain('INC 8 %')
    expect(html).toContain('5 %, 10 %')
    expect(html).toContain('Links de mesas')
    expect(html).toContain('Administrador')
    expect(html).toContain('Desactivar')
    expect(html).not.toContain('Activar de nuevo')
  })

  test('un restaurante inactivo se puede volver a activar', () => {
    const html = lista({ estado: 'listo', valor: [{ ...RESTAURANTE, activo: false }] })
    expect(html).toContain('Inactivo')
    expect(html).toContain('Activar de nuevo')
    expect(html).not.toContain('>Desactivar<')
  })
})

describe('acceso', () => {
  test('mientras se sabe si hay sesión, no muestra nada del panel', () => {
    const html = conFuente(<PaginaPlataforma />)
    expect(html).toContain('Cargando')
    expect(html).not.toContain('Restaurantes')
  })

  test('tiene su propia entrada con correo y clave', () => {
    const html = conFuente(<EntradaPlataforma />)
    expect(html).toContain('type="email"')
    expect(html).toContain('type="password"')
  })

  test('otro rol lo ve claro y solo puede salir', () => {
    const html = conFuente(<SinAcceso sesion={{ uid: 'm', rol: 'mesero', restauranteId: 'r1', nombre: 'Marta' }} />)
    expect(html).toContain('solo para quien administra Ribu')
    expect(html).toContain('cuenta de mesero')
    expect(html).toContain('Salir y entrar con otra cuenta')
    expect(html).not.toContain('Nuevo restaurante')
  })
})
