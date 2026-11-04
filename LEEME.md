# Z18 · Pantalla de cocina (KDS) — paso a paso

Con esto, **todos los pedidos que se mandan desde la web (incluidos los de clientes sin cuenta) aparecen en vivo en una pantalla de cocina**, con alerta sonora, botones de estado y acceso directo al WhatsApp del cliente. El WhatsApp de siempre sigue funcionando igual: la cocina es un *extra* que nunca puede frenar un pedido.

## Qué trae esta entrega

| Archivo | Dónde va | Para qué sirve |
|---|---|---|
| `admin.html`, `admin.css`, `admin.js` | raíz del repositorio (junto a `index.html`) | La pantalla de cocina: `https://z18-web.vercel.app/admin.html` |
| `cocina.js` | raíz del repositorio | Lo carga la web. Manda cada pedido a la cocina cuando el cliente toca «Enviar pedido por WhatsApp» |
| `prueba-cocina.html` | raíz del repositorio (**temporal**) | Manda un pedido de ejemplo para comprobar que todo está conectado. Se borra al terminar |
| `reglas-cocina-bloque.txt` | **no va al repositorio**: se pega en Firebase → Firestore → Reglas | Las reglas nuevas (colecciones `pedidos` y `staff`) |
| `snippet_checkout.js` | **no va al repositorio**: se copia dentro de `app.js` | El fragmento que conecta el botón de WhatsApp con la cocina |

## Cómo funciona

1. El cliente toca **Enviar pedido por WhatsApp**. `cocina.js` arma el pedido al instante, le pone un código de 4 letras (ej. `K7QD`) y lo manda a Firestore **en segundo plano**. WhatsApp se abre sin esperar, con «Pedido N° K7QD» al final del mensaje.
2. La cocina lo ve en `admin.html` como **#K7QD**, con alerta sonora que se repite hasta que alguien lo toca.
3. Los clientes sin cuenta mandan el pedido con una **sesión anónima de Firebase** que se abre sola, en una app de Firebase aparte: no pisa la cuenta de un cliente registrado ni toca el ingreso de la web. Se abre recién al mandar un pedido (o al abrir el carrito, si usás el paso opcional), así que quien solo mira el menú no genera ningún usuario.
4. Solo el personal puede leer y cambiar pedidos. «Personal» = una cuenta de correo y contraseña **más** un documento `staff/<UID>` creado a mano en Firebase. Nadie puede borrar pedidos.

## Parte 1 · Firebase (una sola vez)

**1. Reglas de Firestore** — Firebase → *Firestore Database* → pestaña *Reglas*.
Abrí `reglas-cocina-bloque.txt`, copiá **todo** y pegalo **dentro** de tus reglas, al final, antes de las dos últimas llaves. Tiene que quedar así:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ... tus reglas de siempre (users, codigos_puntos, etc.) NO SE TOCAN ...

    // ↓↓↓ acá va el bloque pegado (empieza con el cartel «Z18 · COCINA (KDS)») ↓↓↓
    ...
    // ↑↑↑ y termina con la función kdsTransicionOk ↑↑↑

  }
}
```

Tocá **Publicar**. Ojo: **no reemplaces** tus reglas por el contenido del bloque; se agrega, no se reemplaza.

**2. Ingreso anónimo** — *Authentication* → *Sign-in method*: habilitá **Anónimo**, y confirmá que **Correo electrónico/contraseña** también esté habilitado.

**3. Cuenta del personal** — *Authentication* → *Users* → **Agregar usuario**: el correo y la contraseña con los que va a entrar la cocina. Copiá el **UID** que aparece en esa fila (no es el correo: es una cadena larga de letras y números).

**4. Permiso de cocina** — *Firestore Database* → *Datos* → **Iniciar colección** (o «Agregar documento» si `staff` ya existe):
- ID de la colección: `staff`
- ID del documento: **el UID** copiado en el paso 3
- un campo cualquiera: `rol` (string) = `cocina`

Para sumar más personal: repetí 3 y 4. Para sacarle el acceso a alguien: borrá su documento en `staff`.

## Parte 2 · Subir los archivos

**5.** En GitHub, en la raíz del repositorio, subí/reemplazá: `admin.html`, `admin.css`, `admin.js`, `cocina.js`, `prueba-cocina.html`. Vercel lo publica solo.

## Parte 3 · Probar sin tocar la web

**6.** Abrí `https://z18-web.vercel.app/admin.html`, entrá con la cuenta del paso 3 y tocá **Activar sonido** (el navegador lo exige cada vez que se abre la pantalla).
Si dice **«Sin permiso»**, falta el paso 4 (muestra el UID de la cuenta para que lo copies).

**7.** En otra pestaña o en otro celular abrí `https://z18-web.vercel.app/prueba-cocina.html` y tocá **Mandar pedido de prueba**. En un par de segundos tiene que sonar y aparecer una tarjeta «PRUEBA». Si algo falta, la página te dice qué:
- *Falta habilitar el ingreso «Anónimo»* → paso 2.
- *Las reglas de Firestore rechazaron el pedido* → paso 1 (¿publicaste? ¿quedó dentro de `match /databases/{database}/documents`?).
- *No hay conexión con Firebase* → internet.

**8.** Probá los botones de la tarjeta (ver «Cómo se usa» más abajo). Después podés borrar `prueba-cocina.html` del repositorio.

**Chequeo extra de las reglas (2 minutos, recomendado):** en *Reglas* → **Simulador de reglas**:
- `get` en `/databases/(default)/documents/pedidos/ABCDEFGHJKLMNPQRSTUV`, *no autenticado* → **Denegado**.
- El mismo `get`, autenticado con un UID cualquiera → **Denegado**.
- El mismo `get`, autenticado con el UID de tu documento `staff` → **Permitido**.
- `delete` sobre ese mismo pedido, autenticado como personal → **Denegado**.

## Parte 4 · Conectar el botón de WhatsApp de la web

**9.** En `index.html`, justo antes de `</body>`, agregá:

```html
<script src="cocina.js" defer></script>
```

**10.** En `app.js`, en la función que se ejecuta al enviar el pedido por WhatsApp, **justo antes de abrir WhatsApp**, pegá el fragmento de `snippet_checkout.js` y cambiá los nombres de la derecha (`datos`, `carrito`, `notas`, `total`, `mensaje`) por los que use tu código. Lo único que necesita:

| Dato | Ejemplo |
|---|---|
| `nombre`, `telefono` | los de «Tus datos para el pedido» (el teléfono puede venir como `099 123 456`: se normaliza solo) |
| `tipoEntrega` | `'delivery'` o `'retiro'` (también entiende «retiro en local», «envío a domicilio»…) |
| `direccion` | la dirección (obligatoria en delivery; se ignora en retiro) |
| `items` | una línea por producto: `['2 x Z18 Original', '1 x Papas con Cheddar y Bacon']` |
| `notas` | las aclaraciones del cliente (`''` si no hay) |
| `total` | el total del pedido en pesos |

Ejemplo con la estructura que tenía tu web (carrito `{ nombre: cantidad }`, `PRICE`, `total()`, `$('note')`, `goToWhatsApp`). Si tu código actual es distinto, lo importante es el *orden*: **registrar → armar el mensaje con el código → abrir WhatsApp**.

```js
let refCocina = '';                                       // arriba, con las demás variables

// en orderText(): al final del mensaje, sumá el código
//   ... + (note ? `\n\nAclaraciones: ${note}` : '') + prefs + (refCocina ? `\n\nPedido N° ${refCocina}` : '');

const goToWhatsApp = () => {
  try {                                                    // si algo falla acá, el WhatsApp sale igual
    const datos = JSON.parse(localStorage.getItem('z18_pedido') || '{}');     // «Tus datos para el pedido»
    refCocina = (window.Z18Cocina && Z18Cocina.registrar({
      nombre: datos.nombre, telefono: datos.telefono, tipoEntrega: datos.tipoEntrega, direccion: datos.direccion,
      items: Object.entries(cart).map(([n, q]) => q + ' x ' + n), notas: $('note').value, total: total()
    })) || '';
  } catch (e) { refCocina = ''; }
  updateSend();                                            // arma el link de WhatsApp, ahora con «Pedido N° …»
  /* … el resto de goToWhatsApp igual que hoy … */
  window.open($('send').href, '_blank', 'noopener');       // tiene que seguir siendo window.open en el mismo toque
  refCocina = ''; updateSend();                            // para que el próximo link no arrastre el código
};
```

**11. (Opcional, recomendado)** Cuando se abre el carrito, agregá `window.Z18Cocina && Z18Cocina.calentar();`. Deja lista la conexión para que el pedido salga más rápido al tocar el botón (en el celular, apenas se abre WhatsApp la página se frena).

**12.** Hacé un pedido real desde la web con tu celular: tiene que aparecer en la cocina con el mismo código que dice el mensaje de WhatsApp.

> Si preferís no tocar `app.js` a mano: mandame `index.html`, `app.js`, `styles.css` y tu `firestore.rules` actuales y te los devuelvo completos, con todo integrado y probado.

## Cómo se usa la pantalla (turno de cocina)

- **Al empezar el turno:** abrir `admin.html`, entrar, tocar **Activar sonido**, subir el volumen y dejar la pestaña abierta (la pantalla pide quedar encendida). En iPhone/iPad, el interruptor de silencio apaga el sonido de la web.
- **Pedido nuevo:** suena y la tarjeta late con la etiqueta NUEVO. La alerta se **repite cada 7 segundos** hasta que alguien toca la tarjeta o **Silenciar alerta**.
- **Estados** (un toque por paso, cada paso se puede deshacer):
  Pendiente → **Empezar a preparar** → En preparación → **Sale en camino** (delivery) / **Listo para retirar** (retiro) → **Entregado**. También **Cancelar** (pide tocar dos veces) y **Reabrir** para un cancelado.
- **WhatsApp:** abre el chat con el cliente con un mensaje listo para cada estado («tu pedido N° K7QD ya está en preparación», «va en camino»…). La dirección abre Google Maps.
- **Sonido:** el botón de volumen silencia la alerta (queda una franja roja avisando). Si el navegador frena el audio, aparece «El sonido se pausó» con un botón para reactivarlo.
- **Conexión:** el indicador dice *En vivo*, *Sin conexión* o *Con problemas*; si se corta, reintenta solo.
- **Salir** pide tocar dos veces (para no salirse por error).
- En el teléfono se ve una columna por vez con pestañas; en tablet y monitor, las columnas lado a lado.

## Lo que conviene saber

- **Costos:** Firestore gratis permite 50.000 lecturas y 20.000 escrituras por día. La pantalla hace **una sola escucha** limitada a las últimas 16 horas y 150 pedidos: un día de 100 pedidos consume unas 600 lecturas.
- **Qué se guarda de cada pedido:** nombre, teléfono, tipo de entrega, dirección, productos, aclaraciones, total y estado. Solo lo puede leer el personal. Los pedidos no se borran desde ninguna pantalla; si querés limpiarlos, se hace desde la consola de Firebase. Conviene mencionarlo en la política de privacidad de la web.
- **Spam:** como cualquier visitante puede crear un pedido, alguien malintencionado podría mandar pedidos falsos. Las reglas limitan la forma de cada pedido, pero no la cantidad. La defensa recomendada es **Firebase App Check** (con reCAPTCHA) sobre Firestore y Authentication; se puede sumar más adelante sin cambiar nada de esto.
- **Si el cliente cierra la web justo al tocar el botón**, el pedido puede no llegar a la cocina (el WhatsApp sí). Por eso el mensaje lleva «Pedido N° …»: si algo no aparece en la pantalla, el código permite reconciliar. El paso 11 reduce este riesgo.
- **Si se manda dos veces el mismo pedido dentro de los 15 minutos** (doble toque, o vuelve de WhatsApp y toca de nuevo), conserva el mismo código y no se duplica en la cocina.
- **Cómo se probó:** 361 verificaciones automáticas en navegador (ingreso, sonido, alerta, estados, tablet/teléfono, accesibilidad, XSS, punta a punta web → cocina) y 476 casos de reglas con 379 variantes «con error» para comprobar que las pruebas detectan fallas. Las reglas se corrieron con un intérprete propio y **no con el emulador oficial de Firebase** (no se pudo usar desde el entorno donde se armó): por eso conviene hacer el chequeo del Simulador de la Parte 3.
