import type { Producto } from '../../../contratos/tipos'
import { Boton, Contador } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { totalEstimado, unidades, type Borrador } from './borrador'

export function HojaBorrador({
  abierta,
  alCerrar,
  borrador,
  productos,
  esPersonal,
  enviando,
  error,
  alCambiarCantidad,
  alEnviar,
}: {
  abierta: boolean
  alCerrar: () => void
  borrador: Borrador
  productos: readonly Producto[]
  esPersonal: boolean
  enviando: boolean
  error: unknown
  alCambiarCantidad: (clave: string, cantidad: number) => void
  alEnviar: () => void
}) {
  const total = totalEstimado(borrador, productos)
  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Tu pedido"
      subtitulo={esPersonal ? 'Lo que pide el personal va directo a cocina.' : 'El mesero lo confirma antes de pasarlo a cocina.'}
      pie={
        <>
          <div className="fila-total">
            <span>Total estimado</span>
            <strong>{pesos(total)}</strong>
          </div>
          <Boton ancho cargando={enviando} disabled={borrador.length === 0} onClick={alEnviar}>
            {esPersonal ? 'Enviar a cocina' : 'Enviar al mesero'} · {unidades(borrador)}
          </Boton>
        </>
      }
    >
      <AvisoError error={error} />
      <ul className="lista-borrador">
        {borrador.map((item) => {
          const producto = productos.find((p) => p.id === item.productoId)
          return (
            <li key={item.clave} className="item-borrador">
              <div>
                <strong>{producto?.nombre ?? 'Producto retirado'}</strong>
                {item.nota && <span className="nota-linea">“{item.nota}”</span>}
                <span className="item-borrador__precio">{producto ? pesos(producto.precio * item.cantidad) : '—'}</span>
              </div>
              <Contador
                etiqueta={`Cantidad de ${producto?.nombre ?? 'producto'}`}
                valor={item.cantidad}
                maximo={Math.min(producto?.stock ?? 20, 20)}
                alCambiar={(cantidad) => alCambiarCantidad(item.clave, cantidad)}
              />
            </li>
          )
        })}
      </ul>
    </Hoja>
  )
}
