import { useState } from 'react'
import { TIPOS_DOCUMENTO, type Comprador, type SolicitudReintentoFactura, type TipoDocumento } from '../../../contratos/tipos'
import { Boton } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { Hoja } from '../ui/Hoja'
import { Campo } from './comunes'
import { datosDeComprador, solicitudReintento, type DatosComprador } from './formularios'

const TIPOS: readonly { valor: Comprador['tipo']; texto: string }[] = [
  { valor: 'consumidor_final', texto: 'Consumidor final' },
  { valor: 'persona', texto: 'Persona' },
  { valor: 'empresa', texto: 'Empresa' },
]

/** Una factura o una nota rechazada: se corrige lo que estaba mal, o se reintenta si el error no era del comprador. */
export function HojaComprador({
  titulo,
  comprador,
  ultimoError,
  alReintentar,
  alCerrar,
}: {
  titulo: string
  comprador: Comprador
  ultimoError: string | null
  alReintentar: (solicitud: SolicitudReintentoFactura) => Promise<unknown>
  alCerrar: () => void
}) {
  const [tipo, setTipo] = useState(comprador.tipo)
  const [datos, setDatos] = useState<DatosComprador>(() => datosDeComprador(comprador))
  const [error, setError] = useState<unknown>(null)
  const [enviando, setEnviando] = useState(false)
  const solicitud = solicitudReintento(comprador, tipo, datos)
  const cambiar = (campo: keyof DatosComprador) => (e: { target: { value: string } }) => setDatos({ ...datos, [campo]: e.target.value })

  async function enviar() {
    if (!solicitud) return
    setEnviando(true)
    setError(null)
    try {
      await alReintentar(solicitud)
      alCerrar()
    } catch (e) {
      setError(e)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja
      abierta
      alCerrar={alCerrar}
      titulo={titulo}
      subtitulo="Se reemite con la misma referencia."
      pie={
        <Boton ancho cargando={enviando} disabled={!solicitud} onClick={enviar}>
          {solicitud?.comprador ? 'Corregir y reintentar' : 'Reintentar sin cambios'}
        </Boton>
      }
    >
      {ultimoError && (
        <div className="aviso aviso--error">
          <div>
            <strong>Lo que respondió la DIAN</strong>
            <span>{ultimoError}</span>
          </div>
        </div>
      )}
      <AvisoError error={error} />
      <Campo etiqueta="Tipo de comprador">
        <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as Comprador['tipo'])}>
          {TIPOS.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </Campo>
      {tipo === 'persona' && (
        <>
          <Campo etiqueta="Tipo de documento">
            <select className="entrada" value={datos.tipoDocumento} onChange={(e) => setDatos({ ...datos, tipoDocumento: e.target.value as TipoDocumento })}>
              {TIPOS_DOCUMENTO.map((documento) => (
                <option key={documento}>{documento}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Documento">
            <input className="entrada" value={datos.documento} onChange={cambiar('documento')} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input className="entrada" value={datos.nombre} onChange={cambiar('nombre')} />
          </Campo>
        </>
      )}
      {tipo === 'empresa' && (
        <>
          <Campo etiqueta="NIT" ayuda="Sin dígito de verificación.">
            <input className="entrada" inputMode="numeric" value={datos.nit} onChange={cambiar('nit')} />
          </Campo>
          <Campo etiqueta="Razón social">
            <input className="entrada" value={datos.razonSocial} onChange={cambiar('razonSocial')} />
          </Campo>
        </>
      )}
      <Campo etiqueta={tipo === 'consumidor_final' ? 'Correo (opcional)' : 'Correo'}>
        <input className="entrada" type="email" inputMode="email" value={datos.correo} onChange={cambiar('correo')} />
      </Campo>
      {!solicitud && <p className="ayuda-campo">Faltan datos o hay alguno que no es válido.</p>}
    </Hoja>
  )
}
