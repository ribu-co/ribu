// El rol y el restaurante salen del ID token verificado, nunca del cuerpo.

import type { Auth } from 'firebase-admin/auth'
import { ROLES_PERSONAL, type Rol, type RolPersonal } from '../contratos/tipos'
import { ErrorRibu, fallar } from './errores'

export interface Identidad {
  uid: string
  rol: Rol
  /** null para el cliente y la plataforma. */
  restauranteId: string | null
}

export interface ClaimsPersonal {
  rol: RolPersonal | 'plataforma'
  restauranteId?: string
}

export interface CambiosUsuario {
  clave?: string
  nombre?: string
  deshabilitado?: boolean
}

export interface ServicioAuth {
  verificar(idToken: string): Promise<Identidad>
  /** Lanza CORREO_EN_USO si el correo ya tiene cuenta. */
  crearUsuario(correo: string, clave: string, nombre: string): Promise<string>
  buscarUid(correo: string): Promise<string | null>
  actualizarUsuario(uid: string, cambios: CambiosUsuario): Promise<void>
  fijarClaims(uid: string, claims: ClaimsPersonal): Promise<void>
  /** Saca al usuario: sus tokens anteriores dejan de valer. */
  revocar(uid: string): Promise<void>
  borrar(uid: string): Promise<void>
}

export const esPersonal = (rol: Rol): rol is RolPersonal => (ROLES_PERSONAL as readonly string[]).includes(rol)

export function identidadDeClaims(claims: { uid: string; rol?: unknown; restauranteId?: unknown }): Identidad {
  const { uid, rol, restauranteId } = claims
  if (rol === undefined || rol === 'cliente') return { uid, rol: 'cliente', restauranteId: null }
  if (rol === 'plataforma') return { uid, rol, restauranteId: null }
  if (typeof rol === 'string' && esPersonal(rol as Rol) && typeof restauranteId === 'string' && restauranteId !== '') {
    return { uid, rol: rol as RolPersonal, restauranteId }
  }
  return fallar('NO_AUTORIZADO', 'La sesión no es válida')
}

/** El personal solo actúa sobre su restaurante. El cliente y la plataforma no tienen uno propio. */
export function exigirRestaurante(identidad: Identidad, restauranteId: string) {
  if (esPersonal(identidad.rol) && identidad.restauranteId !== restauranteId) {
    fallar('SIN_PERMISO', 'Esa mesa es de otro restaurante')
  }
}

export function crearAuthFirebase(auth: Auth): ServicioAuth {
  return {
    async verificar(idToken) {
      let claims
      try {
        claims = await auth.verifyIdToken(idToken)
        // Solo el personal puede perder el acceso, y comprobarlo cuesta una lectura extra.
        if (claims.rol !== undefined) await auth.verifyIdToken(idToken, true)
      } catch {
        return fallar('NO_AUTORIZADO', 'La sesión no es válida')
      }
      return identidadDeClaims(claims)
    },
    async crearUsuario(correo, clave, nombre) {
      try {
        const usuario = await auth.createUser({ email: correo, password: clave, displayName: nombre })
        return usuario.uid
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/email-already-exists') {
          throw new ErrorRibu('CORREO_EN_USO', 'Ese correo ya tiene una cuenta')
        }
        throw error
      }
    },
    async buscarUid(correo) {
      try {
        return (await auth.getUserByEmail(correo)).uid
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/user-not-found') return null
        throw error
      }
    },
    async actualizarUsuario(uid, cambios) {
      await auth.updateUser(uid, {
        ...(cambios.clave === undefined ? {} : { password: cambios.clave }),
        ...(cambios.nombre === undefined ? {} : { displayName: cambios.nombre }),
        ...(cambios.deshabilitado === undefined ? {} : { disabled: cambios.deshabilitado }),
      })
    },
    fijarClaims: (uid, claims) => auth.setCustomUserClaims(uid, { ...claims }),
    revocar: (uid) => auth.revokeRefreshTokens(uid),
    borrar: (uid) => auth.deleteUser(uid),
  }
}
