import type { Comprador } from '../../../contratos/tipos'

export const correoDe = (comprador: Comprador) => comprador.correo?.trim() || null
export const correoValido = (correo: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())

/** Lo mismo que revisa el backend antes de llamar a Factus. La web lo usa para avisar antes de enviar. */
export function compradorValido(comprador: Comprador): boolean {
  const correo = correoDe(comprador)
  if (correo !== null && !correoValido(correo)) return false
  switch (comprador.tipo) {
    case 'consumidor_final':
      return true
    case 'persona':
      return /^[A-Za-z0-9]{3,20}$/.test(comprador.documento) && comprador.nombre.trim().length > 1 && correo !== null
    case 'empresa':
      return /^\d{5,15}$/.test(comprador.nit) && comprador.razonSocial.trim().length > 1 && correo !== null
  }
}
