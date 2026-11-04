// `onRequest` entrega una petición de Express y Hono trabaja con `Request` y `Response` de la web.

interface PeticionFunciones {
  method: string
  originalUrl?: string
  url: string
  headers: Record<string, string | string[] | undefined>
  rawBody?: Buffer
}

interface RespuestaFunciones {
  status(codigo: number): RespuestaFunciones
  setHeader(nombre: string, valor: string): unknown
  send(cuerpo: Buffer): unknown
}

export function aPeticionWeb(req: PeticionFunciones): Request {
  const headers = new Headers()
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor !== undefined) headers.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor)
  }
  const conCuerpo = req.method !== 'GET' && req.method !== 'HEAD' && req.rawBody !== undefined
  return new Request(new URL(req.url, 'https://ribu.invalid'), {
    method: req.method,
    headers,
    ...(conCuerpo ? { body: new Uint8Array(req.rawBody as Buffer) } : {}),
  })
}

export async function enviarRespuesta(respuesta: Response, res: RespuestaFunciones) {
  res.status(respuesta.status)
  respuesta.headers.forEach((valor, nombre) => res.setHeader(nombre, valor))
  res.send(Buffer.from(await respuesta.arrayBuffer()))
}
