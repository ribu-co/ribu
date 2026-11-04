import { beforeEach, describe, expect, test } from 'vitest'
import type { NuevoRestaurante } from '../../../contratos/tipos'
import type { ErrorDatos } from './fuente'
import { crearFuenteMemoria, type Almacen, type EstadoMemoria } from './memoria'
import { CLAVE_DEMO } from './semilla'

const DEMO = 'fogon-del-manglar'
const NUEVO: NuevoRestaurante = {
  nombre: 'La Ñapa Costeña',
  impuesto: { tipo: 'INC', porcentaje: 8 },
  propinasSugeridas: [5, 8, 10],
  mesas: 3,
}

/** Varias sesiones sobre el mismo estado, como varios celulares sobre Firestore. */
function almacenCompartido() {
  let guardado: EstadoMemoria | null = null
  const avisos = new Set<() => void>()
  return (): Almacen => ({
    leer: () => (guardado ? structuredClone(guardado) : null),
    guardar(estado) {
      guardado = structuredClone(estado)
      for (const aviso of avisos) aviso()
    },
    borrar() {
      guardado = null
    },
    alCambiarFuera(aviso) {
      avisos.add(aviso)
      return () => avisos.delete(aviso)
    },
  })
}

const codigo = (promesa: Promise<unknown>) =>
  promesa.then(
    () => 'sin error',
    (e: ErrorDatos) => e.codigo,
  )

const primero = <T,>(escuchar: (a: (valor: T) => void, b: (error: ErrorDatos) => void) => () => void) =>
  new Promise<T>((resolver, rechazar) => {
    const cancelar = escuchar(
      (valor) => {
        queueMicrotask(() => cancelar())
        resolver(valor)
      },
      (error) => {
        queueMicrotask(() => cancelar())
        rechazar(error)
      },
    )
  })

let plataforma: ReturnType<typeof crearFuenteMemoria>
let admin: ReturnType<typeof crearFuenteMemoria>
let mesero: ReturnType<typeof crearFuenteMemoria>
let cliente: ReturnType<typeof crearFuenteMemoria>
let telefono: () => ReturnType<typeof crearFuenteMemoria>

beforeEach(async () => {
  const almacen = almacenCompartido()
  telefono = () => crearFuenteMemoria({ almacen: almacen(), programar: () => {} })
  plataforma = telefono()
  admin = telefono()
  mesero = telefono()
  cliente = telefono()
  await plataforma.entrarPersonal('plataforma@ribu.demo', CLAVE_DEMO)
  await admin.entrarPersonal('admin@ribu.demo', CLAVE_DEMO)
  await mesero.entrarPersonal('mesero@ribu.demo', CLAVE_DEMO)
  await cliente.entrarComoCliente()
})

describe('restaurantes', () => {
  test('la plataforma crea un restaurante activo con sus mesas numeradas desde 1', async () => {
    const { restaurante, mesas } = await plataforma.crearRestaurante(NUEVO)
    expect(restaurante).toMatchObject({ nombre: 'La Ñapa Costeña', activo: true, propinasSugeridas: [5, 8, 10] })
    expect(mesas.map((m) => [m.numero, m.estado, m.cuentaId, m.restauranteId])).toEqual([
      [1, 'libre', null, restaurante.id],
      [2, 'libre', null, restaurante.id],
      [3, 'libre', null, restaurante.id],
    ])
    expect(new Set(mesas.map((m) => m.token)).size).toBe(3)
    const lista = await primero<{ id: string }[]>((a, b) => plataforma.escucharRestaurantes(a, b))
    expect(lista.map((r) => r.id)).toContain(restaurante.id)
  })

  test('solo la plataforma los crea y los lista', async () => {
    expect(await codigo(admin.crearRestaurante(NUEVO))).toBe('SIN_PERMISO')
    expect(await codigo(cliente.crearRestaurante(NUEVO))).toBe('SIN_PERMISO')
    await expect(primero((a, b) => admin.escucharRestaurantes(a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
  })

  test('rechaza propinas sugeridas por encima del máximo y datos incompletos', async () => {
    expect(await codigo(plataforma.crearRestaurante({ ...NUEVO, propinasSugeridas: [5, 12] }))).toBe('CUERPO_INVALIDO')
    expect(await codigo(plataforma.crearRestaurante({ ...NUEVO, nombre: ' ' }))).toBe('CUERPO_INVALIDO')
    expect(await codigo(plataforma.crearRestaurante({ ...NUEVO, mesas: 0 }))).toBe('CUERPO_INVALIDO')
  })

  test('desactivado no recibe pedidos ni pagos, pero conserva su historia', async () => {
    const cuenta = await mesero.agregarLineas('demo-mesa-1', { items: [{ productoId: 'carne-asada', cantidad: 1, nota: null }] })
    await plataforma.actualizarRestaurante(DEMO, { activo: false })
    expect(await codigo(cliente.agregarLineas('demo-mesa-2', { items: [{ productoId: 'agua', cantidad: 1, nota: null }] }))).toBe('RESTAURANTE_INACTIVO')
    const pago = { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: { tipo: 'consumidor_final', correo: null }, medio: 'efectivo' } as const
    expect(await codigo(mesero.crearPago('demo-mesa-1', pago))).toBe('RESTAURANTE_INACTIVO')
    expect(plataforma.estado().cuentas[cuenta.id]?.lineas).toHaveLength(1)
    await plataforma.actualizarRestaurante(DEMO, { activo: true })
    expect((await mesero.crearPago('demo-mesa-1', pago)).estado).toBe('pagado')
  })

  test('el administrador cambia el suyo, pero no lo activa ni toca otro', async () => {
    const { restaurante } = await plataforma.crearRestaurante(NUEVO)
    expect((await admin.actualizarRestaurante(DEMO, { nombre: 'Fogón Nuevo' })).nombre).toBe('Fogón Nuevo')
    expect(await codigo(admin.actualizarRestaurante(DEMO, { activo: false }))).toBe('SIN_PERMISO')
    expect(await codigo(admin.actualizarRestaurante(restaurante.id, { nombre: 'Ajeno' }))).toBe('SIN_PERMISO')
    expect(await codigo(mesero.actualizarRestaurante(DEMO, { nombre: 'Nope' }))).toBe('SIN_PERMISO')
    expect(await codigo(plataforma.actualizarRestaurante('no-existe', { nombre: 'x' }))).toBe('NO_ENCONTRADO')
  })
})

describe('mesas', () => {
  test('agrega con los números siguientes, sin cambiar los tokens que ya existen', async () => {
    const antes = Object.keys(plataforma.estado().mesas)
    const nuevas = await plataforma.agregarMesas(DEMO, { cantidad: 2 })
    expect(nuevas.map((m) => m.numero)).toEqual([6, 7])
    expect(Object.keys(plataforma.estado().mesas)).toEqual(expect.arrayContaining(antes))
    expect((await admin.agregarMesas(DEMO, { cantidad: 1 }))[0]?.numero).toBe(8)
    expect(await codigo(mesero.agregarMesas(DEMO, { cantidad: 1 }))).toBe('SIN_PERMISO')
    expect(await codigo(plataforma.agregarMesas(DEMO, { cantidad: 0 }))).toBe('CUERPO_INVALIDO')
  })

  test('la plataforma ve las mesas de cualquier restaurante', async () => {
    const { restaurante } = await plataforma.crearRestaurante(NUEVO)
    const mesas = await primero<unknown[]>((a, b) => plataforma.escucharMesas(restaurante.id, a, b))
    expect(mesas).toHaveLength(3)
    await expect(primero((a, b) => admin.escucharMesas(restaurante.id, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
  })
})

describe('personal', () => {
  test('el primer administrador de un restaurante nuevo entra con su rol y restaurante', async () => {
    const { restaurante } = await plataforma.crearRestaurante(NUEVO)
    const creado = await plataforma.crearPersonal(restaurante.id, { correo: ' Nueva@Napa.demo ', nombre: 'Nueva', rol: 'admin', clave: 'clave-segura' })
    expect(creado).toMatchObject({ correo: 'nueva@napa.demo', rol: 'admin', activo: true, restauranteId: restaurante.id })
    expect(creado).not.toHaveProperty('clave')
    const sesion = await telefono().entrarPersonal('nueva@napa.demo', 'clave-segura')
    expect(sesion).toMatchObject({ rol: 'admin', restauranteId: restaurante.id })
  })

  test('un correo no se repite y la clave tiene mínimo 8 caracteres', async () => {
    expect(await codigo(admin.crearPersonal(DEMO, { correo: 'mesero@ribu.demo', nombre: 'Otro', rol: 'mesero', clave: 'clave-segura' }))).toBe('CORREO_EN_USO')
    expect(await codigo(admin.crearPersonal(DEMO, { correo: 'b@ribu.demo', nombre: 'Otro', rol: 'mesero', clave: 'corta' }))).toBe('CUERPO_INVALIDO')
  })

  test('nadie crea una cuenta de plataforma ni gestiona otro restaurante', async () => {
    const { restaurante } = await plataforma.crearRestaurante(NUEVO)
    const datos = { correo: 'c@ribu.demo', nombre: 'Otro', clave: 'clave-segura' }
    expect(await codigo(plataforma.crearPersonal(DEMO, { ...datos, rol: 'plataforma' as 'admin' }))).toBe('CUERPO_INVALIDO')
    expect(await codigo(admin.crearPersonal(restaurante.id, { ...datos, rol: 'admin' }))).toBe('SIN_PERMISO')
    expect(await codigo(mesero.crearPersonal(DEMO, { ...datos, rol: 'mesero' }))).toBe('SIN_PERMISO')
  })

  test('la lista no trae claves y solo la leen el administrador y la plataforma', async () => {
    const lista = await primero<object[]>((a, b) => admin.escucharPersonal(DEMO, a, b))
    expect(lista).toHaveLength(3)
    for (const persona of lista) expect(persona).not.toHaveProperty('clave')
    expect(await primero<object[]>((a, b) => plataforma.escucharPersonal(DEMO, a, b))).toHaveLength(3)
    await expect(primero((a, b) => mesero.escucharPersonal(DEMO, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
  })

  test('sin acceso ya no entra, y se le puede cambiar la clave', async () => {
    const lista = await primero<{ uid: string; correo: string }[]>((a, b) => admin.escucharPersonal(DEMO, a, b))
    const uid = lista.find((p) => p.correo === 'cocina@ribu.demo')!.uid
    await admin.actualizarPersonal(DEMO, uid, { activo: false })
    expect(await codigo(telefono().entrarPersonal('cocina@ribu.demo', CLAVE_DEMO))).toBe('NO_AUTORIZADO')
    await admin.actualizarPersonal(DEMO, uid, { activo: true, clave: 'clave-nueva' })
    expect((await telefono().entrarPersonal('cocina@ribu.demo', 'clave-nueva')).rol).toBe('cocina')
    expect(await codigo(admin.actualizarPersonal(DEMO, 'no-existe', { nombre: 'x' }))).toBe('NO_ENCONTRADO')
  })
})

describe('lecturas', () => {
  test('sin sesión nada se lee, como en Firestore', async () => {
    const anonimo = telefono()
    await expect(primero((a, b) => anonimo.escucharMesa('demo-mesa-1', a, b))).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
    await expect(primero((a, b) => anonimo.escucharProductos(DEMO, a, b))).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO' })
  })

  test('el mesero lee un pago con su id, pero no lista pagos ni facturas', async () => {
    await expect(primero((a, b) => mesero.escucharPagos(DEMO, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    await expect(primero((a, b) => mesero.escucharFacturas(DEMO, a, b))).rejects.toMatchObject({ codigo: 'SIN_PERMISO' })
    expect(await primero<unknown[]>((a, b) => admin.escucharPagos(DEMO, a, b))).toEqual([])
    expect(await primero<unknown[]>((a, b) => plataforma.escucharFacturas(DEMO, a, b))).toEqual([])
  })
})
