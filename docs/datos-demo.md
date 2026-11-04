# Datos de la demo

Integración carga estos datos con el script de datos iniciales. Todo es inventado: el restaurante no existe y los precios no salen de ninguna carta real. El sandbox de Factus es público, así que aquí no va ningún dato real.

Antes de elegir el nombre se buscó en la web y no apareció un restaurante con ese nombre. Conviene revisar también en Google Maps.

## Restaurante

| Campo (`Restaurante`) | Valor |
|---|---|
| `id` | `fogon-del-manglar` |
| `nombre` | Fogón del Manglar |
| `impuesto` | `{ tipo: 'INC', porcentaje: 8 }` |
| `propinasSugeridas` | `[0, 5, 8, 10]` |

El 0 deja a la vista la opción de no dar propina, que es voluntaria. Ningún valor supera `PROPINA_SUGERIDA_MAXIMA`.

## Mesas

Son 5, con `numero` del 1 al 5, `estado: 'libre'` y `cuentaId: null`.

El `token` no se escribe aquí porque este repositorio es público y el token no se debe poder adivinar. Lo genera el script.

**Pedido a Integración:** el script no debe cambiar los tokens si se corre otra vez. Si cambian, los stickers NFC y los QR ya impresos dejan de funcionar. Hay que pasarle a Producto el link de cada mesa para hacer `docs/pruebas-fisicas.md`.

## Personal

Una cuenta por rol: `mesero`, `cocina` y `admin`. Los correos y las claves no van en el repositorio.

## Carta

`precio` es el precio final, con INC del 8 % incluido. Todos los productos tienen `disponible: true` e `imagenUrl: null`. La columna "Base sin INC" no se carga: es lo que debe dar `baseSinImpuesto`, para poder comparar.

| `id` | `nombre` | `categoria` | `precio` | Base sin INC | `stock` | `descripcion` |
|---|---|---|---:|---:|---:|---|
| `patacon-suero` | Patacón con suero | Entradas | 10.800 | 10.000,00 | 40 | Patacón grande con suero costeño |
| `carimanolas` | Carimañolas x 3 | Entradas | 8.100 | 7.500,00 | 30 | Rellenas de carne |
| `arepa-huevo` | Arepa de huevo | Entradas | 5.400 | 5.000,00 | 30 | Frita, con huevo entero |
| `mojarra-frita` | Mojarra frita | Platos fuertes | 32.400 | 30.000,00 | **2** | Con patacón, arroz de coco y ensalada |
| `posta-negra` | Posta negra | Platos fuertes | 37.800 | 35.000,00 | 15 | Con arroz de coco y plátano maduro |
| `carne-asada` | Bandeja de carne asada | Platos fuertes | 35.100 | 32.500,00 | 20 | Con yuca, arroz y ensalada |
| `sancocho-gallina` | Sancocho de gallina | Platos fuertes | 27.000 | 25.000,00 | 25 | Con arroz y aguacate |
| `jugo-corozo` | Jugo de corozo | Bebidas | 8.100 | 7.500,00 | 40 | En agua o en leche |
| `limonada-coco` | Limonada de coco | Bebidas | 12.000 | 11.111,11 | 30 | Frappé |
| `agua` | Agua en botella | Bebidas | 4.050 | 3.750,00 | 50 | 500 ml |
| `enyucado` | Enyucado | Postres | 8.100 | 7.500,00 | 20 | Porción individual |
| `cocada` | Cocada | Postres | 6.750 | 6.250,00 | 20 | Con panela |

Hay dos productos puestos a propósito:

- **Mojarra frita:** tiene `stock: 2` para mostrar "agotado". El `stock` baja cuando el mesero confirma, no cuando el cliente pide. Al confirmar 2, queda en 0 y `disponible` pasa a `false`. Entre ensayos hay que devolverle el `stock`.
- **Limonada de coco:** es el único precio con base inexacta. Sirve para probar el redondeo que `contratos/README.md` tiene por confirmar. Los demás tienen base exacta, así que la demo principal no depende de eso. No la uses en la demo hasta confirmarlo.

## Pedido para la demo

Se usa en el guion y en el video, en la mesa 3.

| Producto | Cantidad | Precio | Total |
|---|---:|---:|---:|
| Mojarra frita | 2 | 32.400 | 64.800 |
| Jugo de corozo | 2 | 8.100 | 16.200 |
| Patacón con suero | 1 | 10.800 | 10.800 |
| **Consumo con INC** | | | **91.800** |

| Forma de pago | Cuánto se paga |
|---|---|
| Toda la cuenta, con 10 % de propina | Base 85.000 + INC 6.800 + propina 8.500 = **100.300** |
| Toda la cuenta, sin propina | **91.800** |
| Dos partes iguales | 45.900 cada una, antes de propina |
| Tres partes iguales | 30.600 cada una, antes de propina |

La propina se calcula sobre la base sin impuesto, como hace `calcularPropina`. Falta que un contador confirme esa base: ver `contratos/reglas.ts`.
