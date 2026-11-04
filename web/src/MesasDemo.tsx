import { usarFuente } from './datos/contexto'
import { navegar } from './ruta'
import { Boton } from './ui/Controles'
import { Icono } from './ui/Icono'

/** Solo sirve para recorrer la versión en memoria. Nunca entra en la build de producción. */
export function MesasDemo() {
  const { simulador } = usarFuente()
  if (!simulador) return null
  return (
    <>
      <h2 className="seccion-titulo">Mesas de la demo</h2>
      <ul className="rejilla-mesas">
        {simulador.mesasDemo().map((mesa, i) => (
          <li key={mesa.token} className="entra" style={{ animationDelay: `${i * 40}ms` }}>
            <button className="tarjeta tarjeta--boton mesa-enlace" onClick={() => navegar(`/m/${mesa.token}`)}>
              <span className="mesa-enlace__numero">{mesa.numero}</span>
              <span>Mesa</span>
              <span className="icono-circulo">
                <Icono nombre="flecha" tamano={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="ayuda">Los datos viven en este navegador. Abre el personal en otra pestaña para ver los cambios al instante.</p>
      <Boton
        variante="fantasma"
        onClick={() => {
          simulador.reiniciar()
          location.reload()
        }}
      >
        <Icono nombre="actualizar" tamano={16} /> Reiniciar la demo
      </Boton>
    </>
  )
}
