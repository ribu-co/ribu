import QRCode from 'qrcode'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { almacenCompartido, almacenSesionDePestana } from './datos/almacen'
import { ProveedorDatos } from './datos/contexto'
import { crearFuenteMemoria } from './datos/memoria'
import { ProveedorAvisos } from './ui/Avisos'
import './estilos.css'

const fuente = crearFuenteMemoria({
  almacen: almacenCompartido(),
  almacenSesion: almacenSesionDePestana(),
  dibujarQr: async (texto) => (await QRCode.toDataURL(texto, { margin: 1, width: 480 })).replace(/^data:image\/png;base64,/, ''),
})

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProveedorDatos fuente={fuente}>
      <ProveedorAvisos>
        <App />
      </ProveedorAvisos>
    </ProveedorDatos>
  </StrictMode>,
)
