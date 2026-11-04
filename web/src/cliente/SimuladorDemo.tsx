import { useState } from 'react'
import { usarFuente } from '../datos/contexto'
import type { Simulador } from '../datos/fuente'

const RESPUESTAS: { valor: ReturnType<Simulador['respuestaDian']>; texto: string }[] = [
  { valor: 'emitida', texto: 'Emite' },
  { valor: 'en_validacion', texto: 'Se demora' },
  { valor: 'rechazada', texto: 'Rechaza' },
]

/** Solo aparece con la versión en memoria: hace de banco y de DIAN. Con Firebase no existe. */
export function SimuladorDemo({ referencia }: { referencia: string }) {
  const { simulador } = usarFuente()
  const [respuesta, setRespuesta] = useState(() => simulador?.respuestaDian() ?? 'emitida')
  if (!simulador) return null
  return (
    <details className="simulador">
      <summary>Modo demo: simular el banco y la DIAN</summary>
      <div className="simulador__cuerpo">
        <div className="simulador__fila" role="radiogroup" aria-label="Qué responde la DIAN">
          <span>La DIAN</span>
          {RESPUESTAS.map((r) => (
            <button
              key={r.valor}
              role="radio"
              aria-checked={respuesta === r.valor}
              className="categorias__chip"
              onClick={() => {
                simulador.elegirRespuestaDian(r.valor)
                setRespuesta(r.valor)
              }}
            >
              {r.texto}
            </button>
          ))}
        </div>
        <div className="simulador__fila">
          <button className="boton boton--secundario" onClick={() => simulador.pagarCobro(referencia)}>
            Simular pago
          </button>
          <button className="boton boton--fantasma" onClick={() => simulador.vencerCobro(referencia)}>
            Vencer el QR
          </button>
        </div>
      </div>
    </details>
  )
}
