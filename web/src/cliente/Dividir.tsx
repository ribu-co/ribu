import { useEffect, useState } from 'react'
import { MONTO_MINIMO_COBRO, PARTES_MAXIMAS, PARTES_MINIMAS, unidadesPorCubrir } from '../../../contratos/reglas'
import type { Cuenta, DestinoPago } from '../../../contratos/tipos'
import { usarFuente } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { usarAvisos } from '../ui/Avisos'
import { Boton, Chip, Contador } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos, plural } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import {
  divisionTerminada,
  itemsEleccion,
  lineasPorElegir,
  miCobroActivo,
  partesDeDivision,
  partesMaximas,
  subtotalEleccion,
  vistaPreviaPartes,
  type Eleccion,
  type EstadoParte,
  type Parte,
} from './cuenta'
import './dividir.css'

/** Lo que se va a pagar: se elige antes de abrir la hoja de propina y comprador. */
export interface ObjetivoPago {
  titulo: string
  /** Solo para mostrar: el backend vuelve a calcular el monto con `destino`. */
  subtotal: number
  destino: DestinoPago
}

const ETIQUETA_PARTE: Record<EstadoParte, string> = { libre: 'Libre', en_cobro: 'En cobro', pagada: 'Pagada' }
const TONO_PARTE: Record<EstadoParte, string> = { libre: 'gris', en_cobro: 'ambar', pagada: 'verde-suave' }

/** Pagar todo, dividir en partes iguales o elegir productos. Con la cuenta dividida, cada parte y su estado. */
export function OpcionesPago({
  cuenta,
  sesion,
  token,
  alPagar,
  alVerPago,
}: {
  cuenta: Cuenta
  sesion: Sesion
  token: string
  alPagar: (objetivo: ObjetivoPago) => void
  alVerPago: (pagoId: string) => void
}) {
  const [hoja, setHoja] = useState<'partes' | 'productos' | null>(null)
  const partes = partesDeDivision(cuenta, sesion.uid)
  const mio = miCobroActivo(cuenta, sesion.uid)

  if (cuenta.division && !divisionTerminada(partes)) {
    return <PartesIguales cuenta={cuenta} partes={partes} token={token} ocupado={mio !== null} alPagar={alPagar} alVerPago={alVerPago} />
  }
  if (cuenta.porPagar === 0 || mio) return null

  const maximo = partesMaximas(cuenta.porPagar, PARTES_MAXIMAS)
  const sePuedeDividir = cuenta.enCobro === 0 && maximo >= PARTES_MINIMAS
  return (
    <section className="opciones-pago entra" aria-label="Cómo pagar">
      <Boton ancho onClick={() => alPagar({ titulo: 'Pagar la cuenta', subtotal: cuenta.porPagar, destino: { tipo: 'saldo' } })}>
        Pagar todo {pesos(cuenta.porPagar)}
      </Boton>
      <div className="opciones-pago__division">
        <button className="accion-dividir" disabled={!sePuedeDividir} onClick={() => setHoja('partes')}>
          <span className="accion-dividir__icono">
            <Icono nombre="dividir" tamano={20} />
          </span>
          <strong>Partes iguales</strong>
          <span>{sePuedeDividir ? `De 2 a ${maximo} personas` : cuenta.enCobro > 0 ? 'Hay un cobro activo' : `Cada parte necesita ${pesos(MONTO_MINIMO_COBRO)}`}</span>
        </button>
        <button className="accion-dividir" onClick={() => setHoja('productos')}>
          <span className="accion-dividir__icono">
            <Icono nombre="bolsa" tamano={20} />
          </span>
          <strong>Elegir productos</strong>
          <span>Paga solo lo tuyo</span>
        </button>
      </div>
      <HojaPartes abierta={hoja === 'partes'} alCerrar={() => setHoja(null)} porPagar={cuenta.porPagar} maximo={maximo} token={token} />
      <HojaProductos
        abierta={hoja === 'productos'}
        alCerrar={() => setHoja(null)}
        cuenta={cuenta}
        alContinuar={(objetivo) => {
          setHoja(null)
          alPagar(objetivo)
        }}
      />
    </section>
  )
}

function PartesIguales({
  cuenta,
  partes,
  token,
  ocupado,
  alPagar,
  alVerPago,
}: {
  cuenta: Cuenta
  partes: Parte[]
  token: string
  ocupado: boolean
  alPagar: (objetivo: ObjetivoPago) => void
  alVerPago: (pagoId: string) => void
}) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [quitando, setQuitando] = useState(false)
  const pagadas = partes.filter((p) => p.estado === 'pagada').length
  const todasLibres = partes.every((p) => p.estado === 'libre')

  return (
    <section className="tarjeta partes entra" aria-label="Partes de la cuenta">
      <header className="partes__cabeza">
        <h2 className="tarjeta__titulo">Dividida en {cuenta.division?.partes} partes</h2>
        <span className="partes__avance">
          {pagadas} de {partes.length} pagadas
        </span>
      </header>
      <ol className="partes__lista">
        {partes.map((parte) => (
          <li key={parte.numero} className="parte" data-estado={parte.estado}>
            <span className="parte__numero">{parte.numero}</span>
            <span className="parte__texto">
              <strong>{pesos(parte.monto)}</strong>
              <Chip tono={TONO_PARTE[parte.estado]} rayado={parte.estado === 'en_cobro'}>
                {parte.estado !== 'libre' && parte.mia ? `${ETIQUETA_PARTE[parte.estado]} por ti` : ETIQUETA_PARTE[parte.estado]}
              </Chip>
            </span>
            {parte.estado === 'libre' && (
              <Boton
                variante="secundario"
                disabled={ocupado}
                onClick={() =>
                  alPagar({ titulo: `Pagar la parte ${parte.numero}`, subtotal: parte.monto, destino: { tipo: 'parte_igual', parte: parte.numero } })
                }
              >
                Pagar
              </Boton>
            )}
            {parte.estado !== 'libre' && parte.mia && parte.pago && (
              <button className="icono-boton" aria-label={`Ver el pago de la parte ${parte.numero}`} onClick={() => alVerPago(parte.pago!.id)}>
                <Icono nombre="derecha" tamano={18} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {ocupado && <p className="ayuda-campo">Termina tu cobro activo antes de pagar otra parte.</p>}
      {todasLibres ? (
        <Boton
          variante="fantasma"
          cargando={quitando}
          onClick={async () => {
            setQuitando(true)
            try {
              await fuente.quitarDivision(token)
            } catch (e) {
              avisos.error(e)
            } finally {
              setQuitando(false)
            }
          }}
        >
          Quitar la división
        </Boton>
      ) : (
        <p className="ayuda-campo">La división ya no cambia: hay partes cobrándose o pagadas.</p>
      )}
    </section>
  )
}

function HojaPartes({ abierta, alCerrar, porPagar, maximo, token }: { abierta: boolean; alCerrar: () => void; porPagar: number; maximo: number; token: string }) {
  const fuente = usarFuente()
  const avisos = usarAvisos()
  const [partes, setPartes] = useState(PARTES_MINIMAS)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!abierta) return
    setPartes(PARTES_MINIMAS)
    setError(null)
  }, [abierta])

  const tope = Math.max(PARTES_MINIMAS, maximo)
  const cantidad = Math.min(partes, tope)
  const { montos, alcanza } = vistaPreviaPartes(porPagar, cantidad)

  async function dividir() {
    setEnviando(true)
    setError(null)
    try {
      await fuente.dividirEnPartesIguales(token, { partes: cantidad })
      avisos.exito(`Cuenta dividida en ${cantidad}`, 'Cada quien paga su parte desde su celular.')
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
      titulo="Partes iguales"
      subtitulo={`Por pagar ${pesos(porPagar)}`}
      pie={
        <Boton ancho cargando={enviando} disabled={!alcanza} onClick={dividir}>
          Dividir en {cantidad}
        </Boton>
      }
    >
      <AvisoError error={error} />
      <div className="campo campo--fila">
        <span className="campo__etiqueta">Personas</span>
        <Contador valor={cantidad} alCambiar={setPartes} minimo={PARTES_MINIMAS} maximo={tope} etiqueta="Número de partes" />
      </div>
      <ul className="vista-partes" aria-label="Cuánto paga cada parte">
        {montos.map((monto, i) => (
          <li key={i}>
            <span>Parte {i + 1}</span>
            <strong>{pesos(monto)}</strong>
          </li>
        ))}
      </ul>
      <p className="ayuda-campo">
        Si sobran pesos, van a las primeras partes. Después de que alguien empiece a pagar, la división ya no cambia.
      </p>
    </Hoja>
  )
}

function HojaProductos({
  abierta,
  alCerrar,
  cuenta,
  alContinuar,
}: {
  abierta: boolean
  alCerrar: () => void
  cuenta: Cuenta
  alContinuar: (objetivo: ObjetivoPago) => void
}) {
  const [eleccion, setEleccion] = useState<Eleccion>({})
  useEffect(() => {
    if (abierta) setEleccion({})
  }, [abierta])

  const lineas = lineasPorElegir(cuenta)
  const subtotal = subtotalEleccion(cuenta, eleccion)
  const unidades = Object.values(eleccion).reduce((suma, n) => suma + n, 0)
  const bajoMinimo = subtotal > 0 && subtotal < MONTO_MINIMO_COBRO

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Elige lo tuyo"
      subtitulo="Solo lo que nadie más está pagando"
      pie={
        <>
          <div className="fila-total">
            <span>{unidades === 0 ? 'Elige al menos un producto' : plural(unidades, 'producto')}</span>
            <strong>{unidades === 0 ? '—' : pesos(subtotal)}</strong>
          </div>
          <Boton
            ancho
            disabled={unidades === 0 || bajoMinimo}
            onClick={() => alContinuar({ titulo: 'Pagar lo que elegiste', subtotal, destino: { tipo: 'productos', items: itemsEleccion(eleccion) } })}
          >
            Continuar{unidades === 0 ? '' : ` · ${pesos(subtotal)}`}
          </Boton>
        </>
      }
    >
      {bajoMinimo && (
        <p className="aviso aviso--ambar">
          <Icono nombre="alerta" tamano={18} />
          <span>Factus Pay cobra desde {pesos(MONTO_MINIMO_COBRO)}. Agrega algo más o paga con el mesero.</span>
        </p>
      )}
      {lineas.length === 0 ? (
        <p className="ayuda-campo">Todo lo confirmado ya está en un pago.</p>
      ) : (
        <ul className="eleccion">
          {lineas.map((linea) => {
            const libres = unidadesPorCubrir(linea)
            return (
              <li key={linea.id} className="eleccion__linea">
                <span className="eleccion__texto">
                  <strong>{linea.nombre}</strong>
                  <span>
                    {pesos(linea.precio)} c/u · {libres === linea.cantidad ? `${linea.cantidad} por pagar` : `${libres} de ${linea.cantidad} por pagar`}
                  </span>
                </span>
                <Contador
                  valor={eleccion[linea.id] ?? 0}
                  alCambiar={(valor) => setEleccion((actual) => ({ ...actual, [linea.id]: valor }))}
                  maximo={libres}
                  etiqueta={`Unidades de ${linea.nombre}`}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Hoja>
  )
}
