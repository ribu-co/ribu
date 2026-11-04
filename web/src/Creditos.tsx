import { CREDITOS } from './creditos'
import { Icono } from './ui/Icono'

/** CC BY y CC BY-SA piden atribuir: aquí está el autor, la licencia y el origen de cada foto. */
export function Creditos() {
  return (
    <main className="pagina pagina--inicio">
      <header className="cabecera">
        <a className="boton boton--fantasma" href="/">
          <Icono nombre="izquierda" tamano={18} /> Volver
        </a>
      </header>
      <h1 className="seccion-titulo">Créditos de las fotos</h1>
      <p className="ayuda">El restaurante de la demo es inventado. Las fotos son reales y vienen de Wikimedia Commons, y muestran el plato en otros lugares, no en este restaurante.</p>
      <ul className="creditos">
        {CREDITOS.map((credito) => (
          <li key={credito.ruta} className="tarjeta credito entra">
            <img src={credito.ruta} alt="" loading="lazy" />
            <div>
              <strong>{credito.para}</strong>
              <span>
                {credito.autor} · {credito.licencia}
                {credito.recorte ? ' · recortada' : ''}
              </span>
              {credito.nota && <span>{credito.nota}</span>}
              <a href={credito.origen} target="_blank" rel="noreferrer">
                {credito.archivo}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
