import type { Cuenta, LineaPedido, Restaurante } from '../../../contratos/tipos'
import { usarFuente, usarLectura } from '../datos/contexto'
import { Boton, Chip } from '../ui/Controles'
import { ErrorVista, Vacio } from '../ui/Estados'
import { Hueso } from '../ui/Esqueletos'
import { hora, plural } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { avancesDeCocina, colaDeCocina, resumenCocina, ROLES_COCINA, type SesionPersonal } from './logica'
import { CabeceraPersonal, Puerta } from './Puerta'
import { usarAccion } from './usarAccion'

export function PaginaCocina() {
  return (
    <Puerta roles={ROLES_COCINA} pantalla="cocina">
      {(sesion) => <Cocina sesion={sesion} />}
    </Puerta>
  )
}

function Cocina({ sesion }: { sesion: SesionPersonal }) {
  const fuente = usarFuente()
  const id = sesion.restauranteId
  const restaurante = usarLectura<Restaurante | null>((a, b) => fuente.escucharRestaurante(id, a, b), [fuente, id])
  const cuentas = usarLectura<Cuenta[]>((a, b) => fuente.escucharCuentasAbiertas(id, a, b), [fuente, id])

  const error = [restaurante, cuentas].find((l) => l.estado === 'error')
  if (error?.estado === 'error') {
    return (
      <main className="pagina pagina--personal">
        <ErrorVista error={error.error} alReintentar={() => location.reload()} />
      </main>
    )
  }
  if (restaurante.estado !== 'listo' || cuentas.estado !== 'listo') return <EsqueletoCocina />
  return <VistaCocina restaurante={restaurante.valor?.nombre ?? 'Ribu'} sesion={sesion} cuentas={cuentas.valor} />
}

export function VistaCocina({ restaurante, sesion, cuentas }: { restaurante: string; sesion: SesionPersonal; cuentas: Cuenta[] }) {
  const fuente = usarFuente()
  const { ocupado, ejecutar } = usarAccion()
  const cola = colaDeCocina(cuentas)
  const resumen = resumenCocina(cuentas)

  const avanzar = (token: string, linea: LineaPedido, hacia: 'en_preparacion' | 'lista') =>
    void ejecutar(`${linea.id}:${hacia}`, () => fuente.avanzarLinea(token, linea.id, { estado: hacia }))

  return (
    <main className="pagina pagina--personal">
      <CabeceraPersonal restaurante={restaurante} pastilla="Cocina" />

      <section className="hero">
        <p className="hero__etiqueta">{sesion.nombre ?? 'Cocina'}</p>
        <h1 className="hero__titulo">{cola.length > 0 ? `${plural(cola.length, 'mesa')} por preparar` : 'Todo al día'}</h1>
        <p className="hero__texto">{resumen.length > 0 ? resumen.join(' · ') : 'Lo que el mesero confirme aparece aquí al instante.'}</p>
      </section>

      {cola.length === 0 ? (
        <Vacio icono="fuego" titulo="Nada por preparar" />
      ) : (
        <div className="cocina">
          {cola.map((mesa) => (
            <section key={mesa.token} className="tarjeta ronda cocina__mesa">
              <header className="ronda__cabeza">
                <h2>Mesa {mesa.numeroMesa}</h2>
                <span>Desde las {hora(mesa.desde)}</span>
              </header>
              <ul className="lineas">
                {mesa.lineas.map((linea) => (
                  <li key={linea.id} className="linea" data-estado={linea.estado}>
                    <span className="linea__cantidad">{linea.cantidad}×</span>
                    <div className="linea__cuerpo">
                      <strong className="linea__nombre">{linea.nombre}</strong>
                      {linea.nota && <span className="nota-linea">“{linea.nota}”</span>}
                      <div className="linea__fila">
                        <Chip tono={linea.estado === 'en_preparacion' ? 'verde' : 'verde-suave'}>{linea.estado === 'en_preparacion' ? 'En preparación' : 'Por empezar'}</Chip>
                        <span className="linea__meta">
                          Ronda {linea.ronda} · {hora(linea.creadaEn)}
                        </span>
                      </div>
                      <div className="acciones-linea">
                        {avancesDeCocina(linea).map((hacia) => (
                          <Boton
                            key={hacia}
                            variante={hacia === 'lista' && linea.estado === 'confirmada' ? 'secundario' : 'primario'}
                            cargando={ocupado === `${linea.id}:${hacia}`}
                            disabled={ocupado !== null}
                            aria-label={`${hacia === 'lista' ? 'Listo' : 'Empezar'}: ${linea.nombre}, mesa ${mesa.numeroMesa}`}
                            onClick={() => avanzar(mesa.token, linea, hacia)}
                          >
                            {hacia === 'lista' ? (
                              <>
                                <Icono nombre="check" tamano={18} /> Listo
                              </>
                            ) : (
                              <>
                                <Icono nombre="fuego" tamano={18} /> Empezar
                              </>
                            )}
                          </Boton>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}

function EsqueletoCocina() {
  return (
    <main className="pagina pagina--personal" aria-busy="true">
      <div className="cocina" role="status" aria-label="Cargando la cocina">
        {[0, 1].map((i) => (
          <Hueso key={i} className="tarjeta" style={{ height: 180 }} />
        ))}
      </div>
    </main>
  )
}
