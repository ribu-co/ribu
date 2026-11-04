import { useEffect, useState } from 'react'
import { calcularPropina, MONTO_MAXIMO_COBRO, MONTO_MINIMO_COBRO } from '../../../contratos/reglas'
import { TIPOS_DOCUMENTO, type Comprador, type DestinoPago, type Pago, type Pesos, type Restaurante, type TipoDocumento } from '../../../contratos/tipos'
import { usarFuente } from '../datos/contexto'
import { compradorValido } from '../datos/comprador'
import { Boton, Pestanas } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { leerPorcentaje, opcionesPropina } from './cuenta'

type TipoComprador = Comprador['tipo']

interface DatosComprador {
  correo: string
  tipoDocumento: TipoDocumento
  documento: string
  nombre: string
  nit: string
  razonSocial: string
}

const VACIO: DatosComprador = { correo: '', tipoDocumento: 'CC', documento: '', nombre: '', nit: '', razonSocial: '' }

/** 900.123.456-7: el dígito de verificación lo calcula Factus, y dejarlo pegado daría otro NIT. */
export const nitConDigito = (nit: string) => /[-–—]\s*\d\s*$/.test(nit)

export function armarComprador(tipo: TipoComprador, datos: DatosComprador): Comprador {
  const correo = datos.correo.trim()
  if (tipo === 'persona') {
    return { tipo, tipoDocumento: datos.tipoDocumento, documento: datos.documento.trim(), nombre: datos.nombre.trim(), correo }
  }
  // Solo quita puntos y espacios. Con otro carácter no pasa la validación: quitarlo cambiaría el NIT sin avisar.
  if (tipo === 'empresa') return { tipo, nit: datos.nit.replace(/[.\s]/g, ''), razonSocial: datos.razonSocial.trim(), correo }
  return { tipo, correo: correo || null }
}

/**
 * Antes de generar el QR se elige la propina, porque el QR solo acepta el monto exacto.
 * Nada viene preseleccionado: la propina es voluntaria y nunca se asume.
 */
export function HojaPagar({
  abierta,
  alCerrar,
  titulo,
  subtotal,
  destino,
  restaurante,
  token,
  alCrear,
}: {
  abierta: boolean
  alCerrar: () => void
  titulo: string
  /** Lo que cubre el pago, con impuesto. Viene de la cuenta: la web no lo calcula ni lo envía. */
  subtotal: Pesos
  destino: DestinoPago
  restaurante: Restaurante
  token: string
  alCrear: (pago: Pago) => void
}) {
  const fuente = usarFuente()
  const [modo, setModo] = useState<'sugerida' | 'otra' | 'sin' | null>(null)
  const [sugerida, setSugerida] = useState<number | null>(null)
  const [otra, setOtra] = useState('')
  const [tipo, setTipo] = useState<TipoComprador>('consumidor_final')
  const [datos, setDatos] = useState<DatosComprador>(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!abierta) return
    setModo(null)
    setSugerida(null)
    setOtra('')
    setError(null)
  }, [abierta])

  const porcentaje = modo === 'sin' ? 0 : modo === 'sugerida' ? sugerida : modo === 'otra' ? leerPorcentaje(otra) : null
  const propina = porcentaje === null ? null : calcularPropina(subtotal, restaurante.impuesto, porcentaje)
  const total = subtotal + (propina ?? 0)
  const comprador = armarComprador(tipo, datos)
  const datosValidos = compradorValido(comprador)
  const fueraDeRango = propina !== null && (total < MONTO_MINIMO_COBRO || total > MONTO_MAXIMO_COBRO)
  const cambiar = (campo: keyof DatosComprador) => (e: { target: { value: string } }) => setDatos({ ...datos, [campo]: e.target.value })

  async function generar() {
    if (porcentaje === null || !datosValidos) return
    setEnviando(true)
    setError(null)
    try {
      const pago = await fuente.crearPago(token, { destino, propinaPorcentaje: porcentaje, comprador, medio: 'factus_pay' })
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
          <Boton ancho cargando={enviando} disabled={propina === null || !datosValidos || fueraDeRango} onClick={generar}>
            Generar cobro{propina === null ? '' : ` · ${pesos(total)}`}
          </Boton>
        </>
      }
    >
      <AvisoError error={error ?? (fueraDeRango ? { codigo: 'MONTO_FUERA_DE_RANGO' } : null)} />

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
                placeholder="Ej.: 12"
                value={otra}
                onChange={(e) => setOtra(e.target.value.replace(/\D/g, ''))}
                aria-invalid={otra !== '' && leerPorcentaje(otra) === null}
              />
              <span>%</span>
            </div>
          </label>
        )}
      </fieldset>

      <fieldset className="grupo">
        <legend className="campo__etiqueta">Factura electrónica a nombre de</legend>
        <Pestanas
          etiqueta="Tipo de comprador"
          valor={tipo}
          alCambiar={setTipo}
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
              <input className="entrada" autoComplete="name" value={datos.nombre} onChange={cambiar('nombre')} />
            </label>
          </div>
        )}
        {tipo === 'empresa' && (
          <div className="campos entra">
            <label className="campo">
              <span className="campo__etiqueta">
                NIT <small>sin dígito de verificación</small>
              </span>
              <input className="entrada" inputMode="numeric" value={datos.nit} onChange={cambiar('nit')} placeholder="900123456" />
            </label>
            <label className="campo">
              <span className="campo__etiqueta">Razón social</span>
              <input className="entrada" autoComplete="organization" value={datos.razonSocial} onChange={cambiar('razonSocial')} />
            </label>
          </div>
        )}
        <label className="campo">
          <span className="campo__etiqueta">
            Correo {tipo === 'consumidor_final' && <small>opcional, para enviarte la factura</small>}
          </span>
          <input
            className="entrada"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            value={datos.correo}
            onChange={cambiar('correo')}
          />
        </label>
        {!datosValidos && (tipo !== 'consumidor_final' || datos.correo.trim() !== '') && (
          <p className="ayuda-campo ayuda-campo--alerta">
            {tipo === 'empresa' && nitConDigito(datos.nit)
              ? 'Escribe el NIT sin el dígito de verificación, sin el guion ni el número que le sigue.'
              : tipo === 'consumidor_final'
                ? 'Revisa el correo.'
                : 'Completa documento, nombre y un correo válido.'}
          </p>
        )}
      </fieldset>
    </Hoja>
  )
}
