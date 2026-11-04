// Entrada de Cloud Functions. `npm run build:functions` empaqueta este archivo en functions/lib/index.js.

import { randomUUID } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { crearCobrosFactusPay } from '../cobros/cliente'
import { crearFacturacionFactus } from '../facturacion/cliente'
import { crearApi } from './api'
import { crearAuthFirebase } from './auth'
import { crearBaseFirestore } from './base-firestore'
import { debeEmitir, procesarDocumento } from './documentos'
import { CLAVE_SEMILLA_EMULADOR, crearCobrosCompartidos, crearFacturacionCompartida, LLAVE_WEBHOOK_MOCK } from './mocks-compartidos'
import type { Contexto } from './modelo'
import { barrer } from './programado'
import { aPeticionWeb, enviarRespuesta } from './puente'
import { recibirWebhook } from './webhook'

// Al cargar, no al usarse: los disparadores de Firestore ya necesitan la app para leer el evento.
if (getApps().length === 0) initializeApp()

const REGION = 'us-central1'
const USER_AGENT = 'ribu'
/** El webhook debe contestar en menos de 10 segundos: esta consulta deja tiempo para la transacción. */
const TIEMPO_LIMITE_FACTUS_PAY_MS = 6_000

const FACTUS_CLIENT_ID = defineSecret('FACTUS_CLIENT_ID')
const FACTUS_CLIENT_SECRET = defineSecret('FACTUS_CLIENT_SECRET')
const FACTUS_USUARIO = defineSecret('FACTUS_USUARIO')
const FACTUS_CLAVE = defineSecret('FACTUS_CLAVE')
const FACTUS_PAY_TOKEN = defineSecret('FACTUS_PAY_TOKEN')
const FACTUS_PAY_LLAVE_WEBHOOK = defineSecret('FACTUS_PAY_LLAVE_WEBHOOK')
const SEMILLA_CLAVE = defineSecret('SEMILLA_CLAVE')

const SECRETOS_FACTUS = [
  FACTUS_CLIENT_ID,
  FACTUS_CLIENT_SECRET,
  FACTUS_USUARIO,
  FACTUS_CLAVE,
  FACTUS_PAY_TOKEN,
  FACTUS_PAY_LLAVE_WEBHOOK,
]

const usarMocks = () => process.env.FUNCTIONS_EMULATOR === 'true' || process.env.RIBU_MOCKS === '1'

// Una por instancia: el token de Factus y los rangos quedan en memoria entre peticiones.
let contextoCreado: Contexto | undefined

function contexto(): Contexto {
  if (contextoCreado) return contextoCreado
  const firestore = getFirestore()
  firestore.settings({ ignoreUndefinedProperties: true })
  const db = crearBaseFirestore(firestore)
  const servicios = usarMocks()
    ? { cobros: crearCobrosCompartidos(db), facturacion: crearFacturacionCompartida(db) }
    : {
        cobros: crearCobrosFactusPay({
          url: process.env.FACTUS_PAY_URL ?? 'https://pay-api-sandbox.factus.com.co',
          token: FACTUS_PAY_TOKEN.value(),
          llaveWebhook: FACTUS_PAY_LLAVE_WEBHOOK.value(),
          userAgent: USER_AGENT,
          tiempoLimiteMs: TIEMPO_LIMITE_FACTUS_PAY_MS,
        }),
        facturacion: crearFacturacionFactus({
          url: process.env.FACTUS_URL ?? 'https://api-sandbox.factus.com.co',
          clientId: FACTUS_CLIENT_ID.value(),
          clientSecret: FACTUS_CLIENT_SECRET.value(),
          usuario: FACTUS_USUARIO.value(),
          clave: FACTUS_CLAVE.value(),
          userAgent: USER_AGENT,
        }),
      }
  contextoCreado = {
    db,
    ...servicios,
    auth: crearAuthFirebase(getAuth()),
    ahora: () => new Date(),
    nuevoId: () => randomUUID().replaceAll('-', ''),
  }
  return contextoCreado
}

let apiCreada: ReturnType<typeof crearApi> | undefined

function aplicacion() {
  apiCreada ??= crearApi(contexto(), {
    claveSemilla: () => (process.env.FUNCTIONS_EMULATOR === 'true' ? CLAVE_SEMILLA_EMULADOR : SEMILLA_CLAVE.value()),
    origenWeb: () => process.env.RIBU_URL_WEB ?? `https://${process.env.GCLOUD_PROJECT ?? 'ribu-co'}.web.app`,
    ...(usarMocks()
      ? {
          simularPago: async (ctx: Contexto, referencia: string) => {
            const cuerpo = await (ctx.cobros as ReturnType<typeof crearCobrosCompartidos>).marcarPagado(referencia)
            await recibirWebhook(ctx, LLAVE_WEBHOOK_MOCK, cuerpo)
          },
        }
      : {}),
  })
  return apiCreada
}

export const api = onRequest(
  {
    region: REGION,
    invoker: 'public',
    secrets: [...SECRETOS_FACTUS, SEMILLA_CLAVE],
    timeoutSeconds: 60,
    cors: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /\.web\.app$/, /\.firebaseapp\.com$/],
  },
  async (req, res) => {
    await enviarRespuesta(await aplicacion().fetch(aPeticionWeb(req)), res)
  },
)

const opcionesDeFondo = { region: REGION, secrets: SECRETOS_FACTUS, timeoutSeconds: 180 }

/** Vence cobros y reintenta facturas, notas y correos. También recoge lo que un disparador no alcanzó a hacer. */
export const barridoProgramado = onSchedule({ ...opcionesDeFondo, schedule: 'every 1 minutes' }, async () => {
  await barrer(contexto())
})

/** En Cloud Functions no se puede trabajar después de responder: la factura la emite este disparador. */
export const alCambiarFactura = onDocumentWritten(
  { ...opcionesDeFondo, document: 'restaurantes/{restauranteId}/facturas/{pagoId}' },
  async (evento) => {
    if (!debeEmitir(evento.data?.before.data(), evento.data?.after.data())) return
    const { restauranteId, pagoId } = evento.params
    await procesarDocumento(contexto(), { tipo: 'pago', restauranteId, id: pagoId }, { forzar: true })
  },
)

export const alCambiarNota = onDocumentWritten(
  { ...opcionesDeFondo, document: 'restaurantes/{restauranteId}/notas/{notaId}' },
  async (evento) => {
    if (!debeEmitir(evento.data?.before.data(), evento.data?.after.data())) return
    const { restauranteId, notaId } = evento.params
    await procesarDocumento(contexto(), { tipo: 'nota', restauranteId, id: notaId }, { forzar: true })
  },
)
