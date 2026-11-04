// Un `fetch` de mentira para las pruebas: nunca sale a internet.

export interface LlamadaFalsa {
  url: URL
  metodo: string
  headers: Headers
  cuerpo: string | null
}

export type Responder = (llamada: LlamadaFalsa) => Response | Promise<Response>

export const json = (cuerpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/** Responde según la ruta y guarda cada llamada para revisarla después. */
export function crearFetchFalso(responder: Responder) {
  const llamadas: LlamadaFalsa[] = []
  const fetchFalso = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const llamada: LlamadaFalsa = {
      url: new URL(String(entrada)),
      metodo: init.method ?? 'GET',
      headers: new Headers(init.headers),
      cuerpo: init.body == null ? null : String(init.body),
    }
    llamadas.push(llamada)
    return responder(llamada)
  }) as typeof fetch
  return { fetch: fetchFalso, llamadas }
}
