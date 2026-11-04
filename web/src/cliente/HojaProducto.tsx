import { useEffect, useState } from 'react'
import type { Producto } from '../../../contratos/tipos'
import { Boton, Contador } from '../ui/Controles'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'

export const NOTA_MAXIMA = 140

export function HojaProducto({
  producto,
  alCerrar,
  alAgregar,
}: {
  producto: Producto | null
  alCerrar: () => void
  alAgregar: (producto: Producto, cantidad: number, nota: string | null) => void
}) {
  const [cantidad, setCantidad] = useState(1)
  const [nota, setNota] = useState('')
  // La hoja se queda montada un momento al cerrar: se guarda el último producto para que no parpadee.
  const [mostrado, setMostrado] = useState(producto)

  useEffect(() => {
    if (!producto) return
    setMostrado(producto)
    setCantidad(1)
    setNota('')
  }, [producto])

  const maximo = Math.min(mostrado?.stock ?? 20, 20)

  return (
    <Hoja
      abierta={producto !== null}
      alCerrar={alCerrar}
      titulo={mostrado?.nombre ?? ''}
      subtitulo={mostrado ? <span className="precio-llamado">{pesos(mostrado.precio)}</span> : undefined}
      pie={
        mostrado && (
          <Boton ancho onClick={() => alAgregar(mostrado, cantidad, nota)}>
            Agregar {cantidad} · {pesos(mostrado.precio * cantidad)}
          </Boton>
        )
      }
    >
      {mostrado?.imagenUrl && <img className="hoja__foto" src={mostrado.imagenUrl} alt="" />}
      {mostrado?.descripcion && <p className="hoja__texto">{mostrado.descripcion}</p>}
      <div className="campo campo--fila">
        <span className="campo__etiqueta">Cantidad</span>
        <Contador etiqueta="Cantidad" valor={cantidad} minimo={1} maximo={Math.max(maximo, 1)} alCambiar={setCantidad} />
      </div>
      <label className="campo">
        <span className="campo__etiqueta">
          Nota para la cocina <small>opcional</small>
        </span>
        <textarea
          className="entrada"
          rows={2}
          maxLength={NOTA_MAXIMA}
          placeholder="Ej.: sin cebolla, bien dorada"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </label>
    </Hoja>
  )
}
