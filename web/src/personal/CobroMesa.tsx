import { useEffect, useState } from 'react'
import { PARTES_MAXIMAS, PARTES_MINIMAS, rutas, unidadesPorCubrir } from '../../../contratos/reglas'
import type { Cuenta } from '../../../contratos/tipos'
import type { ObjetivoPago } from '../cliente/Dividir'
import {
  divisionTerminada,
  itemsEleccion,
  lineasPorElegir,
  partesDeDivision,
  partesMaximas,
  subtotalEleccion,
  unidadesPorConfirmar,
  vistaPreviaPartes,
  type Eleccion,
  type EstadoParte,
} from '../cliente/cuenta'
import '../cliente/dividir.css'
import { usarFuente } from '../datos/contexto'
import type { Sesion } from '../datos/fuente'
import { Boton, Chip, Contador } from '../ui/Controles'
import { AvisoError } from '../ui/Estados'
import { pesos, plural } from '../ui/formato'
import { Hoja } from '../ui/Hoja'
import { Icono } from '../ui/Icono'
import { Enlace } from './Puerta'
import { usarAccion } from './usarAccion'

const ETIQUETA_PARTE: Record<EstadoParte, string> = { libre: 'Por cobrar', en_cobro: 'En cobro', pagada: 'Pagada' }
const TONO_PARTE: Record<EstadoParte, string> = { libre: 'gris', en_cobro: 'ambar', pagada: 'verde-suave' }

/** Cobrar todo, por productos o por partes iguales. Con la cuenta dividida, cada parte y su estado. */
export function CobroMesa({
  cuenta,
  sesion,
  token,
  alCobrar,
  alVerPago,
}: {
  cuenta: Cuenta
  sesion: Sesion
  token: string
  alCobrar: (objetivo: ObjetivoPago) => void
  alVerPago: (pagoId: string) => void
}) {
  const [hoja, setHoja] = useState<'partes' | 'productos' | null>(null)
  const partes = partesDeDivision(cuenta, sesion.uid)
  const pendientes = unidadesPorConfirmar(cuenta)

  const avisoPendientes = pendientes > 0 && (
    <p className="aviso aviso--ambar">
      <Icono nombre="reloj" tamano={18} />
      <span>{plural(pendientes, 'producto')} sin confirmar. Solo se cobra lo confirmado.</span>
    </p>
  )

  if (cuenta.division && !divisionTerminada(partes)) {
    return (
      <>
        {avisoPendientes}
        <PartesDeLaCuenta cuenta={cuenta} partes={partes} token={token} alCobrar={alCobrar} alVerPago={alVerPago} />
      </>
    )
  }
  if (cuenta.porPagar === 0) return avisoPendientes || null

  const maximo = partesMaximas(cuenta.porPagar, PARTES_MAXIMAS)
  const sePuedeDividir = cuenta.enCobro === 0 && maximo >= PARTES_MINIMAS

  return (
    <section className="tarjeta cobro-mesa" aria-label="Cobrar">
      <h2 className="tarjeta__titulo">Cobrar en efectivo o con tarjeta</h2>
      {avisoPendientes}
      <Boton ancho onClick={() => alCobrar({ titulo: 'Cobrar la cuenta', subtotal: cuenta.porPagar, destino: { tipo: 'saldo' } })}>
        Cobrar todo {pesos(cuenta.porPagar)}
      </Boton>
      <div className="acciones">
        <Boton variante="secundario" onClick={() => setHoja('productos')}>
          Por productos
        </Boton>
        <Boton variante="secundario" disabled={!sePuedeDividir} onClick={() => setHoja('partes')}>
          Por partes
        </Boton>
      </div>
      {!sePuedeDividir && <p className="ayuda-campo">{cuenta.enCobro > 0 ? 'No se puede dividir con un cobro activo.' : 'No alcanza para dividir: cada parte debe llegar al mínimo de Factus Pay.'}</p>}
      <p className="ayuda-campo">
        ¿Con QR de Factus Pay? <Enlace a={rutas.paginaMesa(token)}>Se cobra desde el link de la mesa</Enlace>.
      </p>
      <HojaPartes abierta={hoja === 'partes'} alCerrar={() => setHoja(null)} porPagar={cuenta.porPagar} maximo={maximo} token={token} />
      <HojaProductos
        abierta={hoja === 'productos'}
        alCerrar={() => setHoja(null)}
        cuenta={cuenta}
        alContinuar={(objetivo) => {
          setHoja(null)
          alCobrar(objetivo)
        }}
      />
    </section>
  )
}

function PartesDeLaCuenta({
  cuenta,
  partes,
  token,
  alCobrar,
  alVerPago,
}: {
  cuenta: Cuenta
  partes: ReturnType<typeof partesDeDivision>
  token: string
  alCobrar: (objetivo: ObjetivoPago) => void
  alVerPago: (pagoId: string) => void
}) {
  const fuente = usarFuente()
  const { ocupado, ejecutar } = usarAccion()
  const pagadas = partes.filter((p) => p.estado === 'pagada').length
  const todasLibres = partes.every((p) => p.estado === 'libre')

  return (
    <section className="tarjeta partes" aria-label="División de la cuenta">
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
                {ETIQUETA_PARTE[parte.estado]}
              </Chip>
            </span>
            {parte.estado === 'libre' ? (
              <Boton
                variante="secundario"
                aria-label={`Cobrar la parte ${parte.numero}`}
                onClick={() => alCobrar({ titulo: `Cobrar la parte ${parte.numero}`, subtotal: parte.monto, destino: { tipo: 'parte_igual', parte: parte.numero } })}
              >
                Cobrar
              </Boton>
            ) : (
              parte.pago && (
                <button className="icono-boton" aria-label={`Ver el pago de la parte ${parte.numero}`} onClick={() => alVerPago(parte.pago!.id)}>
                  <Icono nombre="derecha" tamano={18} />
                </button>
              )
            )}
          </li>
        ))}
      </ol>
      {todasLibres ? (
        <Boton variante="fantasma" cargando={ocupado === 'quitar'} onClick={() => void ejecutar('quitar', () => fuente.quitarDivision(token))}>
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
        <Boton ancho cargando={enviando} disabled={!alcanza} onClick={() => void dividir()}>
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
      <p className="ayuda-campo">Si sobran pesos, van a las primeras partes. Después de que alguien empiece a pagar, la división ya no cambia.</p>
    </Hoja>
  )
}

/** Sin mínimo de monto: en efectivo o con tarjeta se puede cobrar lo que Factus Pay no recibe. */
function HojaProductos({ abierta, alCerrar, cuenta, alContinuar }: { abierta: boolean; alCerrar: () => void; cuenta: Cuenta; alContinuar: (objetivo: ObjetivoPago) => void }) {
  const [eleccion, setEleccion] = useState<Eleccion>({})
  useEffect(() => {
    if (abierta) setEleccion({})
  }, [abierta])

  const lineas = lineasPorElegir(cuenta)
  const subtotal = subtotalEleccion(cuenta, eleccion)
  const unidades = Object.values(eleccion).reduce((suma, n) => suma + n, 0)

  return (
    <Hoja
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Elige qué cobrar"
      subtitulo="Solo lo que ningún otro pago cubre"
      pie={
        <>
          <div className="fila-total">
            <span>{unidades === 0 ? 'Elige al menos un producto' : plural(unidades, 'producto')}</span>
            <strong>{unidades === 0 ? '—' : pesos(subtotal)}</strong>
          </div>
          <Boton ancho disabled={unidades === 0} onClick={() => alContinuar({ titulo: 'Cobrar lo elegido', subtotal, destino: { tipo: 'productos', items: itemsEleccion(eleccion) } })}>
            Continuar{unidades === 0 ? '' : ` · ${pesos(subtotal)}`}
          </Boton>
        </>
      }
    >
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
