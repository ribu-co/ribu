import { describe, expect, test } from 'vitest'
import { puedeLiberarMesa, puedePasar, TRANSICIONES_LINEA } from '../../../contratos/reglas'
import { ESTADOS_LINEA, type Comprador, type Cuenta, type LineaPedido, type Mesa } from '../../../contratos/tipos'
import type { ErrorDatos, FuenteDatos } from '../datos/fuente'
import { crearFuenteMemoria } from '../datos/memoria'
import { CLAVE_DEMO } from '../datos/semilla'
import {
  accionesDeLinea,
  avancesDeCocina,
  colaDeCocina,
  decidirAcceso,
  idsPorConfirmar,
  motivosParaNoLiberar,
  pantallaDeRol,
  resumenCocina,
  resumirMesa,
  ROLES_COCINA,
  ROLES_MESERO,
  unidadesSinEntregar,
} from './logica'

const TOKEN = 'demo-mesa-3'
const RESTAURANTE = 'fogon-del-manglar'
const CONSUMIDOR: Comprador = { tipo: 'consumidor_final', correo: null }

const fuenteNueva = () => crearFuenteMemoria({ programar: (tarea) => tarea() })

async function como(fuente: FuenteDatos, rol: 'mesero' | 'cocina' | 'admin' | 'cliente') {
  await fuente.salir()
  if (rol === 'cliente') await fuente.entrarComoCliente()
  else await fuente.entrarPersonal(`${rol}@ribu.demo`, CLAVE_DEMO)
}

/** Un cliente pide: mojarra con nota y un jugo. Queda todo por confirmar. */
async function clientePide(fuente: FuenteDatos) {
  await como(fuente, 'cliente')
  return fuente.agregarLineas(TOKEN, {
    items: [
      { productoId: 'mojarra-frita', cantidad: 1, nota: 'sin ensalada' },
      { productoId: 'jugo-corozo', cantidad: 2, nota: null },
    ],
  })
}

const linea = (l: Partial<LineaPedido>): LineaPedido => ({
  id: 'l',
  productoId: 'p',
  nombre: 'Jugo de corozo',
  precio: 8_100,
  cantidad: 1,
  nota: null,
  ronda: 1,
  estado: 'confirmada',
  origen: 'cliente',
  motivo: null,
  cantidadCubierta: 0,
  creadaEn: '2026-11-04T17:00:00Z',
  ...l,
})

const codigo = (promesa: Promise<unknown>) => promesa.then(() => 'sin error', (e: ErrorDatos) => e.codigo)

const mesaDe = (fuente: ReturnType<typeof fuenteNueva>) => fuente.estado().mesas[TOKEN] as Mesa

describe('acceso', () => {
  test('cada rol va a su pantalla y el cliente no tiene ninguna', () => {
    expect(pantallaDeRol('mesero')).toBe('/mesero')
    expect(pantallaDeRol('cocina')).toBe('/cocina')
    expect(pantallaDeRol('admin')).toBe('/admin')
    expect(pantallaDeRol('plataforma')).toBe('/plataforma')
    expect(pantallaDeRol('cliente')).toBeNull()
  })

  test('sin sesión, con cliente anónimo o con otro rol no se entra a la pantalla', () => {
    const mesero = { uid: 'u', rol: 'mesero', restauranteId: RESTAURANTE, nombre: 'Marta' } as const
    const cocina = { ...mesero, rol: 'cocina' } as const
    const anonimo = { uid: 'a', rol: 'cliente', restauranteId: null, nombre: null } as const
    expect(decidirAcceso(undefined, ROLES_MESERO).tipo).toBe('cargando')
    expect(decidirAcceso(null, ROLES_MESERO).tipo).toBe('sin_sesion')
    expect(decidirAcceso(anonimo, ROLES_MESERO).tipo).toBe('sin_sesion')
    expect(decidirAcceso(cocina, ROLES_MESERO).tipo).toBe('otro_rol')
    expect(decidirAcceso(mesero, ROLES_COCINA).tipo).toBe('otro_rol')
    expect(decidirAcceso(mesero, ROLES_MESERO).tipo).toBe('permitido')
    expect(decidirAcceso(cocina, ROLES_COCINA).tipo).toBe('permitido')
  })
})

describe('tablero de mesas', () => {
  test('una mesa libre, una por confirmar y una con saldo se distinguen de un vistazo', async () => {
    const fuente = fuenteNueva()
    const libre = fuente.estado().mesas['demo-mesa-1'] as Mesa
    expect(resumirMesa(libre, []).estados).toEqual([{ texto: 'Libre', tono: 'gris' }])

    const cuenta = await clientePide(fuente)
    const porConfirmar = resumirMesa(mesaDe(fuente), [cuenta])
    expect(porConfirmar.porConfirmar).toBe(3)
    expect(porConfirmar.estados.map((e) => e.texto)).toEqual(['3 por confirmar'])

    await como(fuente, 'mesero')
    const confirmada = await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })
    expect(resumirMesa(mesaDe(fuente), [confirmada]).estados.map((e) => e.texto)).toEqual(['Saldo $48.600'])
  })

  test('una mesa pagada y una con platos listos lo dicen', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    await como(fuente, 'mesero')
    const confirmada = await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })
    const lista = await fuente.avanzarLinea(TOKEN, confirmada.lineas[0]!.id, { estado: 'lista' })
    expect(resumirMesa(mesaDe(fuente), [lista]).estados.map((e) => e.texto)).toEqual(['1 para servir', 'Saldo $48.600'])

    await fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' })
    const pagada = fuente.estado().cuentas[lista.id] as Cuenta
    expect(resumirMesa(mesaDe(fuente), [pagada]).estados.map((e) => e.texto)).toEqual(['1 para servir', 'Pagada'])
  })

  test('una mesa ocupada cuya cuenta aún no llega no se muestra como libre', () => {
    const mesa: Mesa = { token: 't', restauranteId: RESTAURANTE, numero: 1, estado: 'ocupada', cuentaId: 'c' }
    expect(resumirMesa(mesa, []).estados[0]?.texto).toBe('Ocupada')
  })
})

describe('acciones de una línea', () => {
  test('nunca ofrece una transición que el contrato no permita', () => {
    const destino = { confirmar: 'confirmada', rechazar: 'rechazada', entregar: 'entregada', marcar_lista: 'lista', anular: 'anulada' } as const
    for (const estado of ESTADOS_LINEA) {
      for (const accion of accionesDeLinea(linea({ estado }))) {
        expect(puedePasar(TRANSICIONES_LINEA, estado, destino[accion])).toBe(true)
      }
    }
  })

  test('cada estado ofrece lo que corresponde', () => {
    expect(accionesDeLinea(linea({ estado: 'pendiente' }))).toEqual(['confirmar', 'rechazar'])
    expect(accionesDeLinea(linea({ estado: 'confirmada' }))).toEqual(['marcar_lista', 'anular'])
    expect(accionesDeLinea(linea({ estado: 'lista' }))).toEqual(['entregar', 'anular'])
    expect(accionesDeLinea(linea({ estado: 'entregada' }))).toEqual(['anular'])
    expect(accionesDeLinea(linea({ estado: 'rechazada' }))).toEqual([])
    expect(accionesDeLinea(linea({ estado: 'anulada' }))).toEqual([])
  })

  test('lo que ya está en un pago no se ofrece para anular', async () => {
    expect(accionesDeLinea(linea({ estado: 'lista', cantidadCubierta: 1 }))).toEqual(['entregar'])

    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    await como(fuente, 'mesero')
    await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })
    await fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' })
    const cubierta = (fuente.estado().cuentas[cuenta.id] as Cuenta).lineas[0]!
    expect(accionesDeLinea(cubierta)).not.toContain('anular')
    expect(await codigo(fuente.anularLineas(TOKEN, { lineaIds: [cubierta.id], motivo: 'error' }))).toBe('LINEA_CON_PAGO')
  })
})

describe('el flujo del mesero contra el backend en memoria', () => {
  test('sin confirmar nada llega a cocina y al confirmar sí', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    expect(colaDeCocina([cuenta])).toEqual([])

    await como(fuente, 'mesero')
    const confirmada = await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })
    expect(colaDeCocina([confirmada])[0]?.lineas).toHaveLength(2)
    expect(idsPorConfirmar(confirmada)).toEqual([])
    expect(confirmada.consumo).toBe(48_600)
  })

  test('rechazar y anular exigen motivo y lo dejan en la línea', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    const [mojarra, jugo] = cuenta.lineas as [LineaPedido, LineaPedido]
    await como(fuente, 'mesero')

    expect(await codigo(fuente.rechazarLineas(TOKEN, { lineaIds: [mojarra.id], motivo: '  ' }))).toBe('CUERPO_INVALIDO')
    const rechazada = await fuente.rechazarLineas(TOKEN, { lineaIds: [mojarra.id], motivo: 'Se acabó la mojarra' })
    expect(rechazada.lineas[0]).toMatchObject({ estado: 'rechazada', motivo: 'Se acabó la mojarra' })

    await fuente.confirmarLineas(TOKEN, { lineaIds: [jugo.id] })
    const anulada = await fuente.anularLineas(TOKEN, { lineaIds: [jugo.id], motivo: 'El cliente cambió de idea' })
    expect(anulada.lineas[1]).toMatchObject({ estado: 'anulada', motivo: 'El cliente cambió de idea' })
    expect(anulada.consumo).toBe(0)
  })

  test('lo que pide el personal va directo a cocina', async () => {
    const fuente = fuenteNueva()
    await como(fuente, 'mesero')
    const cuenta = await fuente.agregarLineas(TOKEN, { items: [{ productoId: 'agua', cantidad: 1, nota: null }] })
    expect(cuenta.lineas[0]).toMatchObject({ estado: 'confirmada', origen: 'personal' })
    expect(colaDeCocina([cuenta])[0]?.numeroMesa).toBe(3)
  })

  test('el mesero cobra en efectivo o con tarjeta; el cliente no puede', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    await como(fuente, 'mesero')
    await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })

    await como(fuente, 'cliente')
    expect(await codigo(fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' }))).toBe('SIN_PERMISO')

    await como(fuente, 'mesero')
    const pago = await fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'tarjeta_credito' })
    expect(pago.estado).toBe('pagado')
    expect(fuente.estado().facturas[pago.id]?.estado).toBe('emitida')
  })

  test('liberar solo se ofrece cuando el contrato lo permite, y dice qué falta', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    expect(motivosParaNoLiberar(cuenta)).toEqual(['3 productos por confirmar'])

    await como(fuente, 'mesero')
    expect(await codigo(fuente.liberarMesa(TOKEN))).toBe('MESA_CON_SALDO')

    const confirmada = await fuente.confirmarLineas(TOKEN, { lineaIds: idsPorConfirmar(cuenta) })
    expect(motivosParaNoLiberar(confirmada)).toEqual(['$48.600 de saldo'])

    await fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' })
    const pagada = fuente.estado().cuentas[cuenta.id] as Cuenta
    expect(puedeLiberarMesa(pagada)).toBe(true)
    expect(motivosParaNoLiberar(pagada)).toEqual([])
    expect(unidadesSinEntregar(pagada)).toBe(3)

    const libre = await fuente.liberarMesa(TOKEN)
    expect(libre).toMatchObject({ estado: 'libre', cuentaId: null })
  })

  test('la cocina avanza líneas, pero no confirma, no cobra y no libera', async () => {
    const fuente = fuenteNueva()
    const cuenta = await clientePide(fuente)
    await como(fuente, 'cocina')
    const ids = idsPorConfirmar(cuenta)
    expect(await codigo(fuente.confirmarLineas(TOKEN, { lineaIds: ids }))).toBe('SIN_PERMISO')

    await como(fuente, 'mesero')
    const confirmada = await fuente.confirmarLineas(TOKEN, { lineaIds: ids })

    await como(fuente, 'cocina')
    const id = confirmada.lineas[0]!.id
    expect((await fuente.avanzarLinea(TOKEN, id, { estado: 'en_preparacion' })).lineas[0]?.estado).toBe('en_preparacion')
    const lista = await fuente.avanzarLinea(TOKEN, id, { estado: 'lista' })
    expect(lista.lineas[0]?.estado).toBe('lista')
    expect(colaDeCocina([lista])[0]?.lineas.map((l) => l.nombre)).toEqual(['Jugo de corozo'])
    expect(await codigo(fuente.crearPago(TOKEN, { destino: { tipo: 'saldo' }, propinaPorcentaje: 0, comprador: CONSUMIDOR, medio: 'efectivo' }))).toBe('SIN_PERMISO')
    expect(await codigo(fuente.liberarMesa(TOKEN))).toBe('SIN_PERMISO')
  })

  test('escuchar las mesas exige ser del personal de ese restaurante', async () => {
    const fuente = fuenteNueva()
    await como(fuente, 'cliente')
    const error = await new Promise<ErrorDatos>((resolver) => {
      fuente.escucharMesas(RESTAURANTE, () => {}, resolver)
    })
    expect(error.codigo).toBe('SIN_PERMISO')
  })
})

describe('cola de la cocina', () => {
  const cuenta = (c: Partial<Cuenta>): Cuenta => ({
    id: 'c',
    restauranteId: RESTAURANTE,
    mesaToken: 't',
    numeroMesa: 1,
    estado: 'abierta',
    lineas: [],
    division: null,
    pagos: [],
    consumo: 0,
    pagado: 0,
    enCobro: 0,
    porPagar: 0,
    abiertaEn: '',
    cerradaEn: null,
    ...c,
  })

  test('agrupa por mesa con lo más antiguo primero', () => {
    const cola = colaDeCocina([
      cuenta({ id: 'a', mesaToken: 'nueva', numeroMesa: 1, lineas: [linea({ id: 'n', creadaEn: '2026-11-04T17:30:00Z' })] }),
      cuenta({
        id: 'b',
        mesaToken: 'vieja',
        numeroMesa: 5,
        lineas: [
          linea({ id: 'tarde', ronda: 2, creadaEn: '2026-11-04T17:40:00Z' }),
          linea({ id: 'temprano', ronda: 1, creadaEn: '2026-11-04T17:10:00Z', estado: 'en_preparacion' }),
        ],
      }),
    ])
    expect(cola.map((m) => m.numeroMesa)).toEqual([5, 1])
    expect(cola[0]?.lineas.map((l) => l.id)).toEqual(['temprano', 'tarde'])
  })

  test('solo lleva lo que falta por preparar', () => {
    const estados = ['pendiente', 'confirmada', 'en_preparacion', 'lista', 'entregada', 'rechazada', 'anulada'] as const
    const cola = colaDeCocina([cuenta({ lineas: estados.map((estado) => linea({ id: estado, estado })) })])
    expect(cola[0]?.lineas.map((l) => l.estado)).toEqual(['confirmada', 'en_preparacion'])
  })

  test('una cuenta pagada sigue en cocina; una cerrada no', () => {
    expect(colaDeCocina([cuenta({ estado: 'pagada', lineas: [linea({})] })])).toHaveLength(1)
    expect(colaDeCocina([cuenta({ estado: 'cerrada', lineas: [linea({})] })])).toHaveLength(0)
  })

  test('solo ofrece avanzar a en preparación y lista', () => {
    expect(avancesDeCocina(linea({ estado: 'confirmada' }))).toEqual(['en_preparacion', 'lista'])
    expect(avancesDeCocina(linea({ estado: 'en_preparacion' }))).toEqual(['lista'])
    expect(avancesDeCocina(linea({ estado: 'lista' }))).toEqual([])
  })

  test('el resumen cuenta unidades por estado', () => {
    const resumen = resumenCocina([
      cuenta({
        lineas: [
          linea({ id: 'a', cantidad: 2 }),
          linea({ id: 'b', estado: 'en_preparacion' }),
          linea({ id: 'c', estado: 'lista', cantidad: 3 }),
          linea({ id: 'd', estado: 'entregada' }),
        ],
      }),
    ])
    expect(resumen).toEqual(['2 por empezar', '1 en preparación', '3 esperando al mesero'])
  })
})
