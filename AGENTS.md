# Instrucciones para los agentes

Reto Factus, API WARS Montería. Construimos **Ribu**: pedidos, pagos y facturación electrónica de un restaurante desde la mesa.

`pedido → confirmación del mesero → cobro con Factus Pay → pago confirmado → factura electrónica → número, CUFE, QR, PDF y correo`

## Reglas del reto

- **Todo el código se escribe durante el reto.** No copies código de otros repositorios ni de proyectos anteriores.
- **Las dos APIs son obligatorias:** Factus v2 y Factus Pay, sin otras pasarelas de pago. Si la demo no las muestra funcionando de verdad, el equipo queda descalificado.
- **Solo sandbox.** Nunca completes un pago con dinero real.
- **La IA se puede usar si el equipo entiende el código.** Explícale a tu integrante lo que hiciste: tiene que poder defenderlo ante el jurado.

Se entrega un pitch de máximo 5 minutos, una explicación de la integración, el repositorio público con `README.md`, lista de integrantes y `.env.example`, la app desplegada y un video de 2 a 3 minutos.

La nota pesa así: creatividad 20 %, solución del problema 20 %, pitch 15 %, API de Factus 15 %, API de Factus Pay 15 %, arquitectura y código 10 %, funcionamiento en vivo 5 %.

## Stack

TypeScript en todo. Firebase para Hosting, Authentication, Firestore y Cloud Functions. Web con React y Vite, pruebas con Vitest.

- `npm run dev`: la web con Vite.
- `npm run verificar`: tipos, pruebas y build. Es lo mismo que corre CI.

## Carpetas

Edita solo la carpeta de tu rol.

| Rol | Integrante | Carpeta |
|---|---|---|
| Integración | Juan Diego | `contratos/`, `flujo/`, `.github/`, dependencias y configuración |
| Facturación | Elias | `facturacion/` |
| Cobros | Néstor | `cobros/` |
| Interfaz | Andrés | `web/` |
| Producto y pitch | Eddy | `docs/`, `pitch/` |

Los contratos están en `contratos/`: empieza por su `README.md`. No los rompas ni los rodees. Si necesitas un cambio o una dependencia nueva, abre un PR pequeño solo con eso y avísale a Juan Diego.

## Cómo entregar

Un PR pequeño cada 30–45 minutos. Nada de PRs grandes al final.

```bash
git switch main && git pull
git switch -c <rol>/<tema>
npm run verificar
git push -u origin HEAD
gh pr create --fill
```

**No fusiones tu PR ni actives el auto-merge.** Juan Diego revisa cada PR y lo fusiona. Si las pruebas fallan o pide cambios, corrige en la misma rama. Todo código nuevo lleva su prueba.

## Reglas

- Usa los mocks por defecto. Factus v2 y Factus Pay permiten 80 llamadas por minuto cada uno. El sandbox real es solo para confirmar lo que está por confirmar y para probar el flujo completo.
- El sandbox de Factus es público: otros integradores ven lo que envías. Usa datos inventados, nunca datos reales de nadie.
- Nada de credenciales en el repo. Van en `.env`, que está en `.gitignore`. Juan Diego las comparte por privado.
- Toda llamada a Factus lleva `User-Agent` propio; sin él, Cloudflare responde 403.
- Nunca imprimas tokens ni credenciales en los registros.

## Factus v2 (`https://api-sandbox.factus.com.co`)

Documentación: https://developers.factus.com.co. La guía Word de Halltec y el Postman público de `/v1/` son de la versión anterior: no aplican.

- `POST /oauth/token` con datos de formulario, no JSON. Toma la duración de `expires_in` y renueva con `grant_type=refresh_token`.
- `GET /v2/numbering-ranges`, con `filter[document]` y `filter[is_active]=1`. El documento es 21 para factura, 22 para nota crédito y 23 para nota débito. La lista viene en `data.data`.
- `POST /v2/bills/validate`. El precio va sin impuesto, los impuestos en `taxes[]` (INC es `04`, IVA es `01`) y los pagos en `payment_details[]`. La propina va en `allowance_charges`, con `concept_type` `03` e `is_surcharge` en `true`. La respuesta trae en `data`: `number`, `cufe`, `is_validated`, `errors`, `links.qr` y `links.public_url`.
- `is_validated` no siempre es `true`. Con `true`, `errors` solo trae notificaciones que no bloquean nada:
  - Con "rechazo" en `errors`, la DIAN rechazó el documento. Elimínalo en seguida, porque bloquea el rango, y reenvíalo corregido. Puedes reusar la referencia.
  - Sin rechazo, la DIAN está demorada. Reintenta con el mismo `reference_code`. Nunca lo elimines ni cambies la referencia.
- Con una factura ya validada, repetir el `reference_code` devuelve la misma factura, aunque los datos cambien.
- `409` significa que hay un documento pendiente bloqueando el rango. En el sandbox compartido puede ser de otro equipo.
- `DELETE /v2/bills/destroy/reference/:reference_code`.
- `GET /v2/bills/:number/download-pdf`. El PDF llega en base64 en `pdf_base_64_encoded`.
- `POST /v2/bills/:number/send-email`. En el sandbox solo acepta correos autorizados; con otros responde 422.
- Notas crédito y débito: `POST /v2/credit-notes/validate` y `POST /v2/debit-notes/validate`, con `bill_number` y `correction_concept_code`. La respuesta trae `cude` en lugar de `cufe`. También `DELETE .../reference/:reference_code`, `GET .../:number/download-pdf` y `POST .../:number/send-email`.

## Factus Pay (`https://pay-api-sandbox.factus.com.co`)

Documentación: https://pay-developers.factus.com.co

- **Nunca llames a `POST /auth`.** Cada llamada revoca el token de todo el equipo. Usa el token de `.env`, en `Authorization: Bearer <token>`.
- `POST /v1/collections` con `reference_code` (único, máximo 100 caracteres), `amount` (10.000 a 12.000.000 COP, probado en el sandbox; la documentación dice otra cosa) y `expiration` en segundos. Responde 200 o 201 con el recaudo en `data`: `status`, `qr` (PNG en base64 con prefijo `data:`), `breb_key`, `qr_expires_at` y `collected_at`. Las fechas llegan en hora de Colombia, como `04-11-2026 12:00:40 PM`.
- `GET /v1/collections/{reference_code}`. Responde 404 si no existe.
- El cliente paga escaneando el QR o pegando la llave Bre-B en su banco, con el monto exacto. La llave es de un solo uso y no acepta pagos parciales.
- No hay reversos: una devolución se hace por fuera.
- Un QR vencido sigue en `ready`: compara `qr_expires_at` con la hora actual. Se renueva con la misma referencia, el mismo monto y otro `expiration`.
- Webhook: se registra en el panel una URL HTTPS y una llave. Llega un POST con `?key=<llave>` y el recaudo en `data`, con `payer` opcional. Compara la llave en tiempo constante, responde 2xx en menos de 10 segundos y confirma con `GET` antes de facturar. Si no recibe 2xx, Factus Pay hace hasta 6 intentos en total, con esperas de 1 minuto a 3 horas.
- Simulador: https://pay-api-sandbox.factus.com.co/simulator. Solo funciona escaneando el QR con la cámara, y deja elegir el escenario. Necesitas otro dispositivo para mostrar el QR.
