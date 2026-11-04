import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Hueso } from './Esqueletos'

/** El QR del cobro: Factus Pay lo entrega como PNG en base64. Mientras llega, un hueso del mismo tamaño. */
export function QrImagen({ base64, etiqueta }: { base64: string | null; etiqueta: string }) {
  if (!base64) return <Hueso className="qr" />
  return <img className="qr" src={`data:image/png;base64,${base64}`} alt={etiqueta} />
}

/** El QR de la DIAN: Factus manda el enlace y la web lo dibuja. */
export function QrTexto({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [imagen, setImagen] = useState<string | null>(null)
  useEffect(() => {
    let vigente = true
    QRCode.toDataURL(texto, { margin: 1, width: 400, errorCorrectionLevel: 'M' })
      .then((url) => vigente && setImagen(url))
      .catch(() => vigente && setImagen(null))
    return () => {
      vigente = false
    }
  }, [texto])
  if (!imagen) return <Hueso className="qr" />
  return <img className="qr" src={imagen} alt={etiqueta} />
}
