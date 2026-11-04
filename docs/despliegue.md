# Despliegue

Cómo se publica Ribu en Firebase, cómo se cargan los datos iniciales y cómo se prueba. Aquí van los nombres de los secretos, nunca sus valores.

**Producción:** https://ribu-co.web.app, proyecto de Firebase `ribu-co`, definido en `.firebaserc`.

> **No llames a `POST /auth` de Factus Pay.** Cada llamada revoca el token de todo el equipo. Usa el token que ya existe.

## Requisitos

- Node 22 y npm.
- Firebase CLI con sesión iniciada. No viene en `package.json`.
- Java, para los emuladores.
- Un proyecto en plan Blaze: Cloud Functions y Secret Manager lo exigen.
- Authentication con los proveedores anónimo y correo con clave, como dice `firebase.json`.
- Credenciales del sandbox de Factus v2 y Factus Pay, que Integración comparte por privado.

## Secretos

Van en Secret Manager y `flujo/funciones.ts` los declara con `defineSecret`. Son 7:

| Nombre | Para qué |
|---|---|
| `FACTUS_CLIENT_ID` | OAuth de Factus v2 |
| `FACTUS_CLIENT_SECRET` | OAuth de Factus v2 |
| `FACTUS_USUARIO` | OAuth de Factus v2 |
| `FACTUS_CLAVE` | OAuth de Factus v2 |
| `FACTUS_PAY_TOKEN` | `Authorization: Bearer` de Factus Pay |
| `FACTUS_PAY_LLAVE_WEBHOOK` | La llave del webhook, la misma del panel de Factus Pay |
| `SEMILLA_CLAVE` | Protege `POST /api/interno/semilla`. Solo la usa la función `api` |

Se crean uno por uno. El comando pide el valor, y así no queda en el historial:

```bash
firebase functions:secrets:set FACTUS_CLIENT_ID
```

Después de cambiar un secreto hay que desplegar las funciones otra vez. Nunca los pongas en el repositorio, en Firestore ni en la web.

Variables opcionales, que el código lee si existen:

| Variable | Por defecto |
|---|---|
| `FACTUS_URL` | `https://api-sandbox.factus.com.co` |
| `FACTUS_PAY_URL` | `https://pay-api-sandbox.factus.com.co` |
| `RIBU_URL_WEB` | `https://<proyecto>.web.app`. Es de donde salen los links de las mesas |
| `RIBU_MOCKS` | Sin activar. Con `1`, la función usa mocks y no llama a las APIs: nunca en producción |

`.env.example` es la lista de referencia que pide el reto. Ningún proceso de este repositorio carga `.env` por sí solo.

## Publicar

```bash
npm ci
npm run verificar
firebase deploy
```

`firebase deploy` hace esto:

- **Funciones:** empaqueta `flujo/funciones.ts` en `functions/lib/index.js` e instala las dependencias de `functions/`. Publica `api`, `barridoProgramado`, `alCambiarFactura` y `alCambiarNota`.
- **Hosting:** corre `npm run build` y publica `web/dist`.
- **Firestore:** publica `firestore.rules` y `firestore.indexes.json`.

Para publicar solo una parte: `firebase deploy --only functions`, `--only hosting` o `--only firestore`.

## Datos iniciales: la semilla

`POST /api/interno/semilla` crea o completa los datos de la demo. Es la única parte de la app que crea la cuenta de la plataforma. La protege `SEMILLA_CLAVE`, en el encabezado `x-semilla-clave`.

Crea el restaurante `fogon-del-manglar`, la carta de [Datos de la demo](datos-demo.md), 5 mesas y una cuenta por rol: `plataforma@ribu.test`, `admin@ribu.test`, `mesero@ribu.test` y `cocina@ribu.test`.

Las claves van en el cuerpo, con 8 caracteres o más. No se guardan ni se registran: solo pasan a Authentication.

```bash
# El archivo no se versiona: .gitignore ya cubre .credenciales-demo.*
curl -X POST https://ribu-co.web.app/api/interno/semilla \
  -H "x-semilla-clave: $SEMILLA_CLAVE" \
  -H "Content-Type: application/json" \
  -d @.credenciales-demo.json
```

El archivo tiene esta forma:

```json
{
  "claves": { "plataforma": "<clave>", "admin": "<clave>", "mesero": "<clave>", "cocina": "<clave>" },
  "reiniciarDemo": false,
  "actualizarClaves": false
}
```

La respuesta trae cada cuenta y el link de cada mesa, sin claves.

| Opción | Qué hace |
|---|---|
| `reiniciarDemo` | Devuelve el stock de la carta, cierra las cuentas de las mesas y las libera. Sirve entre ensayos. No borra pagos, facturas ni notas |
| `actualizarClaves` | Aplica las claves a las cuentas que ya existen. Cierra sus sesiones abiertas: por eso no pasa si no se pide |

**Los tokens de mesa no cambian**, con ninguna opción. Los stickers ya grabados siguen funcionando. Correrla otra vez tampoco pisa el stock si no se pide `reiniciarDemo`.

Los demás restaurantes se crean desde `/plataforma`.

## Webhook de Factus Pay

Se registra a mano en el panel de Factus Pay, con dos datos:

- **URL:** `https://ribu-co.web.app/api/webhooks/factus-pay/<valor>`. El último segmento es obligatorio para que la ruta exista, y el código no lo lee.
- **Llave:** el valor de `FACTUS_PAY_LLAVE_WEBHOOK`. Factus Pay la envía en `?key=`.

Para comprobar la ruta sin un pago, envía un POST con `data.reference_code` y `data.amount`. Con la llave correcta y una referencia que no existe responde 200. Con una llave errada responde 401.

**Estado:** registrado en el panel, y la ruta responde así en producción. **Todavía no se ha visto llegar un aviso real de Factus Pay.** Por eso el pago también se confirma consultando la API.

## Desarrollo y emuladores

| Comando | Qué levanta |
|---|---|
| `npm run dev` | La web con Vite y datos en memoria, con su simulador de banco y de DIAN. No llama a ninguna API |
| `npm run emuladores` | Authentication, Firestore y funciones, en el proyecto `demo-ribu` |

En el emulador, las funciones **siempre usan mocks** y no llaman a Factus. No leen `.env`: `npm run preparar:functions` crea `functions/.secret.local` con valores falsos si no existe. La clave de la semilla es `CLAVE_SEMILLA_EMULADOR`, en `flujo/mocks-compartidos.ts`, y solo vale ahí.

Con mocks existe además `POST /api/interno/mock/cobros/<referencia>/pagar`, que simula el pago y dispara el webhook. En producción esa ruta no existe.

La web no se conecta a los emuladores: `web/src/datos/firebase.ts` apunta al proyecto `ribu-co`. Los emuladores sirven para probar el backend.

## Pruebas

| Comando | Qué prueba | Resultado |
|---|---|---|
| `npm run verificar` | Tipos, pruebas de Vitest y build. Es lo mismo que corre CI | 938 pruebas pasan |
| `npm run test:reglas` | `firestore.rules` en el emulador | 50 pruebas pasan |
| `npm run test:flujo` | El flujo completo en emuladores, con mocks: semilla, pago, webhook, factura, división, notas y barrido | 13 pruebas pasan |

Ninguna de estas llama al sandbox real. La integración real se comprobó aparte: ver [Explicación de la integración](explicacion-integracion.md).

## Después de desplegar

1. Abre `/personal` y entra con cada rol.
2. Haz un pedido en una mesa y confírmalo.
3. Paga con el simulador, como dice el [Manual de uso](manual-de-uso.md#pagar-en-el-sandbox).
4. Revisa que la factura quede `emitida`, con número y CUFE.
5. Si estás en un ensayo, corre la semilla con `reiniciarDemo`.
