// Backend de mentiras que respeta contratos/reglas.ts. Sirve para construir y probar la web sin
// Firebase, y para la demo sin internet. El banco y la DIAN se reemplazan con `simulador`.

import {
  baseSinImpuesto,
  calcularPropina,
  calcularTotales,
  COBRO_EXPIRACION_SEGUNDOS,
  lineaSuma,
  MONTO_MAXIMO_COBRO,
  MONTO_MINIMO_COBRO,
  PARTES_MAXIMAS,
  PARTES_MINIMAS,
  PROPINA_SUGERIDA_MAXIMA,
  propinaValida,
  puedeLiberarMesa,
  puedePasar,
  repartirPartesIguales,
  saldoAcreditable,
  TRANSICIONES_LINEA,
  unidadesPorCubrir,
} from '../../../contratos/reglas'
import { ROLES_PERSONAL as ROLES_DE_PERSONAL, TIPOS_IMPUESTO } from '../../../contratos/tipos'
import type {
  Cobro,
  Comprador,
  Cuenta,
  EnvioCorreo,
  Factura,
  ItemPago,
  LineaFactura,
  LineaNota,
  LineaPedido,
  Mesa,
  Nota,
  Pago,
  Personal,
  Producto,
  Restaurante,
  ResumenPago,
  Rol,
} from '../../../contratos/tipos'
import { correoDe, compradorValido, correoValido } from './comprador'
import { comoErrorDatos, ErrorDatos, type Cancelar, type FuenteDatos, type Sesion, type Simulador } from './fuente'
import { semillaDemo, type PersonaPersonal, type Semilla } from './semilla'

export type RespuestaDian = 'emitida' | 'en_validacion' | 'rechazada'

export interface EstadoMemoria {
  restaurantes: Record<string, Restaurante>
  productos: Record<string, Producto>
  mesas: Record<string, Mesa>
  cuentas: Record<string, Cuenta>
  pagos: Record<string, Pago>
  facturas: Record<string, Factura>
  notas: Record<string, Nota>
  personal: PersonaPersonal[]
  /** Por cuenta: las unidades de cada línea que congeló la división en partes iguales. */
  coberturaDivision: Record<string, Record<string, number>>
  /** Por cuenta: la división vigente. Cada vez que se divide de nuevo cambia. */
  divisionVigente: Record<string, string>
  /** Por pago de una parte igual: la división a la que pertenece esa parte. */
  divisionDePago: Record<string, string>
  respuestaDian: RespuestaDian
  secuencia: number
}

export interface Almacen {
  leer(): EstadoMemoria | null
  guardar(estado: EstadoMemoria): void
  borrar(): void
  /** Avisa cuando otra pestaña cambió el estado. Devuelve cómo dejar de escuchar. */
  alCambiarFuera(aviso: () => void): () => void
}

export interface AlmacenSesion {
  leer(): Sesion | null
  guardar(sesion: Sesion | null): void
}

export interface OpcionesMemoria {
  semilla?: Semilla
  almacen?: Almacen
  almacenSesion?: AlmacenSesion
  ahora?: () => Date
  /** PNG en base64, sin el prefijo `data:`, como lo entrega Factus Pay. */
  dibujarQr?: (texto: string) => Promise<string>
  /** Cuándo responde la DIAN. Las pruebas la hacen responder en el acto. */
  programar?: (tarea: () => void) => void
}

const ROLES_PERSONAL: readonly Rol[] = ['mesero', 'cocina', 'admin']

function aleatorio(largo: number) {
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(largo)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => letras[b % letras.length]).join('')
}

function estadoInicial(semilla: Semilla): EstadoMemoria {
  const porId = <T,>(lista: T[], id: (item: T) => string) =>
    Object.fromEntries(lista.map((item) => [id(item), structuredClone(item)]))
  return {
    restaurantes: porId(semilla.restaurantes, (r) => r.id),
    productos: porId(semilla.productos, (p) => p.id),
    mesas: porId(semilla.mesas, (m) => m.token),
    cuentas: {},
    pagos: {},
    facturas: {},
    notas: {},
    personal: structuredClone(semilla.personal),
    coberturaDivision: {},
    divisionVigente: {},
    divisionDePago: {},
    respuestaDian: 'emitida',
    secuencia: 0,
  }
}

/** Un estado guardado por una versión anterior de la demo puede no traer los campos nuevos. */
const completar = (leido: EstadoMemoria): EstadoMemoria => ({ ...leido, divisionVigente: leido.divisionVigente ?? {}, divisionDePago: leido.divisionDePago ?? {} })

function correoInicial(comprador: Comprador): EnvioCorreo {
  const destino = correoDe(comprador)
  return { estado: destino ? 'pendiente' : 'sin_correo', destino, ultimoError: null, enviadoEn: null }
}

const sinTildes = (texto: string) => texto.normalize('NFD').replace(/[^\x20-\x7e]/g, '')

/** Un PDF de una página con texto plano. Basta para probar la descarga sin Factus. */
export function pdfDePrueba(lineas: string[]): Blob {
  const texto = lineas
    .map((linea, i) => `BT /F1 12 Tf 56 ${780 - i * 20} Td (${sinTildes(linea).replace(/[()\\]/g, '')}) Tj ET`)
    .join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = objetos.map((objeto, i) => {
    const posicion = pdf.length
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`
    return posicion
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

export function crearFuenteMemoria(opciones: OpcionesMemoria = {}): FuenteDatos & { simulador: Simulador; estado(): EstadoMemoria } {
  const ahora = opciones.ahora ?? (() => new Date())
  const programar = opciones.programar ?? ((tarea) => setTimeout(tarea, 1800))
  const dibujarQr = opciones.dibujarQr ?? (async () => null as unknown as string)
  const almacen = opciones.almacen
  const almacenSesion = opciones.almacenSesion

  const inicial = () => estadoInicial(opciones.semilla ?? semillaDemo())
  const cargar = () => {
    const leido = almacen?.leer()
    return leido ? completar(leido) : inicial()
  }
  let estado: EstadoMemoria = cargar()
  let sesion: Sesion | null = almacenSesion?.leer() ?? null
  const revisiones = new Set<() => void>()

  const fecha = () => ahora().toISOString()
  const fallar = (codigo: ErrorDatos['codigo'], mensaje?: string): never => {
    throw new ErrorDatos(codigo, mensaje)
  }

  function avisar() {
    for (const revisar of [...revisiones]) revisar()
  }

  almacen?.alCambiarFuera(() => {
    estado = cargar()
    avisar()
  })

  /** Aplica un cambio completo o ninguno, lo guarda y avisa a quienes escuchan. */
  function mutar<T>(cambio: () => T): T {
    const antes = structuredClone(estado)
    try {
      const resultado = cambio()
      almacen?.guardar(estado)
      avisar()
      return structuredClone(resultado)
    } catch (error) {
      estado = antes
      throw comoErrorDatos(error)
    }
  }

  const orden = async <T,>(cambio: () => T): Promise<T> => mutar(cambio)

  function escuchar<T>(leer: () => T, alCambiar: (valor: T) => void, alFallar: (error: ErrorDatos) => void): Cancelar {
    let ultimo: string | undefined
    let activa = true
    const revisar = () => {
      if (!activa) return
      let firma: string
      let entregar: () => void
      try {
        const valor = leer()
        firma = JSON.stringify(valor ?? null)
        entregar = () => alCambiar(JSON.parse(firma) as T)
      } catch (error) {
        const errorDatos = comoErrorDatos(error)
        firma = `error:${errorDatos.codigo}`
        entregar = () => alFallar(errorDatos)
      }
      if (firma === ultimo) return
      ultimo = firma
      entregar()
    }
    revisiones.add(revisar)
    queueMicrotask(revisar)
    return () => {
      activa = false
      revisiones.delete(revisar)
    }
  }

  // Sesión y permisos

  function cambiarSesion(nueva: Sesion | null) {
    sesion = nueva
    almacenSesion?.guardar(nueva)
    avisar()
  }

  const requerirSesion = () => sesion ?? fallar('NO_AUTORIZADO', 'Primero hay que entrar')
  const esPersonal = (s: Sesion) => ROLES_PERSONAL.includes(s.rol)

  function requerirPersonal(restauranteId: string, roles: readonly Rol[] = ROLES_PERSONAL) {
    const actual = requerirSesion()
    if (!roles.includes(actual.rol) || actual.restauranteId !== restauranteId) fallar('SIN_PERMISO')
    return actual
  }

  /** Lo que el personal lee de su restaurante, y la plataforma de cualquiera. */
  function requerirLectura(restauranteId: string, roles: readonly Rol[] = ROLES_PERSONAL) {
    const actual = requerirSesion()
    return actual.rol === 'plataforma' ? actual : requerirPersonal(restauranteId, roles)
  }

  const requerirPlataforma = () => {
    const actual = requerirSesion()
    return actual.rol === 'plataforma' ? actual : fallar('SIN_PERMISO', 'Solo quien administra Ribu')
  }

  const requerirActivo = (restauranteId: string) => {
    if (!restaurante(restauranteId).activo) fallar('RESTAURANTE_INACTIVO')
  }

  const restauranteDelPersonal = () => {
    const actual = requerirSesion()
    if (!esPersonal(actual) || !actual.restauranteId) return fallar('SIN_PERMISO')
    return actual.restauranteId
  }

  // Lecturas internas

  const mesaPorToken = (token: string) => estado.mesas[token] ?? fallar('NO_ENCONTRADO', 'La mesa no existe')
  const restaurante = (id: string) => estado.restaurantes[id] ?? fallar('NO_ENCONTRADO', 'El restaurante no existe')

  function cuentaAbierta(mesa: Mesa) {
    const cuenta = mesa.cuentaId ? estado.cuentas[mesa.cuentaId] : undefined
    return cuenta ?? fallar('NO_ENCONTRADO', 'La mesa no tiene pedido')
  }

  /** Dividir, pagar y la factura: el cliente o el mesero y la administración del restaurante, no la cocina. */
  function requerirQuienPaga(mesa: Mesa) {
    const actual = requerirSesion()
    return actual.rol === 'cliente' ? actual : requerirPersonal(mesa.restauranteId, ['mesero', 'admin'])
  }

  /** Para las órdenes del personal sobre una mesa: tiene que ser de su restaurante. */
  function mesaDelPersonal(token: string, roles?: readonly Rol[]) {
    const mesa = mesaPorToken(token)
    requerirPersonal(mesa.restauranteId, roles)
    return mesa
  }

  const linea = (cuenta: Cuenta, id: string) =>
    cuenta.lineas.find((l) => l.id === id) ?? fallar('NO_ENCONTRADO', 'Esa línea no está en la cuenta')

  const pagoDeCuenta = (cuenta: Cuenta, pagoId: string) => {
    const pago = estado.pagos[pagoId]
    return pago && pago.cuentaId === cuenta.id ? pago : fallar('NO_ENCONTRADO', 'Ese pago no es de esta mesa')
  }

  /** El pago puede ser de una cuenta ya cerrada: el cliente vuelve a ver su factura. */
  function pagoDeMesa(token: string, pagoId: string) {
    const mesa = mesaPorToken(token)
    const pago = estado.pagos[pagoId]
    return pago && pago.mesaToken === mesa.token ? pago : fallar('NO_ENCONTRADO', 'Ese pago no es de esta mesa')
  }

  function puedeVerFactura(factura: Factura) {
    const actual = requerirSesion()
    return actual.uid === factura.pagadorUid || (esPersonal(actual) && actual.restauranteId === factura.restauranteId)
  }

  // Cálculos de la cuenta

  function recalcular(cuenta: Cuenta) {
    Object.assign(cuenta, calcularTotales(cuenta.lineas, cuenta.pagos))
    if (cuenta.estado !== 'cerrada') {
      cuenta.estado = cuenta.consumo > 0 && cuenta.porPagar === 0 && cuenta.enCobro === 0 ? 'pagada' : 'abierta'
    }
  }

  const resumen = (pago: Pago): ResumenPago => ({
    id: pago.id,
    numero: pago.numero,
    parte: pago.parte,
    subtotal: pago.subtotal,
    total: pago.total,
    medio: pago.medio,
    estado: pago.estado,
    estadoFactura: pago.estadoFactura,
    incidencia: pago.incidencia,
    creadoPor: pago.creadoPor,
  })

  function guardarPago(pago: Pago) {
    estado.pagos[pago.id] = pago
    const cuenta = estado.cuentas[pago.cuentaId]
    if (!cuenta) return
    const i = cuenta.pagos.findIndex((p) => p.id === pago.id)
    if (i === -1) cuenta.pagos.push(resumen(pago))
    else cuenta.pagos[i] = resumen(pago)
    recalcular(cuenta)
  }

  /** Solo cuentan las partes de la división vigente: las de una división anterior ya no son de nadie. */
  const partesConPago = (cuenta: Cuenta, estados: readonly Pago['estado'][]) =>
    new Set(
      cuenta.pagos
        .filter(
          (p) =>
            p.parte !== null &&
            p.incidencia === null &&
            estados.includes(p.estado) &&
            estado.divisionDePago[p.id] !== undefined &&
            estado.divisionDePago[p.id] === estado.divisionVigente[cuenta.id],
        )
        .map((p) => p.parte as number),
    )

  function divisionActiva(cuenta: Cuenta) {
    if (!cuenta.division) return false
    return partesConPago(cuenta, ['pagado']).size < cuenta.division.partes
  }

  function cubrir(cuenta: Cuenta, items: readonly ItemPago[], signo: 1 | -1) {
    for (const item of items) {
      if (item.lineaId === null) continue
      const l = linea(cuenta, item.lineaId)
      l.cantidadCubierta = Math.min(Math.max(l.cantidadCubierta + signo * item.cantidad, 0), l.cantidad)
    }
  }

  const itemsLibres = (cuenta: Cuenta, items: readonly ItemPago[]) =>
    items.every((item) => item.lineaId === null || item.cantidad <= unidadesPorCubrir(linea(cuenta, item.lineaId)))

  // Factus Pay y la DIAN, simulados

  function nuevoCobro(referencia: string, monto: number): Cobro {
    const expira = new Date(ahora().getTime() + COBRO_EXPIRACION_SEGUNDOS * 1000)
    return {
      referencia,
      monto,
      estado: 'started',
      qrBase64: null,
      llaveBreB: `@ribu${aleatorio(8)}`,
      qrExpiraEn: expira.toISOString(),
      recaudadoEn: null,
    }
  }

  /** Factus Pay entrega el QR un momento después de crear el recaudo. */
  function dibujarQrDespues(tipo: 'pagos' | 'notas', id: string, llave: string) {
    void dibujarQr(llave)
      .catch(() => null)
      .then((qr) =>
        mutar(() => {
          const documento = estado[tipo][id]
          if (!documento?.cobro || documento.cobro.estado !== 'started') return
          documento.cobro.estado = 'ready'
          documento.cobro.qrBase64 = qr ?? null
        }),
      )
  }

  function tomarRespuestaDian(): RespuestaDian {
    const respuesta = estado.respuestaDian
    estado.respuestaDian = 'emitida'
    return respuesta
  }

  const hexadecimal = (largo: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(largo / 2)), (b) => b.toString(16).padStart(2, '0')).join('')

  function emitirFactura(pagoId: string) {
    mutar(() => {
      const factura = estado.facturas[pagoId]
      const pago = estado.pagos[pagoId]
      if (!factura || !pago || (factura.estado !== 'en_proceso' && factura.estado !== 'en_validacion')) return
      factura.intentos += 1
      const respuesta = tomarRespuestaDian()
      if (respuesta === 'emitida') {
        const cufe = hexadecimal(96)
        estado.secuencia += 1
        factura.estado = 'emitida'
        factura.emitidaEn = fecha()
        factura.ultimoError = null
        factura.datos = {
          numero: `SETP${990000000 + estado.secuencia}`,
          cufe,
          qrUrl: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}`,
          urlPublica: `https://ribu.demo/factura/${pagoId}`,
        }
        if (factura.correo.destino) {
          factura.correo = { ...factura.correo, estado: 'enviado', enviadoEn: fecha() }
        }
      } else if (respuesta === 'en_validacion') {
        factura.estado = 'en_validacion'
        factura.ultimoError = 'La DIAN no ha respondido. Se reintenta con la misma referencia.'
        programar(() => emitirFactura(pagoId))
      } else {
        factura.estado = 'rechazada'
        factura.ultimoError = 'Rechazo de la DIAN: el documento del comprador no es válido'
      }
      pago.estadoFactura = factura.estado
      guardarPago(pago)
    })
  }

  function emitirNota(notaId: string) {
    mutar(() => {
      const nota = estado.notas[notaId]
      if (!nota || (nota.estado !== 'en_proceso' && nota.estado !== 'en_validacion')) return
      nota.intentos += 1
      const respuesta = tomarRespuestaDian()
      if (respuesta === 'emitida') {
        const cude = hexadecimal(96)
        estado.secuencia += 1
        nota.estado = 'emitida'
        nota.emitidaEn = fecha()
        nota.ultimoError = null
        nota.numero = `${nota.tipo === 'credito' ? 'NC' : 'ND'}${estado.secuencia}`
        nota.datos = {
          numero: nota.numero,
          cude,
          qrUrl: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cude}`,
          urlPublica: `https://ribu.demo/nota/${notaId}`,
        }
        if (nota.correo.destino) nota.correo = { ...nota.correo, estado: 'enviado', enviadoEn: fecha() }
      } else if (respuesta === 'en_validacion') {
        nota.estado = 'en_validacion'
        nota.ultimoError = 'La DIAN no ha respondido. Se reintenta con la misma referencia.'
        programar(() => emitirNota(notaId))
      } else {
        nota.estado = 'rechazada'
        nota.ultimoError = 'Rechazo de la DIAN: revisa los datos de la nota'
      }
      const factura = estado.facturas[nota.pagoId]
      const enFactura = factura?.notas.find((n) => n.id === nota.id)
      if (enFactura) Object.assign(enFactura, { numero: nota.numero, estado: nota.estado })
    })
  }

  /** El pago entró: la factura se emite aparte, como haría el backend tras el webhook. */
  function marcarPagado(pago: Pago) {
    pago.estado = 'pagado'
    pago.pagadoEn = fecha()
    if (pago.cobro) {
      pago.cobro.estado = 'paid'
      pago.cobro.recaudadoEn = pago.pagadoEn
    }
    pago.estadoFactura = 'en_proceso'
    const factura = estado.facturas[pago.id]
    if (factura) factura.estado = 'en_proceso'
    guardarPago(pago)
    programar(() => emitirFactura(pago.id))
  }

  function soltarPago(pago: Pago, nuevoEstado: 'vencido' | 'cancelado') {
    pago.estado = nuevoEstado
    const cuenta = estado.cuentas[pago.cuentaId]
    if (cuenta) cubrir(cuenta, pago.items, -1)
    guardarPago(pago)
  }

  const vencido = (cobro: Cobro | null) =>
    cobro?.qrExpiraEn !== null && cobro?.qrExpiraEn !== undefined && new Date(cobro.qrExpiraEn) <= ahora()

  function revisarVencimiento(pago: Pago) {
    if (pago.estado === 'esperando_pago' && vencido(pago.cobro)) soltarPago(pago, 'vencido')
  }

  /** Quien cerró la pestaña no vuelve a consultar su cobro: antes de cobrar otra cosa se vencen los viejos. */
  function vencerCobrosViejos(cuenta: Cuenta) {
    for (const { id } of cuenta.pagos) {
      const pago = estado.pagos[id]
      if (pago) revisarVencimiento(pago)
    }
  }

  function lineasFactura(items: readonly ItemPago[], impuesto: Pago['impuesto']): LineaFactura[] {
    return items.map((item) => ({
      codigo: item.lineaId ?? 'consumo',
      descripcion: item.nombre,
      cantidad: item.cantidad,
      precioSinImpuesto: baseSinImpuesto(item.precio, impuesto),
    }))
  }

  function validarLineasNota(lineas: unknown): LineaNota[] {
    if (!Array.isArray(lineas) || lineas.length === 0) return fallar('NOTA_INVALIDA', 'La nota necesita al menos una línea')
    for (const l of lineas as LineaNota[]) {
      if (!l.descripcion?.trim() || !Number.isInteger(l.cantidad) || l.cantidad < 1 || !Number.isInteger(l.precio) || l.precio < 1) {
        fallar('NOTA_INVALIDA', 'Cada línea necesita descripción, cantidad y precio')
      }
    }
    return lineas as LineaNota[]
  }

  const simulador: Simulador = {
    pagarCobro(referencia) {
      mutar(() => {
        const nota = estado.notas[referencia]
        if (nota?.cobro && nota.estado === 'sin_emitir') {
          nota.cobro.estado = 'paid'
          nota.cobro.recaudadoEn = fecha()
          nota.estado = 'en_proceso'
          programar(() => emitirNota(nota.id))
          return
        }
        const pago = estado.pagos[referencia]
        if (!pago?.cobro || pago.estado === 'pagado') return
        if (pago.estado === 'esperando_pago') return marcarPagado(pago)
        // Llegó la plata de un QR vencido o cancelado: vale si nadie más cubrió lo mismo. Una parte
        // igual solo vale si su división sigue vigente, porque esa división es la que congela el consumo.
        const cuenta = estado.cuentas[pago.cuentaId]
        const parteLibre =
          pago.parte === null ||
          (cuenta !== undefined &&
            cuenta.division !== null &&
            estado.divisionDePago[pago.id] === estado.divisionVigente[cuenta.id] &&
            !partesConPago(cuenta, ['pagado', 'esperando_pago']).has(pago.parte))
        if (cuenta && parteLibre && itemsLibres(cuenta, pago.items)) {
          cubrir(cuenta, pago.items, 1)
          return marcarPagado(pago)
        }
        pago.estado = 'pagado'
        pago.pagadoEn = fecha()
        pago.cobro.estado = 'paid'
        pago.incidencia = 'pago_duplicado'
        guardarPago(pago)
      })
    },
    vencerCobro(referencia) {
      mutar(() => {
        const pago = estado.pagos[referencia]
        if (!pago?.cobro || pago.estado !== 'esperando_pago') return
        pago.cobro.qrExpiraEn = fecha()
        soltarPago(pago, 'vencido')
      })
    },
    elegirRespuestaDian(respuesta) {
      mutar(() => {
        estado.respuestaDian = respuesta
      })
    },
    respuestaDian: () => estado.respuestaDian,
    mesasDemo: () =>
      Object.values(estado.mesas)
        .sort((a, b) => a.numero - b.numero)
        .map(({ token, numero }) => ({ token, numero })),
    personalDemo: () => estado.personal.map(({ rol, correo, clave }) => ({ rol, correo, clave })),
    reiniciar() {
      almacen?.borrar()
      estado = inicial()
      avisar()
    },
  }

  return {
    simulador,
    estado: () => structuredClone(estado),

    // Sesiones

    escucharSesion(alCambiar) {
      return escuchar(() => sesion, alCambiar, () => {})
    },
    async entrarComoCliente() {
      if (sesion) return structuredClone(sesion)
      const nueva: Sesion = { uid: `anonimo-${aleatorio(12)}`, rol: 'cliente', restauranteId: null, nombre: null }
      cambiarSesion(nueva)
      return structuredClone(nueva)
    },
    async entrarPersonal(correo, clave) {
      const persona = estado.personal.find((p) => p.activo && p.correo === correo.trim().toLowerCase() && p.clave === clave)
      if (!persona) return fallar('NO_AUTORIZADO', 'Correo o clave incorrectos')
      const nueva: Sesion = { uid: persona.uid, rol: persona.rol, restauranteId: persona.restauranteId, nombre: persona.nombre }
      cambiarSesion(nueva)
      return structuredClone(nueva)
    },
    async salir() {
      cambiarSesion(null)
    },

    // Lecturas

    // Como en Firestore, nada se lee sin sesión.
    escucharMesa: (token, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirSesion()
          return estado.mesas[token] ?? null
        },
        alCambiar,
        alFallar,
      ),
    escucharRestaurante: (id, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirSesion()
          return estado.restaurantes[id] ?? null
        },
        alCambiar,
        alFallar,
      ),
    escucharProductos: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirSesion()
          return Object.values(estado.productos).filter((p) => p.restauranteId === restauranteId)
        },
        alCambiar,
        alFallar,
      ),
    escucharCuenta: (restauranteId, cuentaId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirSesion()
          const cuenta = estado.cuentas[cuentaId]
          return cuenta?.restauranteId === restauranteId ? cuenta : null
        },
        alCambiar,
        alFallar,
      ),
    escucharPago: (restauranteId, pagoId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirSesion()
          const pago = estado.pagos[pagoId]
          return pago?.restauranteId === restauranteId ? pago : null
        },
        alCambiar,
        alFallar,
      ),
    escucharFactura: (restauranteId, pagoId, alCambiar, alFallar) =>
      escuchar(
        () => {
          const factura = estado.facturas[pagoId]
          if (!factura || factura.restauranteId !== restauranteId) return null
          return requerirSesion().rol === 'plataforma' || puedeVerFactura(factura)
            ? factura
            : fallar('SIN_PERMISO', 'Solo quien pagó ve su factura')
        },
        alCambiar,
        alFallar,
      ),
    escucharMesas: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirLectura(restauranteId)
          return Object.values(estado.mesas)
            .filter((m) => m.restauranteId === restauranteId)
            .sort((a, b) => a.numero - b.numero)
        },
        alCambiar,
        alFallar,
      ),
    escucharCuentasAbiertas: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirLectura(restauranteId)
          return Object.values(estado.cuentas).filter((c) => c.restauranteId === restauranteId && c.estado !== 'cerrada')
        },
        alCambiar,
        alFallar,
      ),
    escucharPagos: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          // Se pueden leer de a uno con su id, pero solo el administrador y la plataforma los listan.
          requerirLectura(restauranteId, ['admin'])
          return Object.values(estado.pagos)
            .filter((p) => p.restauranteId === restauranteId)
            .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
        },
        alCambiar,
        alFallar,
      ),
    escucharFacturas: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirLectura(restauranteId, ['admin'])
          return Object.values(estado.facturas).filter((f) => f.restauranteId === restauranteId)
        },
        alCambiar,
        alFallar,
      ),
    escucharNotas: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirLectura(restauranteId, ['admin'])
          return Object.values(estado.notas)
            .filter((n) => n.restauranteId === restauranteId)
            .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))
        },
        alCambiar,
        alFallar,
      ),
    escucharPersonal: (restauranteId, alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirLectura(restauranteId, ['admin'])
          return personalDe(restauranteId)
        },
        alCambiar,
        alFallar,
      ),
    escucharRestaurantes: (alCambiar, alFallar) =>
      escuchar(
        () => {
          requerirPlataforma()
          return Object.values(estado.restaurantes).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        },
        alCambiar,
        alFallar,
      ),

    // Pedido

    agregarLineas: (token, solicitud) =>
      orden(() => {
        const actual = requerirSesion()
        const mesa = mesaPorToken(token)
        const delPersonal = esPersonal(actual)
        if (delPersonal) requerirPersonal(mesa.restauranteId, ['mesero', 'admin'])
        else if (actual.rol !== 'cliente') fallar('SIN_PERMISO')
        requerirActivo(mesa.restauranteId)
        const items = solicitud?.items
        if (!Array.isArray(items) || items.length === 0) return fallar('CUERPO_INVALIDO', 'El pedido está vacío')

        const pedidas = new Map<string, number>()
        for (const item of items) {
          if (!Number.isInteger(item.cantidad) || item.cantidad < 1) fallar('CUERPO_INVALIDO', 'Cantidad inválida')
          const producto = estado.productos[item.productoId]
          if (!producto || producto.restauranteId !== mesa.restauranteId) fallar('NO_ENCONTRADO', 'Ese producto no está en la carta')
          if (!producto.disponible) fallar('PRODUCTO_NO_DISPONIBLE', `${producto.nombre} está agotado`)
          pedidas.set(producto.id, (pedidas.get(producto.id) ?? 0) + item.cantidad)
          if (producto.stock !== null && (pedidas.get(producto.id) ?? 0) > producto.stock) {
            fallar('STOCK_INSUFICIENTE', `Solo quedan ${producto.stock} de ${producto.nombre}`)
          }
        }

        let cuenta = mesa.cuentaId ? estado.cuentas[mesa.cuentaId] : undefined
        if (!cuenta || cuenta.estado === 'cerrada') {
          cuenta = {
            id: `cuenta-${aleatorio(16)}`,
            restauranteId: mesa.restauranteId,
            mesaToken: mesa.token,
            numeroMesa: mesa.numero,
            estado: 'abierta',
            lineas: [],
            division: null,
            pagos: [],
            consumo: 0,
            pagado: 0,
            enCobro: 0,
            porPagar: 0,
            abiertaEn: fecha(),
            cerradaEn: null,
          }
          estado.cuentas[cuenta.id] = cuenta
          mesa.estado = 'ocupada'
          mesa.cuentaId = cuenta.id
        }

        const ronda = Math.max(0, ...cuenta.lineas.map((l) => l.ronda)) + 1
        for (const item of items) {
          const producto = estado.productos[item.productoId] as Producto
          const nueva: LineaPedido = {
            id: `linea-${aleatorio(10)}`,
            productoId: producto.id,
            nombre: producto.nombre,
            precio: producto.precio,
            cantidad: item.cantidad,
            nota: item.nota?.trim() || null,
            ronda,
            estado: delPersonal ? 'confirmada' : 'pendiente',
            origen: delPersonal ? 'personal' : 'cliente',
            motivo: null,
            cantidadCubierta: 0,
            creadaEn: fecha(),
          }
          if (delPersonal) bajarStock(producto, nueva.cantidad)
          cuenta.lineas.push(nueva)
        }
        recalcular(cuenta)
        return cuenta
      }),

    confirmarLineas: (token, solicitud) =>
      orden(() => {
        const cuenta = cuentaAbierta(mesaDelPersonal(token, ['mesero', 'admin']))
        const lineas = idsValidos(solicitud?.lineaIds).map((id) => linea(cuenta, id))
        for (const l of lineas) {
          if (!puedePasar(TRANSICIONES_LINEA, l.estado, 'confirmada')) fallar('TRANSICION_INVALIDA', `${l.nombre} ya no está por confirmar`)
          const producto = estado.productos[l.productoId]
          if (producto) bajarStock(producto, l.cantidad)
          l.estado = 'confirmada'
        }
        recalcular(cuenta)
        return cuenta
      }),

    rechazarLineas: (token, solicitud) =>
      orden(() => {
        const cuenta = cuentaAbierta(mesaDelPersonal(token, ['mesero', 'admin']))
        const motivo = motivoValido(solicitud?.motivo)
        for (const l of idsValidos(solicitud?.lineaIds).map((id) => linea(cuenta, id))) {
          if (!puedePasar(TRANSICIONES_LINEA, l.estado, 'rechazada')) fallar('TRANSICION_INVALIDA', `${l.nombre} ya no está por confirmar`)
          l.estado = 'rechazada'
          l.motivo = motivo
        }
        recalcular(cuenta)
        return cuenta
      }),

    anularLineas: (token, solicitud) =>
      orden(() => {
        const cuenta = cuentaAbierta(mesaDelPersonal(token, ['mesero', 'admin']))
        const motivo = motivoValido(solicitud?.motivo)
        for (const l of idsValidos(solicitud?.lineaIds).map((id) => linea(cuenta, id))) {
          if (!puedePasar(TRANSICIONES_LINEA, l.estado, 'anulada')) fallar('TRANSICION_INVALIDA', `${l.nombre} no se puede anular`)
          if (l.cantidadCubierta > 0) fallar('LINEA_CON_PAGO', `${l.nombre} ya está en un pago`)
          const producto = estado.productos[l.productoId]
          if (producto?.stock !== null && producto !== undefined) {
            if (producto.stock === 0) producto.disponible = true
            producto.stock = (producto.stock ?? 0) + l.cantidad
          }
          l.estado = 'anulada'
          l.motivo = motivo
        }
        recalcular(cuenta)
        return cuenta
      }),

    avanzarLinea: (token, lineaId, solicitud) =>
      orden(() => {
        const cuenta = cuentaAbierta(mesaDelPersonal(token, ['cocina', 'mesero', 'admin']))
        const l = linea(cuenta, lineaId)
        const hacia = solicitud?.estado
        if (!['en_preparacion', 'lista', 'entregada'].includes(hacia)) fallar('CUERPO_INVALIDO')
        if (!puedePasar(TRANSICIONES_LINEA, l.estado, hacia)) fallar('TRANSICION_INVALIDA', `${l.nombre} no puede pasar a ${hacia}`)
        l.estado = hacia
        return cuenta
      }),

    // División y pagos

    dividirEnPartesIguales: (token, solicitud) =>
      orden(() => {
        const mesa = mesaPorToken(token)
        requerirQuienPaga(mesa)
        const cuenta = cuentaAbierta(mesa)
        vencerCobrosViejos(cuenta)
        const partes = solicitud?.partes
        if (!Number.isInteger(partes) || partes < PARTES_MINIMAS || partes > PARTES_MAXIMAS) {
          fallar('CUERPO_INVALIDO', `La cuenta se divide entre ${PARTES_MINIMAS} y ${PARTES_MAXIMAS}`)
        }
        if (cuenta.division) {
          if (divisionActiva(cuenta) && partesConPago(cuenta, ['pagado', 'esperando_pago']).size > 0) {
            fallar('DIVISION_ACTIVA', 'Ya hay partes cobrándose o pagadas')
          }
          if (divisionActiva(cuenta)) quitarCobertura(cuenta)
          else delete estado.coberturaDivision[cuenta.id]
        }
        if (cuenta.enCobro > 0) fallar('PAGO_EN_CURSO', 'Hay un cobro activo en la mesa')
        if (cuenta.porPagar === 0) fallar('NADA_POR_PAGAR')
        const montos = repartirPartesIguales(cuenta.porPagar, partes)
        if (Math.min(...montos) < MONTO_MINIMO_COBRO) fallar('MONTO_FUERA_DE_RANGO', 'Cada parte quedaría por debajo del mínimo')
        const cobertura: Record<string, number> = {}
        for (const l of cuenta.lineas) {
          const libres = unidadesPorCubrir(l)
          if (libres > 0) {
            cobertura[l.id] = libres
            l.cantidadCubierta += libres
          }
        }
        estado.coberturaDivision[cuenta.id] = cobertura
        estado.divisionVigente[cuenta.id] = `division-${aleatorio(10)}`
        cuenta.division = { partes, montos }
        recalcular(cuenta)
        return cuenta
      }),

    quitarDivision: (token) =>
      orden(() => {
        const mesa = mesaPorToken(token)
        requerirQuienPaga(mesa)
        const cuenta = cuentaAbierta(mesa)
        if (!cuenta.division) return cuenta
        vencerCobrosViejos(cuenta)
        if (!divisionActiva(cuenta)) {
          // Todas las partes están pagadas: lo que cubrían queda cubierto y lo nuevo se paga como saldo.
          delete estado.coberturaDivision[cuenta.id]
        } else {
          if (partesConPago(cuenta, ['pagado', 'esperando_pago']).size > 0) {
            fallar('DIVISION_ACTIVA', 'Ya hay partes cobrándose o pagadas')
          }
          quitarCobertura(cuenta)
        }
        delete estado.divisionVigente[cuenta.id]
        cuenta.division = null
        recalcular(cuenta)
        return cuenta
      }),

    crearPago: (token, solicitud) =>
      orden(() => {
        const mesa = mesaPorToken(token)
        const actual = requerirQuienPaga(mesa)
        const cuenta = cuentaAbierta(mesa)
        vencerCobrosViejos(cuenta)
        const { destino, propinaPorcentaje, comprador, medio } = solicitud ?? {}
        if (!destino || !comprador || !medio) return fallar('CUERPO_INVALIDO')
        if (medio !== 'factus_pay') requerirPersonal(mesa.restauranteId, ['mesero', 'admin'])
        requerirActivo(mesa.restauranteId)
        if (!propinaValida(propinaPorcentaje)) fallar('PROPINA_INVALIDA', 'La propina es un porcentaje entero de 0 a 100')
        if (!compradorValido(comprador)) fallar('COMPRADOR_INVALIDO', 'Revisa los datos de la factura')
        const { impuesto } = restaurante(mesa.restauranteId)

        let items: ItemPago[]
        let parte: number | null = null
        if (destino.tipo === 'saldo') {
          if (divisionActiva(cuenta)) fallar('DIVISION_ACTIVA', 'La cuenta está dividida: paga una parte')
          const libres = cuenta.lineas.filter((l) => unidadesPorCubrir(l) > 0)
          if (libres.length === 0) fallar(cuenta.enCobro > 0 ? 'PAGO_EN_CURSO' : 'NADA_POR_PAGAR')
          items = libres.map((l) => ({ lineaId: l.id, nombre: l.nombre, cantidad: unidadesPorCubrir(l), precio: l.precio }))
        } else if (destino.tipo === 'productos') {
          if (!Array.isArray(destino.items) || destino.items.length === 0) return fallar('CUERPO_INVALIDO')
          const cantidades = new Map<string, number>()
          for (const item of destino.items) {
            if (!Number.isInteger(item.cantidad) || item.cantidad < 1) fallar('CUERPO_INVALIDO')
            cantidades.set(item.lineaId, (cantidades.get(item.lineaId) ?? 0) + item.cantidad)
          }
          items = [...cantidades].map(([lineaId, cantidad]) => {
            const l = linea(cuenta, lineaId)
            if (!lineaSuma(l.estado) || cantidad > l.cantidad) {
              fallar('CANTIDAD_NO_DISPONIBLE', `De ${l.nombre} no hay tantas unidades por pagar`)
            }
            if (cantidad > unidadesPorCubrir(l)) fallar('PAGO_EN_CURSO', `${l.nombre} ya está en otro pago`)
            return { lineaId, nombre: l.nombre, cantidad, precio: l.precio }
          })
        } else if (destino.tipo === 'parte_igual') {
          const division = cuenta.division
          parte = destino.parte
          if (!division || !Number.isInteger(parte) || parte < 1 || parte > division.partes) return fallar('PARTE_NO_DISPONIBLE')
          if (partesConPago(cuenta, ['pagado']).has(parte)) fallar('PARTE_NO_DISPONIBLE', 'Esa parte ya está pagada')
          if (partesConPago(cuenta, ['esperando_pago']).has(parte)) fallar('PAGO_EN_CURSO', 'Alguien ya está pagando esa parte')
          const monto = division.montos[parte - 1] as number
          items = [{ lineaId: null, nombre: `Consumo, parte ${parte} de ${division.partes}`, cantidad: 1, precio: monto }]
        } else {
          return fallar('CUERPO_INVALIDO')
        }

        const subtotal = items.reduce((suma, item) => suma + item.precio * item.cantidad, 0)
        const propina = calcularPropina(subtotal, impuesto, propinaPorcentaje)
        const total = subtotal + propina
        if (medio === 'factus_pay' && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)) {
          fallar('MONTO_FUERA_DE_RANGO')
        }

        const numero = cuenta.pagos.length + 1
        const id = `${cuenta.id}-pago-${numero}`
        const pago: Pago = {
          id,
          numero,
          parte,
          subtotal,
          total,
          medio,
          estado: 'esperando_pago',
          estadoFactura: 'sin_emitir',
          incidencia: null,
          creadoPor: actual.uid,
          restauranteId: mesa.restauranteId,
          cuentaId: cuenta.id,
          mesaToken: mesa.token,
          destino: structuredClone(destino),
          items,
          impuesto: { ...impuesto },
          baseSinImpuesto: baseSinImpuesto(subtotal, impuesto),
          propinaPorcentaje,
          propina,
          cobro: medio === 'factus_pay' ? nuevoCobro(id, total) : null,
          creadoEn: fecha(),
          pagadoEn: null,
        }
        estado.facturas[id] = {
          pagoId: id,
          restauranteId: mesa.restauranteId,
          pagadorUid: actual.uid,
          estado: 'sin_emitir',
          comprador: structuredClone(comprador),
          datos: null,
          intentos: 0,
          ultimoError: null,
          correo: correoInicial(comprador),
          pagador: null,
          notas: [],
          emitidaEn: null,
        }
        if (parte !== null) estado.divisionDePago[id] = estado.divisionVigente[cuenta.id] as string
        cubrir(cuenta, items, 1)
        guardarPago(pago)
        if (pago.cobro) dibujarQrDespues('pagos', id, pago.cobro.llaveBreB as string)
        else marcarPagado(pago)
        return pago
      }),

    verificarPago: (token, pagoId) =>
      orden(() => {
        requerirQuienPaga(mesaPorToken(token))
        const pago = pagoDeMesa(token, pagoId)
        revisarVencimiento(pago)
        return pago
      }),

    cancelarPago: (token, pagoId) =>
      orden(() => {
        const mesa = mesaPorToken(token)
        const actual = requerirQuienPaga(mesa)
        const pago = pagoDeCuenta(cuentaAbierta(mesa), pagoId)
        if (pago.creadoPor !== actual.uid && actual.rol === 'cliente') {
          fallar('SIN_PERMISO', 'Solo quien creó el pago lo puede cancelar')
        }
        if (pago.estado !== 'esperando_pago') fallar('TRANSICION_INVALIDA', 'Ese pago ya no está esperando')
        soltarPago(pago, 'cancelado')
        return pago
      }),

    // Factura

    async descargarFacturaPdf(token, pagoId) {
      requerirQuienPaga(mesaPorToken(token))
      const pago = pagoDeMesa(token, pagoId)
      const factura = estado.facturas[pagoId]
      if (!factura || !puedeVerFactura(factura)) return fallar('SIN_PERMISO', 'Solo quien pagó ve su factura')
      if (factura.estado !== 'emitida' || !factura.datos) return fallar('FACTURA_NO_DISPONIBLE')
      return pdfDePrueba([
        `Factura electronica ${factura.datos.numero}`,
        `${restaurante(pago.restauranteId).nombre}`,
        `Total: ${pago.total} COP`,
        `CUFE: ${factura.datos.cufe.slice(0, 48)}`,
        factura.datos.cufe.slice(48),
        'Documento de prueba generado en memoria',
      ])
    },

    enviarFacturaPorCorreo: (token, pagoId, solicitud) =>
      orden(() => {
        requerirQuienPaga(mesaPorToken(token))
        pagoDeMesa(token, pagoId)
        const factura = estado.facturas[pagoId]
        if (!factura || !puedeVerFactura(factura)) return fallar('SIN_PERMISO', 'Solo quien pagó ve su factura')
        const correo = solicitud?.correo?.trim() ?? ''
        if (!correoValido(correo)) fallar('CUERPO_INVALIDO', 'Ese correo no parece válido')
        if (factura.estado !== 'emitida') fallar('FACTURA_NO_DISPONIBLE')
        factura.correo = { estado: 'enviado', destino: correo, ultimoError: null, enviadoEn: fecha() }
        return factura
      }),

    reintentarFactura: (token, pagoId, solicitud) =>
      orden(() => {
        const mesa = mesaPorToken(token)
        requerirPersonal(mesa.restauranteId, ['mesero', 'admin'])
        const pago = pagoDeMesa(token, pagoId)
        const factura = estado.facturas[pagoId] ?? fallar('NO_ENCONTRADO')
        if (factura.estado !== 'rechazada') fallar('TRANSICION_INVALIDA', 'Solo se reintenta una factura rechazada')
        if (solicitud?.comprador) {
          if (!compradorValido(solicitud.comprador)) fallar('COMPRADOR_INVALIDO')
          factura.comprador = structuredClone(solicitud.comprador)
          factura.correo = correoInicial(solicitud.comprador)
        }
        factura.estado = 'en_proceso'
        factura.ultimoError = null
        pago.estadoFactura = 'en_proceso'
        guardarPago(pago)
        programar(() => emitirFactura(pagoId))
        return factura
      }),

    liberarMesa: (token) =>
      orden(() => {
        const mesa = mesaDelPersonal(token, ['mesero', 'admin'])
        if (mesa.estado === 'libre' || !mesa.cuentaId) return mesa
        const cuenta = estado.cuentas[mesa.cuentaId]
        if (cuenta) {
          vencerCobrosViejos(cuenta)
          if (!puedeLiberarMesa(cuenta)) fallar('MESA_CON_SALDO', 'La mesa tiene pedidos por confirmar, cobros activos o saldo')
          cuenta.estado = 'cerrada'
          cuenta.cerradaEn = fecha()
        }
        mesa.estado = 'libre'
        mesa.cuentaId = null
        return mesa
      }),

    // Plataforma

    crearRestaurante: (nuevo) =>
      orden(() => {
        requerirPlataforma()
        validarRestaurante(nuevo)
        if (!Number.isInteger(nuevo.mesas) || nuevo.mesas < 1) fallar('CUERPO_INVALIDO', 'Debe tener al menos una mesa')
        estado.secuencia += 1
        const creado: Restaurante = {
          id: `${aSlug(nuevo.nombre) || 'restaurante'}-${estado.secuencia}`,
          nombre: nuevo.nombre.trim(),
          impuesto: { ...nuevo.impuesto },
          propinasSugeridas: [...nuevo.propinasSugeridas],
          activo: true,
        }
        estado.restaurantes[creado.id] = creado
        return { restaurante: creado, mesas: crearMesas(creado.id, nuevo.mesas) }
      }),

    actualizarRestaurante: (restauranteId, cambios) =>
      orden(() => {
        const actual = restaurante(restauranteId)
        requerirLectura(restauranteId, ['admin'])
        if (requerirSesion().rol !== 'plataforma' && cambios?.activo !== undefined) {
          fallar('SIN_PERMISO', 'Solo la plataforma activa o desactiva un restaurante')
        }
        const nuevo: Restaurante = { ...actual, ...cambios, id: actual.id }
        validarRestaurante(nuevo)
        estado.restaurantes[restauranteId] = nuevo
        return nuevo
      }),

    agregarMesas: (restauranteId, solicitud) =>
      orden(() => {
        restaurante(restauranteId)
        requerirLectura(restauranteId, ['admin'])
        const cantidad = solicitud?.cantidad
        if (!Number.isInteger(cantidad) || cantidad < 1) return fallar('CUERPO_INVALIDO', 'Debe ser al menos una mesa')
        return crearMesas(restauranteId, cantidad)
      }),

    crearPersonal: (restauranteId, nuevo) =>
      orden(() => {
        restaurante(restauranteId)
        requerirLectura(restauranteId, ['admin'])
        const correo = nuevo?.correo?.trim().toLowerCase() ?? ''
        if (!correoValido(correo) || !nuevo.nombre?.trim() || !ROLES_DE_PERSONAL.includes(nuevo.rol)) {
          fallar('CUERPO_INVALIDO', 'Revisa el correo, el nombre y el rol')
        }
        validarClave(nuevo.clave)
        if (estado.personal.some((p) => p.correo === correo)) fallar('CORREO_EN_USO')
        const persona: PersonaPersonal = {
          uid: `personal-${aleatorio(12)}`,
          correo,
          clave: nuevo.clave,
          rol: nuevo.rol,
          nombre: nuevo.nombre.trim(),
          restauranteId,
          activo: true,
          creadoEn: fecha(),
        }
        estado.personal.push(persona)
        return aPersonal(persona)
      }),

    actualizarPersonal: (restauranteId, uid, cambios) =>
      orden(() => {
        restaurante(restauranteId)
        requerirLectura(restauranteId, ['admin'])
        const persona = estado.personal.find((p) => p.uid === uid && p.restauranteId === restauranteId) ?? fallar('NO_ENCONTRADO')
        if (cambios?.rol !== undefined && !ROLES_DE_PERSONAL.includes(cambios.rol)) fallar('CUERPO_INVALIDO', 'Ese rol no existe')
        if (cambios?.nombre !== undefined && !cambios.nombre.trim()) fallar('CUERPO_INVALIDO', 'Falta el nombre')
        if (cambios?.clave !== undefined) validarClave(cambios.clave)
        Object.assign(persona, cambios)
        return aPersonal(persona)
      }),

    // Carta

    crearProducto: (nuevo) =>
      orden(() => {
        const restauranteId = restauranteDelPersonal()
        requerirPersonal(restauranteId, ['admin'])
        validarProducto(nuevo)
        estado.secuencia += 1
        const base = nuevo.nombre
          .normalize('NFD')
          .replace(/[^\w\s-]/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
        const producto: Producto = { ...nuevo, id: `${base || 'producto'}-${estado.secuencia}`, restauranteId }
        if (producto.stock === 0) producto.disponible = false
        estado.productos[producto.id] = producto
        return producto
      }),

    actualizarProducto: (productoId, cambios) =>
      orden(() => {
        const producto = estado.productos[productoId] ?? fallar('NO_ENCONTRADO')
        const actual = requerirPersonal(producto.restauranteId, ['mesero', 'cocina', 'admin'])
        const claves = Object.keys(cambios ?? {})
        if (actual.rol !== 'admin' && claves.some((clave) => clave !== 'disponible')) {
          fallar('SIN_PERMISO', 'Solo administración cambia algo distinto de "agotado"')
        }
        const nuevo = { ...producto, ...cambios }
        validarProducto(nuevo)
        if (cambios?.stock === 0) nuevo.disponible = false
        estado.productos[productoId] = nuevo
        return nuevo
      }),

    borrarProducto: (productoId) =>
      orden(() => {
        const producto = estado.productos[productoId] ?? fallar('NO_ENCONTRADO')
        requerirPersonal(producto.restauranteId, ['admin'])
        delete estado.productos[productoId]
      }),

    // Notas

    crearNota: (pagoId, solicitud) =>
      orden(() => {
        const pago = estado.pagos[pagoId] ?? fallar('NO_ENCONTRADO')
        const actual = requerirPersonal(pago.restauranteId, ['admin'])
        const factura = estado.facturas[pagoId]
        if (!factura || factura.estado !== 'emitida' || !factura.datos) return fallar('FACTURA_NO_DISPONIBLE')
        const motivo = solicitud?.motivo?.trim()
        if (!motivo) return fallar('NOTA_INVALIDA', 'La nota necesita un motivo')

        const anulacion = solicitud.tipo === 'credito' && solicitud.concepto === 'anulacion'
        let lineas: LineaFactura[]
        let total: number
        if (anulacion) {
          lineas = lineasFactura(pago.items, pago.impuesto)
          total = pago.total
        } else {
          const deNota = validarLineasNota('lineas' in solicitud ? solicitud.lineas : null)
          lineas = deNota.map((l, i) => ({
            codigo: `nota-${i + 1}`,
            descripcion: l.descripcion.trim(),
            cantidad: l.cantidad,
            precioSinImpuesto: baseSinImpuesto(l.precio, pago.impuesto),
          }))
          total = deNota.reduce((suma, l) => suma + l.precio * l.cantidad, 0)
        }
        if (solicitud.tipo === 'credito' && total > saldoAcreditable(pago.total, factura.notas)) {
          fallar('NOTA_EXCEDE_FACTURA', 'La nota supera lo que queda por acreditar')
        }
        const medio = solicitud.tipo === 'debito' ? solicitud.medio : pago.medio
        const conCobro = solicitud.tipo === 'debito' && medio === 'factus_pay'
        if (conCobro && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)) fallar('MONTO_FUERA_DE_RANGO')

        const id = `${pagoId}-nota-${factura.notas.length + 1}`
        const nota: Nota = {
          id,
          tipo: solicitud.tipo,
          numero: null,
          total,
          estado: conCobro ? 'sin_emitir' : 'en_proceso',
          concepto: solicitud.concepto,
          motivo,
          restauranteId: pago.restauranteId,
          pagoId,
          numeroFactura: factura.datos.numero,
          comprador: structuredClone(factura.comprador),
          lineas,
          impuesto: { ...pago.impuesto },
          propina: anulacion && pago.propina > 0 ? { base: pago.baseSinImpuesto, valor: pago.propina } : null,
          medio,
          cobro: conCobro ? nuevoCobro(id, total) : null,
          devolucion: solicitud.tipo === 'credito' ? 'pendiente' : 'no_aplica',
          datos: null,
          intentos: 0,
          ultimoError: null,
          correo: correoInicial(factura.comprador),
          creadoPor: actual.uid,
          creadaEn: fecha(),
          emitidaEn: null,
        }
        estado.notas[id] = nota
        factura.notas.push({ id, tipo: nota.tipo, numero: null, total, estado: nota.estado })
        if (nota.cobro) dibujarQrDespues('notas', id, nota.cobro.llaveBreB as string)
        else programar(() => emitirNota(id))
        return nota
      }),

    verificarNota: (notaId) =>
      orden(() => {
        const nota = estado.notas[notaId] ?? fallar('NO_ENCONTRADO')
        requerirPersonal(nota.restauranteId, ['admin'])
        return nota
      }),

    reintentarNota: (notaId, solicitud) =>
      orden(() => {
        const nota = estado.notas[notaId] ?? fallar('NO_ENCONTRADO')
        requerirPersonal(nota.restauranteId, ['admin'])
        if (nota.estado !== 'rechazada') fallar('TRANSICION_INVALIDA', 'Solo se reintenta una nota rechazada')
        if (solicitud?.comprador) {
          if (!compradorValido(solicitud.comprador)) fallar('COMPRADOR_INVALIDO')
          nota.comprador = structuredClone(solicitud.comprador)
          nota.correo = correoInicial(solicitud.comprador)
        }
        nota.estado = 'en_proceso'
        nota.ultimoError = null
        const enFactura = estado.facturas[nota.pagoId]?.notas.find((n) => n.id === notaId)
        if (enFactura) enFactura.estado = 'en_proceso'
        programar(() => emitirNota(notaId))
        return nota
      }),

    marcarDevolucionHecha: (notaId) =>
      orden(() => {
        const nota = estado.notas[notaId] ?? fallar('NO_ENCONTRADO')
        requerirPersonal(nota.restauranteId, ['admin'])
        if (nota.devolucion !== 'pendiente') fallar('TRANSICION_INVALIDA', 'Esa nota no tiene devolución pendiente')
        nota.devolucion = 'hecha'
        return nota
      }),

    enviarNotaPorCorreo: (notaId, solicitud) =>
      orden(() => {
        const nota = estado.notas[notaId] ?? fallar('NO_ENCONTRADO')
        requerirPersonal(nota.restauranteId, ['admin'])
        const correo = solicitud?.correo?.trim() ?? ''
        if (!correoValido(correo)) fallar('CUERPO_INVALIDO', 'Ese correo no parece válido')
        if (nota.estado !== 'emitida') fallar('FACTURA_NO_DISPONIBLE')
        nota.correo = { estado: 'enviado', destino: correo, ultimoError: null, enviadoEn: fecha() }
        return nota
      }),

    async descargarNotaPdf(notaId) {
      const nota = estado.notas[notaId] ?? fallar('NO_ENCONTRADO')
      requerirPersonal(nota.restauranteId, ['admin'])
      if (nota.estado !== 'emitida' || !nota.datos) return fallar('FACTURA_NO_DISPONIBLE')
      return pdfDePrueba([
        `Nota ${nota.tipo === 'credito' ? 'credito' : 'debito'} ${nota.datos.numero}`,
        `Corrige la factura ${nota.numeroFactura}`,
        `Total: ${nota.total} COP`,
        `Motivo: ${nota.motivo}`,
        'Documento de prueba generado en memoria',
      ])
    },
  }

  function crearMesas(restauranteId: string, cantidad: number): Mesa[] {
    const ultima = Math.max(0, ...Object.values(estado.mesas).filter((m) => m.restauranteId === restauranteId).map((m) => m.numero))
    return Array.from({ length: cantidad }, (_, i) => {
      const mesa: Mesa = { token: `mesa-${aleatorio(16)}`, restauranteId, numero: ultima + i + 1, estado: 'libre', cuentaId: null }
      estado.mesas[mesa.token] = mesa
      return mesa
    })
  }

  /** La clave se queda en el estado interno: nunca sale en una lectura ni en una respuesta. */
  function aPersonal(persona: PersonaPersonal): Personal {
    const { uid, correo, nombre, rol, activo, creadoEn } = persona
    return { uid, restauranteId: persona.restauranteId as string, correo, nombre, rol: rol as Personal['rol'], activo, creadoEn }
  }

  function personalDe(restauranteId: string) {
    return estado.personal.filter((p) => p.restauranteId === restauranteId).map(aPersonal)
  }

  function validarRestaurante(datos: Pick<Restaurante, 'nombre' | 'impuesto' | 'propinasSugeridas'>) {
    if (!datos?.nombre?.trim()) fallar('CUERPO_INVALIDO', 'Falta el nombre')
    if (!TIPOS_IMPUESTO.includes(datos.impuesto?.tipo) || !(datos.impuesto?.porcentaje >= 0)) fallar('CUERPO_INVALIDO', 'Revisa el impuesto')
    const propinas = datos.propinasSugeridas
    if (!Array.isArray(propinas) || propinas.some((p) => !propinaValida(p) || p > PROPINA_SUGERIDA_MAXIMA)) {
      fallar('CUERPO_INVALIDO', `Las propinas sugeridas no pueden pasar del ${PROPINA_SUGERIDA_MAXIMA} %`)
    }
  }

  function validarClave(clave: unknown) {
    if (typeof clave !== 'string' || clave.length < 8) fallar('CUERPO_INVALIDO', 'La clave necesita al menos 8 caracteres')
  }

  function aSlug(nombre: string) {
    return nombre
      .normalize('NFD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
  }

  function bajarStock(producto: Producto, cantidad: number) {
    if (producto.stock === null) return
    if (cantidad > producto.stock) fallar('STOCK_INSUFICIENTE', `Solo quedan ${producto.stock} de ${producto.nombre}`)
    producto.stock -= cantidad
    if (producto.stock === 0) producto.disponible = false
  }

  function quitarCobertura(cuenta: Cuenta) {
    const cobertura = estado.coberturaDivision[cuenta.id] ?? {}
    for (const [lineaId, unidades] of Object.entries(cobertura)) {
      const l = cuenta.lineas.find((x) => x.id === lineaId)
      if (l) l.cantidadCubierta = Math.max(l.cantidadCubierta - unidades, 0)
    }
    delete estado.coberturaDivision[cuenta.id]
  }

  function idsValidos(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      return fallar('CUERPO_INVALIDO', 'Elige al menos una línea')
    }
    return [...new Set(ids as string[])]
  }

  function motivoValido(motivo: unknown) {
    if (typeof motivo !== 'string' || motivo.trim().length === 0) return fallar('CUERPO_INVALIDO', 'Escribe el motivo')
    return motivo.trim()
  }

  function validarProducto(producto: Omit<Producto, 'id' | 'restauranteId'>) {
    if (!producto.nombre?.trim() || !producto.categoria?.trim()) fallar('CUERPO_INVALIDO', 'Falta el nombre o la categoría')
    if (!Number.isInteger(producto.precio) || producto.precio < 1) fallar('CUERPO_INVALIDO', 'El precio es un entero en pesos')
    if (producto.stock !== null && (!Number.isInteger(producto.stock) || producto.stock < 0)) {
      fallar('CUERPO_INVALIDO', 'El stock es un entero desde 0')
    }
  }
}
