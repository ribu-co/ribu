# Ribu

Pedidos, pagos y facturación electrónica de un restaurante desde la mesa. Cada mesa tiene un sticker con NFC y QR que abren el mismo link. Desde ahí se pide, el mesero confirma, la cocina prepara, se paga con Factus Pay y la factura electrónica se emite con Factus v2.

Proyecto del Reto Factus, API WARS Montería.

**App desplegada:** https://ribu-co.web.app. Corre con las APIs de sandbox de Factus v2 y Factus Pay, sin dinero real. El restaurante y sus datos son inventados.

- [Mesa de ejemplo](https://ribu-co.web.app/m/7a7dd957f230f6e396d7efe902c2bf26): la página que abre el sticker.
- [Personal](https://ribu-co.web.app/personal): entrada de mesero, cocina y administrador.
- [Plataforma](https://ribu-co.web.app/plataforma): panel para agregar y gestionar restaurantes.

## Integrantes

- Juan Diego Díaz Avendaño: Integración
- Elias David Vidal de la Rosa: Facturación
- Andrés Felipe Ortiz Rodríguez: Interfaz
- Néstor Junior Hernández López: Cobros
- Eddy Lans: Producto y pitch

## Cómo funciona

`pedido → confirmación del mesero → cobro con Factus Pay → pago confirmado → factura electrónica con Factus v2`

- **Web (`web/`):** React y Vite, en Firebase Hosting. Lee en vivo de Firestore y envía las órdenes a la API.
- **API (`flujo/`):** Hono en Cloud Functions. Es lo único que escribe datos y lo único que tiene las credenciales.
- **Factus Pay (`cobros/`):** crea el recaudo con su QR y confirma el pago. El webhook avisa, pero el pago siempre se confirma consultando la API.
- **Factus v2 (`facturacion/`):** emite la factura, las notas crédito y débito, y descarga el PDF.
- **Asociación:** el id del pago es el `reference_code` en Factus Pay y en Factus v2.

## Cómo correrlo

```bash
npm install
VITE_FUENTE=memoria npm run dev
```

Abre la dirección que muestra Vite. Esta versión usa datos en memoria y un simulador, sin llamar a ninguna API.

Para el backend en local, usa `npm run emuladores`: corre con mocks y no necesita credenciales. Las pruebas corren con `npm run verificar`, `npm run test:reglas` y `npm run test:flujo`. `.env.example` lista las variables de las APIs. Las credenciales nunca van en el repositorio: en producción están en Secret Manager. Para publicar, ver [Despliegue](docs/despliegue.md).

## Documentación

- [Explicación de la integración](docs/explicacion-integracion.md)
- [Arquitectura](docs/arquitectura.md)
- [Manual de uso](docs/manual-de-uso.md)
- [Despliegue](docs/despliegue.md)
- [Contratos y reglas de negocio](contratos/README.md)
- [Casos de prueba](docs/casos-de-prueba.md)
- [Datos de la demo](docs/datos-demo.md)
- [Reglas de trabajo y datos de las APIs](AGENTS.md)
- [Créditos de las fotos](https://ribu-co.web.app/creditos)
