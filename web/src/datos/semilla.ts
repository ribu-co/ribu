// Datos inventados para la versión en memoria. Son los de docs/datos-demo.md: nada es real.

import type { Mesa, Producto, Restaurante, Rol } from '../../../contratos/tipos'

export interface PersonaPersonal {
  uid: string
  correo: string
  clave: string
  rol: Exclude<Rol, 'cliente'>
  nombre: string
  restauranteId: string
}

export interface Semilla {
  restaurantes: Restaurante[]
  productos: Producto[]
  mesas: Mesa[]
  personal: PersonaPersonal[]
}

const RESTAURANTE = 'fogon-del-manglar'

const producto = (
  id: string,
  nombre: string,
  categoria: string,
  precio: number,
  stock: number | null,
  descripcion: string,
  imagen: string,
): Producto => ({
  id,
  restauranteId: RESTAURANTE,
  nombre,
  descripcion,
  categoria,
  precio,
  stock,
  disponible: true,
  imagenUrl: `/platos/${imagen}.jpg`,
})

/** Recorte de la foto en la miniatura: el plato no siempre queda al centro del archivo. */
const ENCUADRE: Record<string, string> = {
  'patacon-suero': 'center 64%',
  'posta-negra': '72% center',
  enyucado: 'center 72%',
  'jugo-corozo': '32% 48%',
  'limonada-coco': 'center 28%',
  cocada: 'center 62%',
  agua: 'center 42%',
}

export const encuadreFoto = (id: string) => ENCUADRE[id] ?? 'center'

/** Solo sirve en memoria. En Firebase el personal entra con su cuenta y la clave no vive en el repo. */
export const CLAVE_DEMO = 'ribu-demo'

export const semillaDemo = (): Semilla => ({
  restaurantes: [
    {
      id: RESTAURANTE,
      nombre: 'Fogón del Manglar',
      activo: true,
      impuesto: { tipo: 'INC', porcentaje: 8 },
      propinasSugeridas: [0, 5, 8, 10],
    },
  ],
  productos: [
    producto('patacon-suero', 'Patacón con suero', 'Entradas', 10_800, 40, 'Patacón grande con suero costeño', 'patacon'),
    producto('carimanolas', 'Carimañolas x 3', 'Entradas', 8_100, 30, 'Rellenas de carne', 'carimanolas'),
    producto('arepa-huevo', 'Arepa de huevo', 'Entradas', 5_400, 30, 'Frita, con huevo entero', 'arepa'),
    producto('mojarra-frita', 'Mojarra frita', 'Platos fuertes', 32_400, 2, 'Con patacón, arroz de coco y ensalada', 'mojarra'),
    producto('posta-negra', 'Posta negra', 'Platos fuertes', 37_800, 15, 'Con arroz de coco y plátano maduro', 'posta'),
    producto('carne-asada', 'Bandeja de carne asada', 'Platos fuertes', 35_100, 20, 'Con yuca, arroz y ensalada', 'carne'),
    producto('sancocho-gallina', 'Sancocho de gallina', 'Platos fuertes', 27_000, 25, 'Con arroz y aguacate', 'sancocho'),
    producto('jugo-corozo', 'Jugo de corozo', 'Bebidas', 8_100, 40, 'En agua o en leche', 'corozo'),
    producto('limonada-coco', 'Limonada de coco', 'Bebidas', 12_000, 30, 'Frappé', 'limonada'),
    producto('agua', 'Agua en botella', 'Bebidas', 4_050, 50, '500 ml', 'agua'),
    producto('enyucado', 'Enyucado', 'Postres', 8_100, 20, 'Porción individual', 'enyucado'),
    producto('cocada', 'Cocada', 'Postres', 6_750, 20, 'Con panela', 'cocada'),
  ],
  mesas: [1, 2, 3, 4, 5].map((numero) => ({
    token: `demo-mesa-${numero}`,
    restauranteId: RESTAURANTE,
    numero,
    estado: 'libre',
    cuentaId: null,
  })),
  personal: (['mesero', 'cocina', 'admin'] as const).map((rol) => ({
    uid: `personal-${rol}`,
    correo: `${rol}@ribu.demo`,
    clave: CLAVE_DEMO,
    rol,
    nombre: { mesero: 'Marta (mesera)', cocina: 'Cocina', admin: 'Administración' }[rol],
    restauranteId: RESTAURANTE,
  })),
})
