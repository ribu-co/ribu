// Sin este archivo, el emulador intenta leer los secretos de Secret Manager. Con mocks no se usan,
// y *.local está en .gitignore. Si ya existe no se toca: puede tener otros valores.

import { existsSync, writeFileSync } from 'node:fs'

const ruta = new URL('../../functions/.secret.local', import.meta.url)
const nombres = [
  'FACTUS_CLIENT_ID',
  'FACTUS_CLIENT_SECRET',
  'FACTUS_USUARIO',
  'FACTUS_CLAVE',
  'FACTUS_PAY_TOKEN',
  'FACTUS_PAY_LLAVE_WEBHOOK',
  'SEMILLA_CLAVE',
]
if (!existsSync(ruta)) writeFileSync(ruta, nombres.map((nombre) => `${nombre}=solo-para-el-emulador\n`).join(''))
