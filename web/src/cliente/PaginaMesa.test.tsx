import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'
import type { Lectura } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { PaginaMesa } from './PaginaMesa'

const falso = vi.hoisted(() => ({
  sesion: { estado: 'cargando' } as unknown,
  suscripciones: [] as (((...a: unknown[]) => unknown) | null)[],
  escucharMesa: vi.fn(),
}))

// El render en servidor no ejecuta efectos: se revisa qué le pide la página a usarLectura en cada estado.
vi.mock('../datos/contexto', () => ({
  usarFuente: () => ({ escucharMesa: falso.escucharMesa }),
  usarSesionDeMesa: () => falso.sesion,
  usarLectura: (suscribir: (typeof falso.suscripciones)[number]) => {
    falso.suscripciones.push(suscribir)
    return { estado: 'cargando' }
  },
}))

const CLIENTE: Sesion = { uid: 'anonimo', rol: 'cliente', restauranteId: null, nombre: null }

beforeEach(() => {
  falso.suscripciones.length = 0
  falso.escucharMesa.mockClear()
})

test('mientras se entra como cliente, no escucha nada', () => {
  falso.sesion = { estado: 'cargando' } satisfies Lectura<Sesion>
  renderToStaticMarkup(<PaginaMesa token="mesa-1" />)
  expect(falso.suscripciones.length).toBeGreaterThan(0)
  expect(falso.suscripciones.every((s) => s === null)).toBe(true)
})

test('con la sesión lista, escucha la mesa', () => {
  falso.sesion = { estado: 'listo', valor: CLIENTE } satisfies Lectura<Sesion>
  renderToStaticMarkup(<PaginaMesa token="mesa-1" />)
  const [mesa] = falso.suscripciones
  expect(mesa).not.toBeNull()
  mesa!(() => {}, () => {})
  expect(falso.escucharMesa).toHaveBeenCalledWith('mesa-1', expect.any(Function), expect.any(Function))
})

test('si no se pudo entrar, muestra el error en vez de quedarse cargando', () => {
  falso.sesion = { estado: 'error', error: { codigo: 'SERVICIO_NO_DISPONIBLE' } }
  const html = renderToStaticMarkup(<PaginaMesa token="mesa-1" />)
  expect(html).toContain('No pudimos conectarnos')
})

test('la plataforma no pide desde la mesa', () => {
  falso.sesion = { estado: 'listo', valor: { uid: 'u1', rol: 'plataforma', restauranteId: null, nombre: 'Ana' } } satisfies Lectura<Sesion>
  const html = renderToStaticMarkup(<PaginaMesa token="mesa-1" />)
  expect(html).toContain('Entraste como plataforma')
  expect(html).not.toContain('Pidiendo como')
})
