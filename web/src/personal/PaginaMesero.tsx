import type { Cuenta, Mesa, Restaurante } from '../../../contratos/tipos'
import { usarFuente, usarLectura } from '../datos/contexto'
import { Chip } from '../ui/Controles'
import { ErrorVista, Vacio } from '../ui/Estados'
import { Hueso } from '../ui/Esqueletos'
import { plural } from '../ui/formato'
import { Icono } from '../ui/Icono'
import { resumirMesa, ROLES_MESERO, type SesionPersonal } from './logica'
import { CabeceraPersonal, Enlace, Puerta } from './Puerta'

export function PaginaMesero() {
  return (
    <Puerta roles={ROLES_MESERO} pantalla="mesero">
      {(sesion) => <Tablero sesion={sesion} />}
    </Puerta>
  )
}

function Tablero({ sesion }: { sesion: SesionPersonal }) {
  const fuente = usarFuente()
  const id = sesion.restauranteId
  const restaurante = usarLectura<Restaurante | null>((a, b) => fuente.escucharRestaurante(id, a, b), [fuente, id])
  const mesas = usarLectura<Mesa[]>((a, b) => fuente.escucharMesas(id, a, b), [fuente, id])
  const cuentas = usarLectura<Cuenta[]>((a, b) => fuente.escucharCuentasAbiertas(id, a, b), [fuente, id])

  const error = [restaurante, mesas, cuentas].find((l) => l.estado === 'error')
  if (error?.estado === 'error') {
    return (
      <main className="pagina pagina--personal">
        <ErrorVista error={error.error} alReintentar={() => location.reload()} />
      </main>
    )
  }
  if (restaurante.estado !== 'listo' || mesas.estado !== 'listo' || cuentas.estado !== 'listo') return <EsqueletoTablero />
  return <VistaTablero restaurante={restaurante.valor?.nombre ?? 'Ribu'} sesion={sesion} mesas={mesas.valor} cuentas={cuentas.valor} />
}

export function VistaTablero({
  restaurante,
  sesion,
  mesas,
  cuentas,
}: {
  restaurante: string
  sesion: SesionPersonal
  mesas: Mesa[]
  cuentas: Cuenta[]
}) {
  const resumenes = mesas.map((mesa) => resumirMesa(mesa, cuentas))
  const porConfirmar = resumenes.filter((r) => r.porConfirmar > 0).length

  return (
    <main className="pagina pagina--personal">
      <CabeceraPersonal restaurante={restaurante} sesion={sesion} />
      <h1 className="seccion-titulo tablero__titulo">Mesas</h1>

      {porConfirmar > 0 && (
        <p className="aviso aviso--ambar">
          <Icono nombre="reloj" tamano={18} />
          <span>{plural(porConfirmar, 'mesa')} con pedidos por confirmar. Sin confirmar, no llegan a cocina.</span>
        </p>
      )}

      {mesas.length === 0 ? (
        <Vacio icono="mesa" titulo="Este restaurante aún no tiene mesas" texto="Las crea quien administra el restaurante." />
      ) : (
        <ul className="tablero">
          {resumenes.map(({ mesa, porConfirmar: pendientes, estados }) => (
            <li key={mesa.token}>
              <Enlace a={`/mesero/${encodeURIComponent(mesa.token)}`} className="tarjeta tarjeta--boton mesa-tablero" >
                <span className="mesa-tablero__cabeza" data-atencion={pendientes > 0} data-libre={mesa.estado === 'libre'}>
                  <span className="mesa-tablero__etiqueta">Mesa</span>
                  <span className="mesa-tablero__numero">{mesa.numero}</span>
                </span>
                <span className="mesa-tablero__estados">
                  {estados.map((estado) => (
                    <Chip key={estado.texto} tono={estado.tono} rayado={estado.rayado}>
                      {estado.texto}
                    </Chip>
                  ))}
                </span>
              </Enlace>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function EsqueletoTablero() {
  return (
    <main className="pagina pagina--personal" aria-busy="true">
      <div className="cabecera">
        <Hueso ancho="160px" style={{ height: 34 }} />
        <Hueso ancho="40px" style={{ height: 40, borderRadius: '50%' }} />
      </div>
      <ul className="tablero" role="status" aria-label="Cargando las mesas">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i}>
            <Hueso className="tarjeta" style={{ height: 124 }} />
          </li>
        ))}
      </ul>
    </main>
  )
}
