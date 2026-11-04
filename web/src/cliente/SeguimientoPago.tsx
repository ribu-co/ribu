import { useEffect, useState, type ReactNode } from 'react'
import { COBRO_EXPIRACION_SEGUNDOS } from '../../../contratos/reglas'
import type { Factura, Pago } from '../../../contratos/tipos'
import { correoValido } from '../datos/comprador'
import { usarFuente, usarLectura } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { usarAvisos } from '../ui/Avisos'
import { Boton } from '../ui/Controles'
import { copiar } from '../ui/copiar'
import { AvisoError, ErrorVista } from '../ui/Estados'
import { Hueso, Texto } from '../ui/Esqueletos'
import { cuentaRegresiva, pesos } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { QrImagen, QrTexto } from '../ui/Qr'
import { FACTURA_EN_CAMINO } from './cuenta'
import { SimuladorDemo } from './SimuladorDemo'
import { usarConsultaCobro, usarSegundosRestantes } from './usarConsultaCobro'

/** Lo que ve quien creó el pago: el cobro mientras espera, y su factura cuando entra el dinero. */
export function SeguimientoPago({
  token,
  pagoId,
  restauranteId,
  sesion,
  alVolver,
  alReintentar,
}: {
  token: string
  pagoId: string
  restauranteId: string
  sesion: Sesion
  alVolver: () => void
  alReintentar: () => void
}) {
  const fuente = usarFuente()
  const pago = usarLectura<Pago | null>((a, b) => fuente.escucharPago(restauranteId, pagoId, a, b), [fuente, restauranteId, pagoId])

  if (pago.estado === 'cargando') return <EsqueletoCobro />
  if (pago.estado === 'error') return <ErrorVista error={pago.error} alReintentar={alVolver} />
  if (!pago.valor) return <ErrorVista error={{ codigo: 'NO_ENCONTRADO' }} alReintentar={alVolver} />
  return <DetallePago token={token} pago={pago.valor} restauranteId={restauranteId} sesion={sesion} alVolver={alVolver} alReintentar={alReintentar} />
}

export function DetallePago({
  token,
  pago: valor,
  restauranteId,
  sesion,
  alVolver,
  alReintentar,
}: {
  token: string
  pago: Pago
  restauranteId: string
  sesion: Sesion
  alVolver: () => void
  alReintentar: () => void
}) {
  if (valor.estado === 'esperando_pago') return <VistaCobro token={token} pago={valor} />
  if (valor.estado === 'pagado' && valor.incidencia === 'pago_duplicado') {
    return (
      <Resultado icono="alerta" tono="ambar" titulo="Recibimos tu pago, pero ya estaba cubierto" alVolver={alVolver}>
        Otra persona pagó lo mismo antes. El restaurante te devuelve {pesos(valor.total)} por fuera: muéstrale esta pantalla al mesero.
      </Resultado>
    )
  }
  if (valor.estado === 'pagado') {
    return valor.creadoPor === sesion.uid ? (
      <VistaFactura token={token} pago={valor} restauranteId={restauranteId} alVolver={alVolver} />
    ) : (
      <Resultado icono="check" tono="verde" titulo="Pagado" alVolver={alVolver}>
        Este pago ya entró. La factura le llega a quien pagó.
      </Resultado>
    )
  }
  return (
    <Resultado
      icono="reloj"
      tono="gris"
      titulo={valor.estado === 'vencido' ? 'El QR venció' : valor.estado === 'cancelado' ? 'Cancelaste el cobro' : 'El cobro falló'}
      alVolver={alVolver}
      accion={
        <Boton ancho onClick={alReintentar}>
          Generar otro cobro
        </Boton>
      }
    >
      No se cobró nada. Lo que cubría vuelve a quedar libre en la cuenta.
    </Resultado>
  )
}

function Resultado({
  icono,
  tono,
  titulo,
  children,
  alVolver,
  accion,
}: {
  icono: 'check' | 'alerta' | 'reloj'
  tono: 'verde' | 'ambar' | 'gris'
  titulo: string
  children: ReactNode
  alVolver: () => void
  accion?: ReactNode
}) {
  return (
    <section className="tarjeta resultado entra">
      <span className={`resultado__icono resultado__icono--${tono}`}>
        <Icono nombre={icono} tamano={28} grosor={2.4} />
      </span>
      <h2>{titulo}</h2>
      <p>{children}</p>
      {accion}
      <Boton variante="fantasma" onClick={alVolver}>
        Volver a la cuenta
      </Boton>
    </section>
  )
}

function BotonCopiar({ texto, etiqueta, variante = 'primario' }: { texto: string; etiqueta: string; variante?: 'primario' | 'secundario' }) {
  const avisos = usarAvisos()
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    if (!copiado) return
    const t = setTimeout(() => setCopiado(false), 2200)
    return () => clearTimeout(t)
  }, [copiado])
  return (
    <Boton
      ancho
      variante={variante}
      onClick={async () => {
        if (await copiar(texto)) setCopiado(true)
        else avisos.error({ codigo: 'SERVICIO_NO_DISPONIBLE' })
      }}
    >
      <span className="cambio" key={String(copiado)}>
        <Icono nombre={copiado ? 'check' : 'copiar'} tamano={18} />
        {copiado ? 'Copiado' : etiqueta}
      </span>
    </Boton>
  )
}

export function VistaCobro({ token, pago }: { token: string; pago: Pago }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const cobro = pago.cobro
  const segundos = usarSegundosRestantes(cobro?.qrExpiraEn ?? null)
  const [cancelando, setCancelando] = useState(false)

  usarConsultaCobro(true, () => fuente.verificarPago(token, pago.id))
  useEffect(() => {
    if (segundos === 0) void fuente.verificarPago(token, pago.id).catch(() => {})
  }, [segundos === 0])

  const avance = segundos === null ? 1 : segundos / COBRO_EXPIRACION_SEGUNDOS

  return (
    <div className="cobro entra">
      <section className="hero cobro__monto">
        <p className="hero__etiqueta">Paga el monto exacto</p>
        <div className="cobro__cifra">
          <strong>{pesos(pago.total)}</strong>
          <button className="icono-circulo" aria-label="Copiar el monto" onClick={async () => (await copiar(String(pago.total))) && avisos.exito('Monto copiado', String(pago.total))}>
            <Icono nombre="copiar" tamano={16} />
          </button>
        </div>
        <p className="hero__texto">
          {pesos(pago.subtotal)} de consumo{pago.propina > 0 ? ` + ${pesos(pago.propina)} de propina (${pago.propinaPorcentaje} %)` : ', sin propina'}
        </p>
        <div className="cobro__tiempo" role="timer" aria-label="Tiempo para que venza el QR">
          <span className="cobro__barra">
            <span style={{ transform: `scaleX(${avance})` }} />
          </span>
          <span>{segundos === null ? 'Preparando…' : segundos > 0 ? `Vence en ${cuentaRegresiva(segundos)}` : 'Venció'}</span>
        </div>
      </section>

      <section className="tarjeta cobro__llave">
        <h2 className="tarjeta__titulo">Paga desde este celular</h2>
        <ol className="pasos">
          <li>Copia la llave Bre-B.</li>
          <li>En tu banco, elige pagar con llave y pégala.</li>
          <li>Escribe {pesos(pago.total)} exactos y confirma. Al volver, esta página se actualiza sola.</li>
        </ol>
        {cobro?.llaveBreB ? (
          <>
            <code className="llave">{cobro.llaveBreB}</code>
            <BotonCopiar texto={cobro.llaveBreB} etiqueta="Copiar llave" />
          </>
        ) : (
          <>
            <Hueso className="llave">@ribu00000000</Hueso>
            <Hueso className="boton boton--ancho" />
          </>
        )}
      </section>

      <section className="tarjeta cobro__qr">
        <div>
          <h2 className="tarjeta__titulo">¿Pagas desde otro celular?</h2>
          <p className="ayuda-campo">Escanea este QR con la app de tu banco.</p>
        </div>
        <QrImagen base64={cobro?.qrBase64 ?? null} etiqueta={`QR para pagar ${pesos(pago.total)}`} />
      </section>

      <p className="espera">
        <span className="girando girando--chico" aria-hidden="true" /> Esperando la confirmación del banco
      </p>

      <SimuladorDemo referencia={pago.id} />

      <Boton
        variante="fantasma"
        cargando={cancelando}
        onClick={async () => {
          setCancelando(true)
          try {
            await fuente.cancelarPago(token, pago.id)
          } catch (e) {
            avisos.error(e)
          } finally {
            setCancelando(false)
          }
        }}
      >
        Cancelar este cobro
      </Boton>
    </div>
  )
}

export function VistaFactura({ token, pago, restauranteId, alVolver }: { token: string; pago: Pago; restauranteId: string; alVolver: () => void }) {
  const fuente = usarFuente()
  const factura = usarLectura<Factura | null>((a, b) => fuente.escucharFactura(restauranteId, pago.id, a, b), [fuente, restauranteId, pago.id])

  return (
    <div className="cobro entra">
      <section className="tarjeta resultado">
        <span className="resultado__icono resultado__icono--verde resultado__icono--festejo">
          <Icono nombre="check" tamano={30} grosor={2.6} />
        </span>
        <h2>Pago recibido</h2>
        <p className="resultado__cifra">{pesos(pago.total)}</p>
      </section>
      {factura.estado === 'cargando' && <EsqueletoFactura />}
      {factura.estado === 'error' && <ErrorVista error={factura.error} />}
      {factura.estado === 'listo' && factura.valor && <TarjetaFactura token={token} pago={pago} factura={factura.valor} />}
      <Boton variante="fantasma" onClick={alVolver}>
        Volver a la cuenta
      </Boton>
    </div>
  )
}

export function TarjetaFactura({ token, pago, factura }: { token: string; pago: Pago; factura: Factura }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [descargando, setDescargando] = useState(false)
  const [correo, setCorreo] = useState(factura.correo.destino ?? '')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  if (factura.estado !== 'emitida' || !factura.datos) {
    return (
      <section className="tarjeta factura factura--en-camino" aria-live="polite">
        <span className="chip chip--ambar chip--rayado">
          <span className="chip__punto" />
          Factura en camino
        </span>
        <h2 className="tarjeta__titulo">Tu pago quedó registrado</h2>
        <p>{FACTURA_EN_CAMINO[factura.estado as Exclude<typeof factura.estado, 'emitida'>]}</p>
        <p className="ayuda-campo">Puedes quedarte aquí o cerrar: la factura aparece en esta misma pantalla{factura.correo.destino ? ` y llega a ${factura.correo.destino}` : ''}.</p>
      </section>
    )
  }

  const { datos } = factura

  async function descargar() {
    setDescargando(true)
    try {
      const pdf = await fuente.descargarFacturaPdf(token, pago.id)
      const url = URL.createObjectURL(pdf)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `factura-${datos.numero}.pdf`
      enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      avisos.error(e)
    } finally {
      setDescargando(false)
    }
  }

  async function enviar() {
    setEnviando(true)
    setError(null)
    try {
      await fuente.enviarFacturaPorCorreo(token, pago.id, { correo: correo.trim() })
      avisos.exito('Factura enviada', correo.trim())
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="tarjeta factura entra">
      <div className="factura__cabeza">
        <div>
          <span className="chip chip--verde-suave">
            <span className="chip__punto" />
            Validada por la DIAN
          </span>
          <h2 className="tarjeta__titulo">Factura {datos.numero}</h2>
        </div>
        <QrTexto texto={datos.qrUrl} etiqueta="QR de la factura en la DIAN" />
      </div>
      <dl className="datos">
        <div>
          <dt>CUFE</dt>
          <dd className="cufe">{datos.cufe}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{pesos(pago.total)}</dd>
        </div>
      </dl>
      <div className="acciones">
        <Boton variante="secundario" cargando={descargando} onClick={descargar}>
          <Icono nombre="descarga" tamano={18} /> PDF
        </Boton>
        <a className="boton boton--secundario" href={datos.qrUrl} target="_blank" rel="noreferrer">
          <Icono nombre="flecha" tamano={18} /> DIAN
        </a>
      </div>
      <div className="campo">
        <span className="campo__etiqueta">
          {factura.correo.estado === 'enviado' ? `Enviada a ${factura.correo.destino}` : 'Envíala a tu correo'}
        </span>
        <div className="entrada-boton">
          <input className="entrada" type="email" inputMode="email" placeholder="tu@correo.com" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          <Boton cargando={enviando} disabled={!correoValido(correo)} onClick={enviar} aria-label="Enviar la factura">
            <Icono nombre="correo" tamano={18} />
          </Boton>
        </div>
      </div>
      <AvisoError error={error} />
    </section>
  )
}

export function EsqueletoCobro() {
  return (
    <div className="cobro" aria-busy="true">
      <section className="hero hero--esqueleto cobro__monto">
        <Texto className="hero__etiqueta">Paga el monto exacto</Texto>
        <div className="cobro__cifra">
          <Texto>$100.300</Texto>
          <Hueso className="icono-circulo" />
        </div>
        <Texto className="hero__texto">$91.800 de consumo + $8.500 de propina (10 %)</Texto>
        <div className="cobro__tiempo">
          <span className="cobro__barra" />
          <Texto>Vence en 10:00</Texto>
        </div>
      </section>
      <section className="tarjeta cobro__llave">
        <Texto className="tarjeta__titulo">Paga desde este celular</Texto>
        <Hueso className="llave">@ribu00000000</Hueso>
        <Hueso className="boton boton--ancho" />
      </section>
    </div>
  )
}

function EsqueletoFactura() {
  return (
    <section className="tarjeta factura" aria-busy="true">
      <div className="factura__cabeza">
        <div>
          <Hueso className="chip">
            <span className="chip__punto" />
            Validada por la DIAN
          </Hueso>
          <Texto className="tarjeta__titulo">Factura SETP990000001</Texto>
        </div>
        <Hueso className="qr" />
      </div>
    </section>
  )
}
