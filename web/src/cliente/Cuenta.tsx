import type { ReactNode } from 'react'
import { lineaSuma } from '../../../contratos/reglas'
import type { Cuenta as TipoCuenta, ResumenPago } from '../../../contratos/tipos'
import { usarFuente } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { Boton, Chip } from '../ui/Controles'
import { Vacio } from '../ui/Estados'
import { pesos, plural } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { usarConsultaCobro } from './usarConsultaCobro'
import { cobrosAjenos, consultarCobros, etiquetaPago, miCobroActivo, todoPagado, unidadesPorConfirmar } from './cuenta'

/** No pinta nada: mantiene al día los cobros de otras personas, por si un QR venció y nadie lo está mirando. */
function ConsultaCobrosAjenos({ token, pagos }: { token: string; pagos: ResumenPago[] }) {
  const fuente = usarFuente()
  usarConsultaCobro(pagos.length > 0, () => consultarCobros((id) => fuente.verificarPago(token, id), pagos))
  return null
}

/** Medio anillo: lo pagado, lo que está en cobro y, rayado, lo que falta. */
export function Medidor({ consumo, pagado, enCobro }: { consumo: number; pagado: number; enCobro: number }) {
  const radio = 80
  const largo = Math.PI * radio
  const parte = (valor: number) => (consumo > 0 ? Math.min(valor / consumo, 1) * largo : 0)
  const porcentaje = consumo > 0 ? Math.round((pagado / consumo) * 100) : 0
  const arco = `M 20 100 A ${radio} ${radio} 0 0 1 180 100`
  return (
    <div className="medidor">
      <svg viewBox="0 0 200 112" role="img" aria-label={`${porcentaje} % pagado`}>
        <defs>
          <pattern id="rayas" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="#f5f6f3" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="#b9c1bb" strokeWidth="2.4" />
          </pattern>
        </defs>
        <path d={arco} className="medidor__fondo" stroke="url(#rayas)" />
        <path d={arco} className="medidor__cobro" strokeDasharray={`${parte(pagado + enCobro)} ${largo}`} />
        <path d={arco} className="medidor__pagado" strokeDasharray={`${parte(pagado)} ${largo}`} />
      </svg>
      <div className="medidor__centro">
        <strong>{porcentaje} %</strong>
        <span>pagado</span>
      </div>
      <ul className="medidor__leyenda">
        <li data-tono="pagado">Pagado</li>
        <li data-tono="cobro">En cobro</li>
        <li data-tono="falta">Por pagar</li>
      </ul>
    </div>
  )
}

function Cifra({ titulo, valor, destacada = false }: { titulo: string; valor: number; destacada?: boolean }) {
  return (
    <div className={`cifra${destacada ? ' cifra--destacada' : ''}`}>
      <span>{titulo}</span>
      <strong>{pesos(valor)}</strong>
    </div>
  )
}

export function Cuenta({
  cuenta,
  sesion,
  alPagar,
  alVerMiCobro,
  alVerPago,
  alVerCarta,
  extra,
}: {
  cuenta: TipoCuenta | null
  sesion: Sesion
  alPagar: () => void
  alVerMiCobro: (pagoId: string) => void
  alVerPago: (pagoId: string) => void
  alVerCarta: () => void
  /** Lo que agrega dividir la cuenta. */
  extra?: ReactNode
}) {
  if (!cuenta || cuenta.lineas.length === 0) {
    return (
      <Vacio icono="recibo" titulo="La cuenta está vacía" texto="Cuando el mesero confirme tu pedido, aquí verás lo que llevas y podrás pagar.">
        <Boton variante="secundario" onClick={alVerCarta}>
          Ver la carta
        </Boton>
      </Vacio>
    )
  }

  const mio = miCobroActivo(cuenta, sesion.uid)
  const ajenos = cobrosAjenos(cuenta, sesion.uid)
  const pendientes = unidadesPorConfirmar(cuenta)
  const confirmadas = cuenta.lineas.filter((l) => lineaSuma(l.estado))
  const pagado = todoPagado(cuenta)

  return (
    <div className="cuenta">
      <section className="tarjeta cuenta__resumen entra">
        <Medidor consumo={cuenta.consumo} pagado={cuenta.pagado} enCobro={cuenta.enCobro} />
        <div className="cifras">
          <Cifra titulo="Consumo" valor={cuenta.consumo} />
          <Cifra titulo="Pagado" valor={cuenta.pagado} />
          <Cifra titulo="En cobro" valor={cuenta.enCobro} />
          <Cifra titulo="Por pagar" valor={cuenta.porPagar} destacada />
        </div>
      </section>

      {pendientes > 0 && (
        <p className="aviso aviso--ambar">
          <Icono nombre="reloj" tamano={18} />
          <span>{plural(pendientes, 'producto')} esperan al mesero. Solo se cobra lo confirmado.</span>
        </p>
      )}

      {mio && (
        <button className="tarjeta tarjeta--boton tarjeta--cobro entra" onClick={() => alVerMiCobro(mio.id)}>
          <span>
            <strong>Tienes un cobro activo de {pesos(mio.total)}</strong>
            <span>Toca para ver la llave y el QR.</span>
          </span>
          <span className="icono-circulo">
            <Icono nombre="flecha" tamano={16} />
          </span>
        </button>
      )}
      <ConsultaCobrosAjenos token={cuenta.mesaToken} pagos={ajenos} />
      {ajenos.map((p) => (
        <p key={p.id} className="aviso aviso--info">
          <span className="girando girando--chico" aria-hidden="true" />
          <span>Alguien de la mesa está pagando {pesos(p.subtotal)}. Espera a que termine.</span>
        </p>
      ))}

      {pagado ? (
        <section className="tarjeta todo-pagado entra">
          <span className="resultado__icono resultado__icono--verde">
            <Icono nombre="check" tamano={26} grosor={2.4} />
          </span>
          <div>
            <h2 className="tarjeta__titulo">La cuenta está pagada</h2>
            <p className="ayuda-campo">Si piden algo más, aparecerá aquí para pagarlo.</p>
          </div>
        </section>
      ) : (
        extra ??
        (cuenta.porPagar > 0 && !mio && (
          <Boton ancho onClick={alPagar}>
            Pagar {pesos(cuenta.porPagar)}
          </Boton>
        ))
      )}

      <section className="tarjeta">
        <h2 className="tarjeta__titulo">Lo confirmado</h2>
        {confirmadas.length === 0 ? (
          <p className="ayuda-campo">Todavía no hay nada confirmado.</p>
        ) : (
          <ul className="detalle">
            {confirmadas.map((l) => (
              <li key={l.id}>
                <span>
                  {l.cantidad}× {l.nombre}
                </span>
                <span>{pesos(l.precio * l.cantidad)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cuenta.pagos.length > 0 && (
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Pagos de la mesa</h2>
          <ul className="pagos">
            {cuenta.pagos.map((p) => {
              const propio = p.creadoPor === sesion.uid
              return (
                <li key={p.id}>
                  <button className="pago-fila" disabled={!propio} onClick={() => alVerPago(p.id)}>
                    <span className="pago-fila__numero">{p.numero}</span>
                    <span className="pago-fila__texto">
                      <strong>{pesos(p.total)}</strong>
                      <span>
                        {p.parte ? `Parte ${p.parte} · ` : ''}
                        {propio ? 'Tu pago' : 'Otra persona'}
                      </span>
                    </span>
                    <Chip tono={p.estado === 'pagado' ? (p.incidencia ? 'ambar' : 'verde-suave') : p.estado === 'esperando_pago' ? 'verde' : 'gris'}>
                      {etiquetaPago(p)}
                    </Chip>
                    {propio && <Icono nombre="derecha" tamano={18} />}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
