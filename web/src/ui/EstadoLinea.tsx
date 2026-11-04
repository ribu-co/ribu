import type { EstadoLinea } from '../../../contratos/tipos'
import { Chip } from './Controles'
import { avanceLinea, ETIQUETA_LINEA, PASOS_LINEA } from './lineas'

const TONO: Record<EstadoLinea, string> = {
  pendiente: 'ambar',
  confirmada: 'verde-suave',
  en_preparacion: 'verde',
  lista: 'verde-fuerte',
  entregada: 'gris',
  rechazada: 'rojo',
  anulada: 'gris',
}

export function ChipLinea({ estado }: { estado: EstadoLinea }) {
  return (
    <Chip tono={TONO[estado]} rayado={estado === 'pendiente'}>
      {ETIQUETA_LINEA[estado]}
    </Chip>
  )
}

/** Cinco barritas: cuánto le falta a la línea para llegar a la mesa. */
export function AvanceLinea({ estado }: { estado: EstadoLinea }) {
  const avance = avanceLinea(estado)
  if (avance === 0) return null
  return (
    <div className="avance" role="img" aria-label={`Paso ${avance} de ${PASOS_LINEA.length}: ${ETIQUETA_LINEA[estado]}`}>
      {PASOS_LINEA.map((paso, i) => (
        <span key={paso} className="avance__paso" data-hecho={i < avance} data-actual={i === avance - 1} />
      ))}
    </div>
  )
}
