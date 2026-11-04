import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { Factura, Mesa, Nota, Pago, Personal, Producto } from '../../../contratos/tipos'
import { ProveedorDatos } from '../datos/contexto'
import { crearFuenteMemoria } from '../datos/memoria'
import { ProveedorAvisos } from '../ui/Avisos'
import type { RolAdmin } from './acceso'
import { Dashboard } from './Dashboard'
import { Facturas, FilaNota, TarjetaPago } from './Facturas'
import { linkDeMesa, Mesas } from './Mesas'
import { PaginaAdmin, seccionDeHash, SinAcceso } from './PaginaAdmin'
import { agruparPorCategoria, Productos } from './Productos'
import { FilaPersonal, SeccionPersonal } from './SeccionPersonal'

const pintar = (elemento: React.ReactNode) =>
  renderToStaticMarkup(
    <ProveedorDatos fuente={crearFuenteMemoria()}>
      <ProveedorAvisos>{elemento}</ProveedorAvisos>
    </ProveedorDatos>,
  )

const listo = <T,>(valor: T) => ({ estado: 'listo', valor }) as const

const pago = (p: Partial<Pago> = {}): Pago => ({
  id: 'pago-1',
  numero: 1,
  parte: null,
  subtotal: 37_800,
  total: 37_800,
  medio: 'efectivo',
  estado: 'pagado',
  estadoFactura: 'emitida',
  incidencia: null,
  creadoPor: 'u',
  restauranteId: 'r',
  cuentaId: 'c',
  mesaToken: 'm',
  destino: { tipo: 'saldo' },
  items: [],
  impuesto: { tipo: 'INC', porcentaje: 8 },
  baseSinImpuesto: 35_000,
  propinaPorcentaje: 0,
  propina: 0,
  cobro: null,
  creadoEn: '2026-11-04T17:00:00Z',
  pagadoEn: '2026-11-04T17:00:00Z',
  ...p,
})

const factura = (f: Partial<Factura> = {}): Factura => ({
  pagoId: 'pago-1',
  restauranteId: 'r',
  pagadorUid: 'u',
  estado: 'emitida',
  comprador: { tipo: 'consumidor_final', correo: null },
  datos: { numero: 'SETP990000123', cufe: 'cufe-abc', qrUrl: 'https://dian.example/q', urlPublica: 'https://factus.example/f' },
  intentos: 1,
  ultimoError: null,
  correo: { estado: 'sin_correo', destino: null, ultimoError: null, enviadoEn: null },
  pagador: null,
  notas: [],
  emitidaEn: '2026-11-04T17:00:00Z',
  ...f,
})

const nota = (n: Partial<Nota> = {}): Nota => ({
  id: 'nota-1',
  tipo: 'credito',
  numero: 'NC1',
  total: 10_000,
  estado: 'emitida',
  concepto: 'rebaja',
  motivo: 'Cortesía',
  restauranteId: 'r',
  pagoId: 'pago-1',
  numeroFactura: 'SETP990000123',
  comprador: { tipo: 'consumidor_final', correo: null },
  lineas: [],
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propina: null,
  medio: 'efectivo',
  cobro: null,
  devolucion: 'pendiente',
  datos: { numero: 'NC1', cude: 'cude-abc', qrUrl: 'https://dian.example/n', urlPublica: 'https://factus.example/n' },
  intentos: 1,
  ultimoError: null,
  correo: { estado: 'sin_correo', destino: null, ultimoError: null, enviadoEn: null },
  creadoPor: 'u',
  creadaEn: '2026-11-04T17:00:00Z',
  emitidaEn: '2026-11-04T17:00:00Z',
  ...n,
})

const producto: Producto = { id: 'agua', restauranteId: 'r', nombre: 'Agua', descripcion: null, categoria: 'Bebidas', precio: 4_050, stock: 0, disponible: false, imagenUrl: null }

const AHORA = new Date('2026-11-04T18:00:00Z')
const vacios = { pagos: [], facturas: [], notas: [], cuentas: [], productos: [] }

describe('acceso', () => {
  test('sin saber la sesión no muestra datos ni el panel', () => {
    const html = pintar(<PaginaAdmin />)
    expect(html).toContain('Cargando')
    expect(html).not.toContain('Dashboard')
  })

  test('sin acceso, explica y lleva a /personal', () => {
    for (const tipo of ['sin_sesion', 'otro_rol', 'otro_restaurante', 'falta_restaurante'] as const) {
      expect(pintar(<SinAcceso tipo={tipo} />)).toContain('href="/personal"')
    }
  })

  test('la sección sale del # y uno desconocido vuelve al dashboard', () => {
    expect(seccionDeHash('#mesas')).toBe('mesas')
    expect(seccionDeHash('')).toBe('dashboard')
    expect(seccionDeHash('#otra')).toBe('dashboard')
  })
})

describe('dashboard', () => {
  test('sin datos muestra un estado vacío, no ceros', () => {
    const html = pintar(<Dashboard datos={listo(vacios)} ahora={AHORA} alIrAFacturas={() => {}} />)
    expect(html).toContain('Todavía no hay movimiento')
    expect(html).not.toContain('$0')
  })

  test('sin ventas hoy lo dice, y lo del periodo sí aparece', () => {
    const ayer = pago({ pagadoEn: '2026-11-03T17:00:00Z', items: [{ lineaId: 'l', nombre: 'Posta negra', cantidad: 1, precio: 37_800 }] })
    const html = pintar(<Dashboard datos={listo({ ...vacios, pagos: [ayer] })} ahora={AHORA} alIrAFacturas={() => {}} />)
    expect(html).toContain('Todavía no entra ningún pago hoy.')
    expect(html).toContain('$37.800')
    expect(html).toContain('Posta negra')
    expect(html).toContain('Efectivo')
  })

  test('avisa lo que está por resolver y un error se muestra como error', () => {
    const html = pintar(
      <Dashboard
        datos={listo({ ...vacios, pagos: [pago()], facturas: [factura({ estado: 'rechazada', datos: null })], notas: [nota()] })}
        ahora={AHORA}
        alIrAFacturas={() => {}}
      />,
    )
    expect(html).toContain('1 documento rechazado')
    expect(html).toContain('1 devolución pendiente: $10.000')
    expect(pintar(<Dashboard datos={{ estado: 'error', error: { codigo: 'SIN_PERMISO', name: '', message: '' } as never }} ahora={AHORA} alIrAFacturas={() => {}} />)).toContain('role="alert"')
  })
})

describe('x-roles en la pantalla', () => {
  const lectura = { productos: listo([producto]) }

  test('el administrador edita la carta y la plataforma solo la consulta', () => {
    const admin = pintar(<Productos {...lectura} rol="admin" />)
    expect(admin).toContain('Nuevo producto')
    expect(admin).toContain('Borrar')
    const plataforma = pintar(<Productos {...lectura} rol="plataforma" />)
    expect(plataforma).not.toContain('Nuevo producto')
    expect(plataforma).not.toContain('Borrar')
    expect(plataforma).not.toContain('Marcar')
    expect(plataforma).toContain('Agua')
  })

  test('sin stock no se ofrece marcar disponible', () => {
    expect(pintar(<Productos {...lectura} rol="admin" />)).toMatch(/disabled=""[^>]*>.*Marcar disponible/)
  })

  const fila = (f: Parameters<typeof factura>[0] = {}, n: Nota[] = []) => ({ pago: pago(), factura: factura(f), notas: n, numeroMesa: 3 })
  const tarjeta = (rol: RolAdmin, f?: Parameters<typeof factura>[0]) => pintar(<ul><TarjetaPago fila={fila(f)} rol={rol} /></ul>)

  test('factura emitida: número y CUFE para ambos; PDF y notas solo para el administrador', () => {
    const admin = tarjeta('admin')
    expect(admin).toContain('SETP990000123')
    expect(admin).toContain('cufe-abc')
    expect(admin).toContain('PDF')
    expect(admin).toContain('Emitir nota')
    const plataforma = tarjeta('plataforma')
    expect(plataforma).toContain('SETP990000123')
    expect(plataforma).not.toContain('PDF')
    expect(plataforma).not.toContain('Emitir nota')
  })

  test('factura rechazada: solo el administrador reintenta, y nunca sale nota', () => {
    const rechazada = { estado: 'rechazada', datos: null, ultimoError: 'Rechazo de la DIAN' } as const
    expect(tarjeta('admin', rechazada)).toContain('Corregir y reintentar')
    expect(tarjeta('admin', rechazada)).toContain('Rechazo de la DIAN')
    expect(tarjeta('admin', rechazada)).not.toContain('Emitir nota')
    expect(tarjeta('plataforma', rechazada)).not.toContain('Corregir y reintentar')
  })

  test('en validación no se ofrece reintentar: se reintenta sola y nunca se elimina', () => {
    const html = tarjeta('admin', { estado: 'en_validacion', datos: null })
    expect(html).toContain('La DIAN no ha respondido')
    expect(html).not.toContain('Corregir y reintentar')
  })

  test('la devolución solo se registra en una nota crédito emitida y por el administrador', () => {
    const notaFila = (rol: RolAdmin, n: Partial<Nota> = {}) => pintar(<ul><FilaNota nota={nota(n)} rol={rol} /></ul>)
    expect(notaFila('admin')).toContain('Registrar devolución')
    expect(notaFila('admin')).toContain('cude-abc')
    expect(notaFila('plataforma')).not.toContain('Registrar devolución')
    expect(notaFila('plataforma')).not.toContain('PDF')
    expect(notaFila('admin', { estado: 'rechazada', datos: null })).not.toContain('Registrar devolución')
    expect(notaFila('admin', { estado: 'rechazada', datos: null })).toContain('Corregir y reintentar')
    expect(notaFila('admin', { devolucion: 'hecha' })).toContain('Devolución hecha')
  })

  test('la lista de pagos deja fuera lo que no ha entrado', () => {
    const html = pintar(
      <Facturas pagos={listo([pago({ id: 'x', estado: 'esperando_pago', numero: 7 }), pago()])} facturas={listo([factura()])} notas={listo([])} mesas={listo([{ token: 'm', numero: 3 } as Mesa])} rol="admin" />,
    )
    expect(html).toContain('Mesa 3 · Pago 1')
    expect(html).not.toContain('Pago 7')
  })

  test('un pago duplicado no ofrece factura', () => {
    const html = pintar(<ul><TarjetaPago fila={{ pago: pago({ incidencia: 'pago_duplicado' }), factura: null, notas: [], numeroMesa: 3 }} rol="admin" /></ul>)
    expect(html).toContain('Pago duplicado')
    expect(html).not.toContain('Emitir nota')
  })
})

describe('personal', () => {
  const persona = (p: Partial<Personal> = {}): Personal => ({ uid: 'u2', restauranteId: 'r', correo: 'a@b.co', nombre: 'Ana', rol: 'cocina', activo: true, creadoEn: '2026-11-04T17:00:00Z', ...p })

  test('si la fuente no trae las operaciones, lo dice y no inventa una lista', () => {
    expect(pintar(<SeccionPersonal restauranteId="r" rol="admin" uid="u" />)).toContain('El personal todavía no está conectado')
  })

  test('nadie se quita el acceso a sí mismo', () => {
    const fila = (p: Parameters<typeof FilaPersonal>[0]) => pintar(<ul><FilaPersonal {...p} /></ul>)
    const base = { persona: persona(), puedeCambiar: true, ocupado: false, alCambiar: () => {} }
    expect(fila({ ...base, propia: false })).toContain('Desactivar')
    expect(fila({ ...base, propia: true })).not.toContain('Desactivar')
    expect(fila({ ...base, propia: false, persona: persona({ activo: false }) })).toContain('Reactivar')
  })
})

test('el link de la mesa es el de rutas.paginaMesa, completo', () => {
  expect(linkDeMesa('https://ribu.co', 'abc')).toBe('https://ribu.co/m/abc')
  const html = pintar(<Mesas mesas={listo([{ token: 'abc', restauranteId: 'r', numero: 2, estado: 'libre', cuentaId: null }])} origen="https://ribu.co" />)
  expect(html).toContain('Mesa 2')
  expect(html).toContain('https://ribu.co/m/abc')
  expect(pintar(<Mesas mesas={listo([])} origen="https://ribu.co" />)).toContain('no tiene mesas')
})

test('los productos se agrupan por categoría y se ordenan por nombre', () => {
  const p = (nombre: string, categoria: string) => ({ ...producto, id: nombre, nombre, categoria })
  expect(agruparPorCategoria([p('Té', 'Bebidas'), p('Agua', 'Bebidas'), p('Arepa', 'Entradas')]).map((g) => [g.categoria, g.productos.map((x) => x.nombre)])).toEqual([
    ['Bebidas', ['Agua', 'Té']],
    ['Entradas', ['Arepa']],
  ])
})
