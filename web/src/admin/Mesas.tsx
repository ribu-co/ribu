import { rutas } from '../../../contratos/reglas'
import type { Mesa } from '../../../contratos/tipos'
import type { Lectura } from '../datos/contexto'
import { Chip } from '../ui/Controles'
import { Cargando, ErrorVista, Vacio } from '../ui/Estados'
import { QrTexto } from '../ui/Qr'
import { BotonCopiar } from './comunes'

/** El link completo, que es lo que va en el NFC y en el QR del sticker. */
export const linkDeMesa = (origen: string, token: string) => `${origen}${rutas.paginaMesa(token)}`

export function Mesas({ mesas, origen }: { mesas: Lectura<Mesa[]>; origen: string }) {
  if (mesas.estado === 'error') return <ErrorVista error={mesas.error} />
  if (mesas.estado === 'cargando') return <Cargando texto="Cargando las mesas…" />
  if (mesas.valor.length === 0) return <Vacio icono="mesa" titulo="Este restaurante no tiene mesas" texto="Cuando se creen, aquí aparecen sus links para el sticker." />

  return (
    <div className="admin-seccion">
      <div className="admin-seccion__cabeza">
        <h2 className="tarjeta__titulo">Mesas</h2>
      </div>
      <p className="ayuda-campo">Cada mesa tiene un solo link: es el que va en el NFC y en el QR del sticker.</p>
      <ul className="admin-mesas">
        {[...mesas.valor]
          .sort((a, b) => a.numero - b.numero)
          .map((mesa) => {
            const link = linkDeMesa(origen, mesa.token)
            return (
              <li key={mesa.token} className="tarjeta admin-mesa">
                <div className="admin-mesa__cabeza">
                  <h3>Mesa {mesa.numero}</h3>
                  <Chip tono={mesa.estado === 'libre' ? 'gris' : 'verde'}>{mesa.estado === 'libre' ? 'Libre' : 'Ocupada'}</Chip>
                </div>
                <QrTexto texto={link} etiqueta={`QR de la mesa ${mesa.numero}`} />
                <p className="admin-mesa__link">{link}</p>
                <BotonCopiar texto={link} etiqueta={`Copiar el link de la mesa ${mesa.numero}`}>
                  Copiar link
                </BotonCopiar>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
