import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { Sesion } from '../datos/fuente'
import { decidirAcceso, puede, ROLES_POR_ORDEN, type OrdenAdmin } from './acceso'

const sesion = (rol: Sesion['rol'], restauranteId: string | null = 'r1'): Sesion => ({ uid: 'u', rol, restauranteId, nombre: null })

test('sin saber aún si hay sesión, espera; sin sesión, no entra', () => {
  expect(decidirAcceso(undefined, null).tipo).toBe('cargando')
  expect(decidirAcceso(null, null).tipo).toBe('sin_sesion')
  expect(decidirAcceso(null, 'r1').tipo).toBe('sin_sesion')
})

test('mesero, cocina y cliente no entran, ni con el restaurante en la ruta', () => {
  for (const rol of ['mesero', 'cocina', 'cliente'] as const) {
    expect(decidirAcceso(sesion(rol), null).tipo).toBe('otro_rol')
    expect(decidirAcceso(sesion(rol), 'r1').tipo).toBe('otro_rol')
  }
})

test('el administrador entra a su restaurante y no a otro', () => {
  expect(decidirAcceso(sesion('admin'), null)).toEqual({ tipo: 'permitido', rol: 'admin', restauranteId: 'r1', uid: 'u' })
  expect(decidirAcceso(sesion('admin'), 'r1')).toEqual({ tipo: 'permitido', rol: 'admin', restauranteId: 'r1', uid: 'u' })
  expect(decidirAcceso(sesion('admin'), 'r2').tipo).toBe('otro_restaurante')
  expect(decidirAcceso(sesion('admin', null), null).tipo).toBe('otro_rol')
})

test('la plataforma necesita el restaurante en la ruta', () => {
  expect(decidirAcceso(sesion('plataforma', null), null).tipo).toBe('falta_restaurante')
  expect(decidirAcceso(sesion('plataforma', null), 'r2')).toEqual({ tipo: 'permitido', rol: 'plataforma', restauranteId: 'r2', uid: 'u' })
})

test('los permisos son los mismos x-roles de openapi.yaml', () => {
  const contrato = readFileSync(new URL('../../../contratos/openapi.yaml', import.meta.url), 'utf8')
  for (const orden of Object.keys(ROLES_POR_ORDEN) as OrdenAdmin[]) {
    const roles = new RegExp(`operationId: ${orden}\\n[\\s\\S]*?x-roles: \\[([^\\]]*)\\]`).exec(contrato)?.[1]
    expect(roles, orden).toBeDefined()
    expect(roles!.split(',').map((rol) => rol.trim()).sort(), orden).toEqual([...ROLES_POR_ORDEN[orden]].sort())
  }
})

test('a la plataforma solo se le ofrece el personal', () => {
  const suyas = (Object.keys(ROLES_POR_ORDEN) as OrdenAdmin[]).filter((orden) => puede('plataforma', orden))
  expect(suyas.sort()).toEqual(['actualizarPersonal', 'crearPersonal'])
  for (const orden of Object.keys(ROLES_POR_ORDEN) as OrdenAdmin[]) expect(puede('admin', orden), orden).toBe(true)
})
