import { useEffect, useState } from 'react'
import { calcularPropina } from '../../../contratos/reglas'
import { TIPOS_DOCUMENTO, type Comprador, type MedioPago, type Pago, type Restaurante } from '../../../contratos/tipos'
import type { ObjetivoPago } from '../cliente/Dividir'
import { armarComprador } from '../cliente/HojaPagar'
import { leerPorcentaje, opcionesPropina } from '../cliente/cuenta'
import { compradorValido } from '../datos/comprador'
import { usarFuente } from '../datos/contexto'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Pestanas } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { ETIQUETA_MEDIO, MEDIOS_DEL_PERSONAL } from './logica'

export type TipoComprador = Comprador['tipo']
export type DatosComprador = Parameters<typeof armarComprador>[1]

export const COMPRADOR_VACIO: DatosComprador = { correo: '', tipoDocumento: 'CC', documento: '', nombre: '', nit: '', razonSocial: '' }

/** A nombre de quién sale la factura. Lo reusan el cobro y la corrección de una factura rechazada. */
export function FormularioComprador({
  tipo,
  datos,
  alCambiarTipo,
  alCambiarDatos,
}: {
  tipo: TipoComprador
  datos: DatosComprador
  alCambiarTipo: (tipo: TipoComprador) => void
  alCambiarDatos: (datos: DatosComprador) => void
}) {
  const cambiar = (campo: keyof DatosComprador) => (e: { target: { value: string } }) => alCambiarDatos({ ...datos, [campo]: e.target.value })
  const valido = compradorValido(armarComprador(tipo, datos))

  return (
    <fieldset className="grupo">
      <legend className="campo__etiqueta">Factura electrónica a nombre de</legend>
      <Pestanas
        etiqueta="Tipo de comprador"
        valor={tipo}
        alCambiar={alCambiarTipo}
        opciones={[
          { valor: 'consumidor_final', texto: 'Consumidor final' },
          { valor: 'persona', texto: 'Persona' },
          { valor: 'empresa', texto: 'Empresa' },
        ]}
      />
      {tipo === 'persona' && (
        <div className="campos entra">
          <div className="campos__fila">
            <label className="campo campo--corto">
              <span className="campo__etiqueta">Tipo</span>
              <select className="entrada" value={datos.tipoDocumento} onChange={cambiar('tipoDocumento')}>
                {TIPOS_DOCUMENTO.filter((t) => t !== 'NIT').map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo__etiqueta">Número de documento</span>
              <input className="entrada" inputMode="numeric" autoComplete="off" value={datos.documento} onChange={cambiar('documento')} />
            </label>
          </div>
          <label className="campo">
            <span className="campo__etiqueta">Nombre completo</span>
            <input className="entrada" autoComplete="off" value={datos.nombre} onChange={cambiar('nombre')} />
          </label>
        </div>
      )}
      {tipo === 'empresa' && (
        <div className="campos entra">
          <label className="campo">
            <span className="campo__etiqueta">
              NIT <small>sin dígito de verificación</small>
            </span>
            <input className="entrada" inputMode="numeric" autoComplete="off" value={datos.nit} onChange={cambiar('nit')} />
          </label>
          <label className="campo">
            <span className="campo__etiqueta">Razón social</span>
            <input className="entrada" autoComplete="off" value={datos.razonSocial} onChange={cambiar('razonSocial')} />
          </label>
        </div>
      )}
      <label className="campo">
        <span className="campo__etiqueta">Correo {tipo === 'consumidor_final' && <small>opcional, para enviar la factura</small>}</span>
        <input className="entrada" type="email" inputMode="email" autoComplete="off" value={datos.correo} onChange={cambiar('correo')} />
      </label>
      {!valido && (tipo !== 'consumidor_final' || datos.correo.trim() !== '') && (
        <p className="ayuda-campo ayuda-campo--alerta">
          {tipo === 'consumidor_final' ? 'Revisa el correo.' : 'Completa documento, nombre y un correo válido.'}
        </p>
      )}
    </fieldset>
  )
}

/**
 * Efectivo y tarjeta los registra el personal y quedan pagados de una vez. Nada viene preseleccionado:
 * ni el medio, que va en la factura, ni la propina, que es voluntaria y nunca se asume.
 */
export function HojaCobrar({
  abierta,
  alCerrar,
  objetivo,
  restaurante,
  token,
  alCrear,
}: {
  abierta: boolean
  alCerrar: () => void
  objetivo: ObjetivoPago
  restaurante: Restaurante
  token: string
  alCrear: (pago: Pago) => void
}) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [medio, setMedio] = useState<MedioPago | null>(null)
  const [modo, setModo] = useState<'sugerida' | 'otra' | 'sin' | null>(null)
  const [sugerida, setSugerida] = useState<number | null>(null)
  const [otra, setOtra] = useState('')
  const [tipo, setTipo] = useState<TipoComprador>('consumidor_final')
  const [datos, setDatos] = useState<DatosComprador>(COMPRADOR_VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!abierta) return
    setMedio(null)
    setModo(null)
    setSugerida(null)
    setOtra('')
    setTipo('consumidor_final')
    setDatos(COMPRADOR_VACIO)
    setError(null)
  }, [abierta])

  const { subtotal, destino, titulo } = objetivo
  const porcentaje = modo === 'sin' ? 0 : modo === 'sugerida' ? sugerida : modo === 'otra' ? leerPorcentaje(otra) : null
  const propina = porcentaje === null ? null : calcularPropina(subtotal, restaurante.impuesto, porcentaje)
  const total = subtotal + (propina ?? 0)
  const comprador = armarComprador(tipo, datos)
  const listo = medio !== null && porcentaje !== null && compradorValido(comprador)

  async function registrar() {
    if (medio === null || porcentaje === null) return
    setEnviando(true)
    setError(null)
    try {
      const pago = await fuente.crearPago(token, { destino, propinaPorcentaje: porcentaje, comprador, medio })
      avisos.exito('Pago registrado', 'La factura se está emitiendo.')
      alCrear(pago)
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
      titulo={titulo}
      subtitulo={`Consumo ${pesos(subtotal)} · ${restaurante.impuesto.tipo === 'ninguno' ? 'sin impuesto' : `${restaurante.impuesto.tipo} incluido`}`}
      pie={
        <>
          <div className="fila-total">
            <span>{propina === null ? 'Elige la propina para ver el total' : `Total con propina de ${pesos(propina)}`}</span>
            <strong>{propina === null ? '—' : pesos(total)}</strong>
          </div>
          <Boton ancho cargando={enviando} disabled={!listo} onClick={() => void registrar()}>
            {medio ? `Registrar ${ETIQUETA_MEDIO[medio].toLowerCase()}` : 'Registrar el pago'}
            {propina === null ? '' : ` · ${pesos(total)}`}
          </Boton>
        </>
      }
    >
      <AvisoError error={error} />

      <fieldset className="grupo">
        <legend className="campo__etiqueta">Medio de pago</legend>
        <div className="opciones" role="radiogroup" aria-label="Medio de pago">
          {MEDIOS_DEL_PERSONAL.map((m) => (
            <button key={m} role="radio" aria-checked={medio === m} className="opcion" onClick={() => setMedio(m)}>
              <strong>{ETIQUETA_MEDIO[m]}</strong>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="grupo">
        <legend className="campo__etiqueta">Propina para el equipo</legend>
        <p className="ayuda-campo">Es voluntaria. Se calcula sobre el consumo sin impuesto.</p>
        <div className="opciones" role="radiogroup" aria-label="Propina">
          {opcionesPropina(restaurante.propinasSugeridas).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={modo === 'sugerida' && sugerida === p}
              className="opcion"
              onClick={() => {
                setModo('sugerida')
                setSugerida(p)
              }}
            >
              <strong>{p} %</strong>
              <span>{pesos(calcularPropina(subtotal, restaurante.impuesto, p))}</span>
            </button>
          ))}
          <button role="radio" aria-checked={modo === 'otra'} className="opcion" onClick={() => setModo('otra')}>
            <strong>Otro</strong>
            <span>{modo === 'otra' && propina !== null ? pesos(propina) : '%'}</span>
          </button>
          <button role="radio" aria-checked={modo === 'sin'} className="opcion" onClick={() => setModo('sin')}>
            <strong>Sin propina</strong>
            <span>$0</span>
          </button>
        </div>
        {modo === 'otra' && (
          <label className="campo entra">
            <span className="campo__etiqueta">Porcentaje</span>
            <div className="entrada-sufijo">
              <input
                className="entrada"
                inputMode="numeric"
                autoFocus
                maxLength={3}
                value={otra}
                onChange={(e) => setOtra(e.target.value.replace(/\D/g, ''))}
                aria-invalid={otra !== '' && leerPorcentaje(otra) === null}
              />
              <span>%</span>
            </div>
          </label>
        )}
      </fieldset>

      <FormularioComprador tipo={tipo} datos={datos} alCambiarTipo={setTipo} alCambiarDatos={setDatos} />
    </Hoja>
  )
}
