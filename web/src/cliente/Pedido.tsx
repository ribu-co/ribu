import type { Cuenta } from '../../../contratos/tipos'
import { Boton } from '../ui/Controles'
import { AvanceLinea, ChipLinea } from '../ui/EstadoLinea'
import { Vacio } from '../ui/Estados'
import { hora, pesos } from '../ui/formato'
import { agruparPorRonda } from '../ui/lineas'

export function Pedido({ cuenta, alVerCarta }: { cuenta: Cuenta | null; alVerCarta: () => void }) {
  if (!cuenta || cuenta.lineas.length === 0) {
    return (
      <Vacio icono="bolsa" titulo="Aún no hay pedidos en esta mesa" texto="Elige algo de la carta y envíalo. Aquí verás cada plato hasta que llegue.">
        <Boton variante="secundario" onClick={alVerCarta}>
          Ver la carta
        </Boton>
      </Vacio>
    )
  }

  return (
    <div className="rondas">
      {agruparPorRonda(cuenta.lineas).map((ronda) => (
        <section key={ronda.numero} className="tarjeta ronda entra">
          <header className="ronda__cabeza">
            <h3>Ronda {ronda.numero}</h3>
            <span>{hora(ronda.creadaEn)}</span>
          </header>
          <ul className="lineas">
            {ronda.lineas.map((linea) => (
              <li key={linea.id} className="linea" data-estado={linea.estado}>
                <span className="linea__cantidad">{linea.cantidad}×</span>
                <div className="linea__cuerpo">
                  <div className="linea__fila">
                    <strong className="linea__nombre">{linea.nombre}</strong>
                    <span className="linea__precio">{pesos(linea.precio * linea.cantidad)}</span>
                  </div>
                  {linea.nota && <span className="nota-linea">“{linea.nota}”</span>}
                  <div className="linea__fila">
                    <ChipLinea estado={linea.estado} />
                    <AvanceLinea estado={linea.estado} />
                  </div>
                  {linea.motivo && <p className="linea__motivo">{linea.motivo}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
