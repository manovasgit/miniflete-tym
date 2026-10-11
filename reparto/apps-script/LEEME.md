# Backend de Reparto TyM (Google Sheet + Apps Script)

Todo el acceso a datos pasa por `Codigo.gs`. Este archivo **no tiene claves ni datos de
clientes**: los PIN y los datos viven solo en el Sheet.

## Publicarlo por primera vez (unos 10 minutos)

1. **Sheet nuevo.** Con la cuenta de Google de Miniflete, entrá a <https://sheets.new>.
   Ponele de nombre `Reparto TyM – datos`. Tiene que ser una planilla nueva: **no** uses la
   de contabilidad de Unidades.
2. **Pegar el script.** En la planilla: *Extensiones → Apps Script*. Borrá lo que aparece en
   `Código.gs`, pegá el contenido completo de `Codigo.gs` y guardá (ícono del disquete).
3. **Inicializar.** Volvé a la planilla y recargala (F5). Aparece el menú **Reparto TyM**.
   Tocá *Reparto TyM → 1. Inicializar planilla*.
   - Google pide autorización. Aparece "Google no verificó esta app": es normal en scripts
     propios. Tocá *Configuración avanzada → Ir a … (no seguro) → Permitir*.
   - Te pide el PIN de administrador (4 a 8 números). Con ese PIN entrás al panel como `Martin`.
   - Se crean las hojas y se precargan el cliente "Veterinaria", las sucursales BELGRANO,
     TRIUNVIRATO y WARNES, y los choferes Martín, Enzo, Mariano, Rodeo, Marcelo y Manolo
     (sin PIN: se los ponés desde el panel).
4. **Publicar como aplicación web.** En Apps Script: *Implementar → Nueva implementación*.
   En "Tipo" (engranaje) elegí *Aplicación web*:
   - Descripción: `Reparto TyM`
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   Tocá *Implementar* y copiá la **URL de la aplicación web** (termina en `/exec`).
5. **Pasame esa URL** (o pegala en `reparto/js/config.js`, en `API_URL`). Desde ese momento la
   app pide login. "Cualquier usuario" significa que cualquiera puede *llamar* al script, pero
   sin un token de sesión válido el script no devuelve ningún dato.

## Después de publicar

- Entrá a `https://manovasgit.github.io/miniflete-tym/reparto/panel.html` como `Martin`.
- *Administración*: renombrá "Veterinaria", cargá la dirección de cada base (botón *Ubicar en
  el mapa*), poné PIN a cada chofer y creá un usuario de rol *Sucursal* por sucursal (ej.
  `Belgrano`) y uno de rol *Dueño* para el dueño de la veterinaria.
- Con algunos repartos cargados, corré *Reparto TyM → Verificar accesos por rol*. Usa un
  usuario de cada rol, llama al script por el mismo camino que el celular, revisa la
  **respuesta** y deja el detalle en la hoja "Verificación".

## Cuando haya una versión nueva de `Codigo.gs`

Pegá el código nuevo, guardá, y en *Implementar → Administrar implementaciones → lápiz →
Versión: Nueva versión → Implementar*. Así la URL **no cambia**. Si en vez de eso hacés
"Nueva implementación", la URL cambia y hay que actualizar la app.

## Cuidados

- **No compartas la planilla** con nadie. Tiene los hashes de los PIN y los datos de los clientes.
- Si te olvidás tu PIN: *Reparto TyM → Cambiar PIN de un usuario* (desde la planilla).
- Un chofer que se equivoca 5 veces queda bloqueado 15 minutos. Ponerle un PIN nuevo desde el
  panel lo desbloquea y cierra sus sesiones abiertas.
- Desactivar un usuario lo deja afuera al instante, en todos sus dispositivos.
