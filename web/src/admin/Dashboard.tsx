import { useMemo, useState } from 'react'
import type { Lectura } from '../datos/contexto'
import { Pestanas } from '../ui/Controles'
import { Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { pesos, plural } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { calcularDashboard, type DatosDashboard, type Periodo, type ResumenVentas } from './calculos'
import { ETIQUETA_MEDIO } from './comunes'

const PERIODOS: readonly { valor: Periodo; texto: string }[] = [
  { valor: 'siete', texto: '7 días' },
  { valor: 'treinta', texto: '30 días' },
  { valor: 'mes', texto: 'Este mes' },
]

function Cifras({ resumen }: { resumen: ResumenVentas }) {
  return (
    <div className="cifras admin-cifras">
      <div className="cifra cifra--destacada admin-cifras__principal">
        <span>Ventas, sin propina</span>
        <strong>{pesos(resumen.ventas)}</strong>
      </div>
      <div className="cifra">
        <span>Pagos</span>
        <strong>{resumen.pagos}</strong>
      </div>
      <div className="cifra">
        <span>Ticket promedio</span>
        <strong>{pesos(resumen.ticketPromedio)}</strong>
      </div>
      <div className="cifra">
        <span>Propinas</span>
        <strong>{pesos(resumen.propinas)}</strong>
      </div>
      <div className="cifra">
        <span>Impuestos incluidos</span>
        <strong>{pesos(resumen.impuestos)}</strong>
      </div>
    </div>
  )
}

/** Una barra por fila, con su valor escrito al lado: el número no depende de leer el largo. */
function Barras({ filas, etiqueta }: { filas: { clave: string; nombre: string; valor: string; detalle: string; fraccion: number }[]; etiqueta: string }) {
  return (
    <ul className="admin-barras" aria-label={etiqueta}>
      {filas.map((fila) => (
        <li key={fila.clave} className="admin-barra">
          <div className="admin-barra__textos">
            <strong>{fila.nombre}</strong>
            <span>
              {fila.valor} · {fila.detalle}
            </span>
          </div>
          <span className="admin-barra__riel" aria-hidden="true">
            <span className="admin-barra__relleno" style={{ transform: `scaleX(${Math.max(fila.fraccion, 0.01)})` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

const SinDatos = ({ texto }: { texto: string }) => <p className="admin-sin-datos">{texto}</p>

export function Dashboard({ datos, ahora, alIrAFacturas }: { datos: Lectura<DatosDashboard>; ahora: Date; alIrAFacturas: () => void }) {
  const [periodo, setPeriodo] = useState<Periodo>('siete')
  const tablero = useMemo(() => (datos.estado === 'listo' ? calcularDashboard(datos.valor, periodo, ahora) : null), [datos, periodo, ahora])

  if (datos.estado === 'error') return <ErrorVista error={datos.error} />
  if (!tablero) return <Cargando texto="Cargando el dashboard…" />
  if (tablero.sinDatos) {
    return <Vacio icono="recibo" titulo="Todavía no hay movimiento" texto="Cuando se abra la primera mesa y entre el primer pago, los números aparecen aquí solos." />
  }

  const { hoy, medios, facturas, notas, mesas, masVendidos, carta, duplicados } = tablero
  const maximoUnidades = Math.max(...masVendidos.productos.map((p) => p.unidades), 1)
  const porResolver = (facturas?.rechazadas ?? 0) + (notas?.rechazadas ?? 0)
  const devoluciones = notas?.devolucionesPendientes.cantidad ?? 0

  return (
    <div className="admin-tablero">
      {(porResolver > 0 || devoluciones > 0 || duplicados) && (
        <div className="admin-alertas">
          {porResolver > 0 && (
            <button className="aviso aviso--error admin-alerta" onClick={alIrAFacturas}>
              <Icono nombre="alerta" tamano={18} />
              <div>
                <strong>{plural(porResolver, 'documento rechazado', 'documentos rechazados')} por la DIAN</strong>
                <span>Corrígelos y vuelve a emitirlos.</span>
              </div>
              <Icono nombre="derecha" tamano={16} />
            </button>
          )}
          {devoluciones > 0 && notas && (
            <button className="aviso aviso--ambar admin-alerta" onClick={alIrAFacturas}>
              <Icono nombre="reloj" tamano={18} />
              <div>
                <strong>
                  {plural(devoluciones, 'devolución pendiente', 'devoluciones pendientes')}: {pesos(notas.devolucionesPendientes.total)}
                </strong>
                <span>Factus Pay no tiene reversos: se devuelve por fuera y se registra aquí.</span>
              </div>
              <Icono nombre="derecha" tamano={16} />
            </button>
          )}
          {duplicados && (
            <button className="aviso aviso--ambar admin-alerta" onClick={alIrAFacturas}>
              <Icono nombre="alerta" tamano={18} />
              <div>
                <strong>
                  {plural(duplicados.cantidad, 'pago duplicado', 'pagos duplicados')}: {pesos(duplicados.total)}
                </strong>
                <span>No cuentan como venta. El dinero se devuelve por fuera.</span>
              </div>
              <Icono nombre="derecha" tamano={16} />
            </button>
          )}
        </div>
      )}

      <section className="tarjeta admin-bloque admin-bloque--ancho" aria-labelledby="admin-hoy">
        <h2 id="admin-hoy" className="tarjeta__titulo">
          Hoy
        </h2>
        {hoy ? <Cifras resumen={hoy} /> : <SinDatos texto="Todavía no entra ningún pago hoy." />}
      </section>

      <section className="tarjeta admin-bloque admin-bloque--ancho" aria-labelledby="admin-periodo">
        <div className="admin-bloque__cabeza">
          <h2 id="admin-periodo" className="tarjeta__titulo">
            Periodo
          </h2>
          <div className="admin-periodo">
            <Pestanas etiqueta="Periodo" opciones={PERIODOS} valor={periodo} alCambiar={setPeriodo} />
          </div>
        </div>
        {tablero.periodo ? <Cifras resumen={tablero.periodo} /> : <SinDatos texto="No entró ningún pago en este periodo." />}
      </section>

      <section className="tarjeta admin-bloque" aria-labelledby="admin-medios">
        <h2 id="admin-medios" className="tarjeta__titulo">
          Pagos por medio
        </h2>
        {medios.length > 0 ? (
          <Barras
            etiqueta="Cobrado por medio de pago, con propina"
            filas={medios.map((fila) => ({
              clave: fila.medio,
              nombre: ETIQUETA_MEDIO[fila.medio],
              valor: pesos(fila.monto),
              detalle: plural(fila.pagos, 'pago'),
              fraccion: fila.fraccion,
            }))}
          />
        ) : (
          <SinDatos texto="Sin pagos en este periodo." />
        )}
        {medios.length > 0 && <p className="ayuda-campo">Lo cobrado, con propina.</p>}
      </section>

      <section className="tarjeta admin-bloque" aria-labelledby="admin-vendidos">
        <h2 id="admin-vendidos" className="tarjeta__titulo">
          Productos más vendidos
        </h2>
        {masVendidos.productos.length > 0 ? (
          <Barras
            etiqueta="Unidades vendidas por producto"
            filas={masVendidos.productos.map((fila) => ({
              clave: fila.nombre,
              nombre: fila.nombre,
              valor: plural(fila.unidades, 'unidad', 'unidades'),
              detalle: pesos(fila.monto),
              fraccion: fila.unidades / maximoUnidades,
            }))}
          />
        ) : (
          <SinDatos texto="Sin productos vendidos en este periodo." />
        )}
        {masVendidos.pagosSinDetalle > 0 && (
          <p className="ayuda-campo">
            No incluye {plural(masVendidos.pagosSinDetalle, 'pago', 'pagos')} en partes iguales: se facturan como consumo, sin detalle de productos.
          </p>
        )}
      </section>

      <section className="tarjeta admin-bloque" aria-labelledby="admin-facturas">
        <h2 id="admin-facturas" className="tarjeta__titulo">
          Facturación
        </h2>
        {facturas ? (
          <div className="cifras">
            <div className="cifra">
              <span>Emitidas en el periodo</span>
              <strong>{facturas.emitidas}</strong>
            </div>
            <div className="cifra">
              <span>En validación</span>
              <strong>{facturas.enValidacion + facturas.enProceso}</strong>
            </div>
            <div className="cifra" data-alerta={facturas.rechazadas > 0}>
              <span>Rechazadas</span>
              <strong>{facturas.rechazadas}</strong>
            </div>
            {notas && (
              <div className="cifra">
                <span>Notas emitidas</span>
                <strong>{notas.creditos.cantidad + notas.debitos.cantidad}</strong>
              </div>
            )}
          </div>
        ) : (
          <SinDatos texto="Todavía no hay facturas." />
        )}
        {facturas && <p className="ayuda-campo">En validación y rechazadas muestran lo que está pendiente ahora, de cualquier fecha.</p>}
        {notas && (notas.creditos.cantidad > 0 || notas.debitos.cantidad > 0) && (
          <p className="ayuda-campo">
            Crédito: {pesos(notas.creditos.total)} · Débito: {pesos(notas.debitos.total)}. Las ventas no descuentan las notas.
          </p>
        )}
      </section>

      <section className="tarjeta admin-bloque" aria-labelledby="admin-mesas">
        <h2 id="admin-mesas" className="tarjeta__titulo">
          Ahora en el salón
        </h2>
        {mesas.mesas > 0 ? (
          <div className="cifras">
            <div className="cifra">
              <span>Mesas abiertas</span>
              <strong>{mesas.mesas}</strong>
            </div>
            <div className="cifra">
              <span>Por pagar</span>
              <strong>{pesos(mesas.porPagar)}</strong>
            </div>
            {mesas.enCobro > 0 && (
              <div className="cifra">
                <span>En cobro</span>
                <strong>{pesos(mesas.enCobro)}</strong>
              </div>
            )}
          </div>
        ) : (
          <SinDatos texto="No hay mesas abiertas." />
        )}
        {carta && carta.agotados.length > 0 && (
          <p className="ayuda-campo">
            <strong>Agotados:</strong> {carta.agotados.join(', ')}.
          </p>
        )}
      </section>
    </div>
  )
}
