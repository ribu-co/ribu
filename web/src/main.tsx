import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ProveedorDatos } from './datos/contexto'
import { crearFuente } from './datos/elegir'
import { ProveedorAvisos } from './ui/Avisos'
import { ErrorVista } from './ui/Estados'
import './estilos.css'

const raiz = createRoot(document.getElementById('raiz')!)

crearFuente()
  .then((fuente) =>
    raiz.render(
      <StrictMode>
        <ProveedorDatos fuente={fuente}>
          <ProveedorAvisos>
            <App />
          </ProveedorAvisos>
        </ProveedorDatos>
      </StrictMode>,
    ),
  )
  .catch((error: unknown) =>
    raiz.render(
      <main className="pagina">
        <ErrorVista error={error} alReintentar={() => location.reload()} />
      </main>,
    ),
  )
