import { useEffect, useState } from 'react'
import type { Factura, Pago } from '../../../contratos/tipos'
import { armarComprador } from '../cliente/HojaPagar'
import { etiquetaPago } from '../cliente/cuenta'
import { SimuladorDemo } from '../cliente/SimuladorDemo'
import { TarjetaFactura } from '../cliente/SeguimientoPago'
import { usarConsultaCobro } from '../cliente/usarConsultaCobro'
import { compradorValido } from '../datos/comprador'
import { usarFuente, usarLectura } from '../datos/contexto'
import { Boton, Chip } from '../ui/Controles'
import { AvisoError, Cargando, ErrorVista } from '../ui/Estados'
import { hora, pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { COMPRADOR_VACIO, FormularioComprador, type DatosComprador, type TipoComprador } from './HojaCobrar'
import { ESTADO_FACTURA, ETIQUETA_MEDIO } from './logica'
import { usarAccion } from './usarAccion'

/** Todo lo de un pago: qué cubre, cómo va el cobro y su factura. */
export function HojaPago({
  abierta,
  alCerrar,
  pagoId,
  token,
  restauranteId,
}: {
  abierta: boolean
  alCerrar: () => void
  pagoId: string | null
  token: string
  restauranteId: string
}) {
  const fuente = usarFuente()
  const pago = usarLectura<Pago | null>(pagoId ? (a, b) => fuente.escucharPago(restauranteId, pagoId, a, b) : null, [fuente, restauranteId, pagoId])
  const factura = usarLectura<Factura | null>(pagoId ? (a, b) => fuente.escucharFactura(restauranteId, pagoId, a, b) : null, [fuente, restauranteId, pagoId])
  const valor = pago.estado === 'listo' ? pago.valor : null

  // Respaldo del webhook, igual que la pantalla de pago del cliente: también suelta un QR vencido.
  usarConsultaCobro(abierta && pagoId !== null && valor?.estado === 'esperando_pago', () => fuente.verificarPago(token, pagoId as string))

  return (
    <Hoja abierta={abierta} alCerrar={alCerrar} titulo={valor ? `Pago ${valor.numero}${valor.parte ? ` · Parte ${valor.parte}` : ''}` : 'Pago'}>
      {pago.estado === 'cargando' && <Cargando />}
      {pago.estado === 'error' && <ErrorVista error={pago.error} />}
      {valor && (
        <>
          <DetallePagoPersonal pago={valor} />
          {valor.incidencia === 'pago_duplicado' && (
            <p className="aviso aviso--ambar">
              <Icono nombre="alerta" tamano={18} />
              <span>Este dinero entró cuando otro pago ya cubría lo mismo. No genera factura: hay que devolverlo por fuera.</span>
            </p>
          )}
          {valor.estado === 'esperando_pago' && <CobroActivo pago={valor} token={token} />}
          {valor.estado === 'pagado' && valor.incidencia === null && (
            <>
              {factura.estado === 'cargando' && <Cargando />}
              {factura.estado === 'error' && <ErrorVista error={factura.error} />}
              {factura.estado === 'listo' && factura.valor && <FacturaDelPago pago={valor} factura={factura.valor} token={token} />}
            </>
          )}
        </>
      )}
    </Hoja>
  )
}

export function DetallePagoPersonal({ pago }: { pago: Pago }) {
  return (
    <section className="detalle-pago">
      <div className="detalle-pago__estado">
        <Chip tono={pago.estado === 'pagado' ? (pago.incidencia ? 'ambar' : 'verde-suave') : pago.estado === 'esperando_pago' ? 'verde' : 'gris'}>{etiquetaPago(pago)}</Chip>
        <span className="linea__meta">
          {ETIQUETA_MEDIO[pago.medio]} · {hora(pago.pagadoEn ?? pago.creadoEn)}
        </span>
      </div>
      <ul className="detalle">
        {pago.items.map((item, i) => (
          <li key={item.lineaId ?? i}>
            <span>
              {item.cantidad}× {item.nombre}
            </span>
            <span>{pesos(item.precio * item.cantidad)}</span>
          </li>
        ))}
        <li>
          <span>Propina ({pago.propinaPorcentaje} %)</span>
          <span>{pesos(pago.propina)}</span>
        </li>
      </ul>
      <div className="fila-total">
        <span>Total</span>
        <strong>{pesos(pago.total)}</strong>
      </div>
    </section>
  )
}

function CobroActivo({ pago, token }: { pago: Pago; token: string }) {
  const fuente = usarFuente()
  const { ocupado, ejecutar } = usarAccion()
  return (
    <>
      <p className="espera">
        <span className="girando girando--chico" aria-hidden="true" /> Esperando la confirmación del banco
      </p>
      <SimuladorDemo referencia={pago.id} />
      <Boton variante="fantasma" cargando={ocupado === 'cancelar'} onClick={() => void ejecutar('cancelar', () => fuente.cancelarPago(token, pago.id), 'Cobro cancelado')}>
        Cancelar este cobro
      </Boton>
      <p className="ayuda-campo">El QR puede seguir vivo hasta vencer. Si ese dinero entra después, el pago se registra.</p>
    </>
  )
}

/** Si la DIAN rechaza, el personal corrige el comprador y se reemite con la misma referencia. */
function FacturaDelPago({ pago, factura, token }: { pago: Pago; factura: Factura; token: string }) {
  if (factura.estado === 'emitida') return <TarjetaFactura token={token} pago={pago} factura={factura} />
  const visible = ESTADO_FACTURA[factura.estado]
  return (
    <section className="tarjeta factura factura--en-camino" aria-live="polite">
      <Chip tono={visible.tono} rayado={visible.rayado}>
        {visible.texto}
      </Chip>
      {factura.estado === 'en_validacion' && <p className="ayuda-campo">Se reintenta sola con la misma referencia. El pago ya quedó.</p>}
      {factura.ultimoError && <p className="linea__motivo">{factura.ultimoError}</p>}
      {factura.estado === 'rechazada' && <CorregirFactura pagoId={pago.id} token={token} factura={factura} />}
    </section>
  )
}

function datosDelComprador(factura: Factura): { tipo: TipoComprador; datos: DatosComprador } {
  const { comprador } = factura
  const datos: DatosComprador = { ...COMPRADOR_VACIO, correo: comprador.correo ?? '' }
  if (comprador.tipo === 'persona') {
    datos.tipoDocumento = comprador.tipoDocumento
    datos.documento = comprador.documento
    datos.nombre = comprador.nombre
  }
  if (comprador.tipo === 'empresa') {
    datos.nit = comprador.nit
    datos.razonSocial = comprador.razonSocial
  }
  return { tipo: comprador.tipo, datos }
}

function CorregirFactura({ pagoId, token, factura }: { pagoId: string; token: string; factura: Factura }) {
  const fuente = usarFuente()
  const [tipo, setTipo] = useState<TipoComprador>(factura.comprador.tipo)
  const [datos, setDatos] = useState<DatosComprador>(COMPRADOR_VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const inicial = datosDelComprador(factura)
    setTipo(inicial.tipo)
    setDatos(inicial.datos)
  }, [factura.pagoId])

  const comprador = armarComprador(tipo, datos)

  async function reemitir() {
    setEnviando(true)
    setError(null)
    try {
      await fuente.reintentarFactura(token, pagoId, { comprador })
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <p className="ayuda-campo">La DIAN pidió corregir un dato. Revisa el comprador y vuelve a emitirla.</p>
      <FormularioComprador tipo={tipo} datos={datos} alCambiarTipo={setTipo} alCambiarDatos={setDatos} />
      <AvisoError error={error} />
      <Boton ancho cargando={enviando} disabled={!compradorValido(comprador)} onClick={() => void reemitir()}>
        Volver a emitir la factura
      </Boton>
    </>
  )
}
