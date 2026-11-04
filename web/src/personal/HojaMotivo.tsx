import { useEffect, useState } from 'react'
import type { LineaPedido } from '../../../contratos/tipos'
import { usarFuente } from '../datos/contexto'
import { Boton } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { Hoja } from '../ui/Hoja'

const TEXTOS = {
  rechazar: { titulo: 'Rechazar', ayuda: 'El cliente lo verá en su pedido.', boton: 'Rechazar' },
  anular: { titulo: 'Anular', ayuda: 'El cliente lo verá en su pedido y las unidades vuelven al inventario.', boton: 'Anular' },
}

/** Rechazar y anular siempre piden un motivo: la orden lo exige y el cliente lo ve. */
export function HojaMotivo({
  abierta,
  alCerrar,
  accion,
  linea,
  token,
}: {
  abierta: boolean
  alCerrar: () => void
  accion: 'rechazar' | 'anular'
  linea: LineaPedido
  token: string
}) {
  const fuente = usarFuente()
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const textos = TEXTOS[accion]

  useEffect(() => {
    if (!abierta) return
    setMotivo('')
    setError(null)
  }, [abierta])

  async function enviar() {
    setEnviando(true)
    setError(null)
    const solicitud = { lineaIds: [linea.id], motivo: motivo.trim() }
    try {
      if (accion === 'rechazar') await fuente.rechazarLineas(token, solicitud)
      else await fuente.anularLineas(token, solicitud)
      alCerrar()
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={`${textos.titulo}: ${linea.nombre}`}
      subtitulo={`${linea.cantidad}× · Ronda ${linea.ronda}`}
      pie={
        <Boton ancho variante="peligro" cargando={enviando} disabled={motivo.trim() === ''} onClick={() => void enviar()}>
          {textos.boton}
        </Boton>
      }
    >
      <AvisoError error={error} />
      <label className="campo">
        <span className="campo__etiqueta">Motivo</span>
        <input className="entrada" autoFocus maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <p className="ayuda-campo">{textos.ayuda}</p>
    </Hoja>
  )
}
