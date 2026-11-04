/** Copia al portapapeles. En http sin candado no existe `navigator.clipboard`, y se usa el método viejo. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // Sigue con el método viejo.
  }
  const area = document.createElement('textarea')
  area.value = texto
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, texto.length)
  const listo = document.execCommand('copy')
  area.remove()
  return listo
}
