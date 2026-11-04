// Factus Pay de mentiras: el mismo contrato, en memoria y sin red.
// Sirve para probar el camino completo `crearCobro -> marcarPagado -> consultarCobro -> factura`.
// No usa `node:crypto` a propósito: así la web también lo puede importar.

import { ErrorIntegracion, MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO } from '../contratos/reglas'
import type {
  Cobro,
  EstadoCobro,
  NotificacionCobro,
  PagadorCobro,
  ServicioCobros,
  SolicitudCobro,
} from '../contratos/tipos'

/** PNG de 1x1 transparente. Hace de QR sin red, para que la web ya tenga algo que dibujar. */
export const QR_DE_EJEMPLO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

export const LLAVE_WEBHOOK_DE_EJEMPLO = 'llave-de-ejemplo-del-webhook-de-ribu'

export const PAGADOR_DE_EJEMPLO: PagadorCobro = {
  nombre: 'Clienta De Prueba',
  tipoDocumento: 'CC',
  documento: '1000000001',
}

export interface OpcionesCobrosMock {
  /** La llave que acepta `leerWebhook`. */
  llaveWebhook?: string
  /** Reloj, para fijar las fechas en las pruebas. */
  ahora?: () => Date
}

export interface CobrosMock extends ServicioCobros {
  /** Como si el cliente ya hubiera pagado: deja el recaudo en `paid` y le pone `recaudadoEn`. */
  marcarPagado(referencia: string, pagador?: PagadorCobro | null): Cobro
  /** Los demás caminos: `started`, `failed`, `rejected` o un estado que no conocemos. */
  marcarEstado(referencia: string, estado: EstadoCobro): Cobro
  /** Deja el QR vencido, como cuando se acaba el tiempo y hay que renovarlo. */
  vencerQr(referencia: string): Cobro
  /** El cuerpo que enviaría Factus Pay, para probar el webhook sin red. */
  cuerpoWebhook(referencia: string): unknown
  /** Olvida todos los recaudos. */
  limpiar(): void
}

const iso = (fecha: Date) => fecha.toISOString()

const invalido = (mensaje: string) =>
  new ErrorIntegracion(mensaje, 'factus_pay', 'validacion', 422)

const noEncontrado = (referencia: string) =>
  new ErrorIntegracion(`No existe el recaudo ${referencia}`, 'factus_pay', 'validacion', 404)

/** Una llave Bre-B con la misma forma que las de verdad: arroba y letras en mayúscula. */
function llaveBreBDeEjemplo(numero: number) {
  const relleno = String(numero).padStart(4, '0')
  return `@RIBUMOCK${relleno}`
}

export function crearCobrosMock(opciones: OpcionesCobrosMock = {}): CobrosMock {
  const llaveWebhook = opciones.llaveWebhook ?? LLAVE_WEBHOOK_DE_EJEMPLO
  const ahora = opciones.ahora ?? (() => new Date())
  const recaudos = new Map<string, Cobro>()
  const pagadores = new Map<string, PagadorCobro | null>()
  const creados = new Map<string, string>()
  let siguiente = 1

  const vence = (segundos: number) => iso(new Date(ahora().getTime() + segundos * 1000))

  const guardar = (cobro: Cobro) => {
    recaudos.set(cobro.referencia, cobro)
    return cobro
  }

  const exigir = (referencia: string) => {
    const cobro = recaudos.get(referencia)
    if (!cobro) throw noEncontrado(referencia)
    return cobro
  }

  async function crearCobro(solicitud: SolicitudCobro): Promise<Cobro> {
    const { referencia, monto, expiraEnSegundos } = solicitud
    if (!referencia || referencia.length > 100) {
      throw invalido('La referencia va de 1 a 100 caracteres')
    }
    if (!Number.isInteger(monto) || monto < MONTO_MINIMO_COBRO || monto > MONTO_MAXIMO_COBRO) {
      throw invalido(`El monto va de ${MONTO_MINIMO_COBRO} a ${MONTO_MAXIMO_COBRO} pesos enteros`)
    }
    if (!Number.isInteger(expiraEnSegundos) || expiraEnSegundos <= 0) {
      throw invalido('La expiración va en segundos enteros y positivos')
    }

    const anterior = recaudos.get(referencia)
    if (anterior) {
      // Probado en el sandbox: otro monto con la misma referencia responde 422.
      if (anterior.monto !== monto) throw invalido('La referencia ya existe con un monto diferente.')
      // Con el QR vigente, o ya pagado, devuelve el mismo recaudo. Solo se regenera si ya venció,
      // y conserva la llave Bre-B. El estado sigue en `ready`: el vencimiento está en `qrExpiraEn`.
      const vencido = anterior.qrExpiraEn !== null && Date.parse(anterior.qrExpiraEn) <= ahora().getTime()
      if (anterior.estado === 'paid' || !vencido) return anterior
      return guardar({ ...anterior, qrExpiraEn: vence(expiraEnSegundos) })
    }

    creados.set(referencia, iso(ahora()))
    return guardar({
      referencia,
      monto,
      estado: 'ready',
      qrBase64: QR_DE_EJEMPLO,
      llaveBreB: llaveBreBDeEjemplo(siguiente++),
      qrExpiraEn: vence(expiraEnSegundos),
      recaudadoEn: null,
    })
  }

  async function consultarCobro(referencia: string): Promise<Cobro> {
    return exigir(referencia)
  }

  function leerWebhook(clave: string | null, cuerpo: unknown): NotificacionCobro {
    // El mock no cuida plata, así que compara directo. La versión en tiempo constante,
    // con `crypto.timingSafeEqual`, va en el cliente real.
    if (clave !== llaveWebhook) {
      throw new ErrorIntegracion('La llave del webhook no coincide', 'factus_pay', 'no_autorizado', 401)
    }
    const data = (cuerpo as { data?: Record<string, unknown> } | null)?.data
    const referencia = typeof data?.reference_code === 'string' ? data.reference_code : null
    if (!data || !referencia) throw invalido('El webhook llegó sin `data.reference_code`')
    const cobro = recaudos.get(referencia)
    return {
      referencia,
      monto: cobro?.monto ?? Number(data.amount ?? 0),
      recaudadoEn: cobro?.recaudadoEn ?? null,
      pagador: pagadores.get(referencia) ?? null,
    }
  }

  function marcarPagado(referencia: string, pagador: PagadorCobro | null = PAGADOR_DE_EJEMPLO): Cobro {
    const cobro = exigir(referencia)
    pagadores.set(referencia, pagador)
    return guardar({ ...cobro, estado: 'paid', recaudadoEn: iso(ahora()) })
  }

  function marcarEstado(referencia: string, estado: EstadoCobro): Cobro {
    const cobro = exigir(referencia)
    return guardar({ ...cobro, estado, recaudadoEn: estado === 'paid' ? iso(ahora()) : cobro.recaudadoEn })
  }

  function vencerQr(referencia: string): Cobro {
    const cobro = exigir(referencia)
    return guardar({ ...cobro, qrExpiraEn: iso(new Date(ahora().getTime() - 1000)) })
  }

  function cuerpoWebhook(referencia: string): unknown {
    const cobro = exigir(referencia)
    const pagador = pagadores.get(referencia) ?? null
    return {
      data: {
        reference_code: cobro.referencia,
        amount: cobro.monto,
        status: cobro.estado,
        created_at: creados.get(referencia) ?? null,
        qr_expires_at: cobro.qrExpiraEn,
        collected_at: cobro.recaudadoEn,
        qr: null,
        ...(pagador
          ? {
              payer: {
                name: pagador.nombre,
                document_type: pagador.tipoDocumento,
                document_number: pagador.documento,
              },
            }
          : {}),
      },
    }
  }

  const limpiar = () => {
    recaudos.clear()
    pagadores.clear()
    creados.clear()
    siguiente = 1
  }

  return {
    crearCobro,
    consultarCobro,
    leerWebhook,
    marcarPagado,
    marcarEstado,
    vencerQr,
    cuerpoWebhook,
    limpiar,
  }
}
