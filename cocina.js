'use strict';
/* ═══════════════════════ Z18 · PEDIDO → COCINA · cocina.js ═══════════════════════
   Manda a la pantalla de cocina (admin.html) el pedido que el cliente está por enviar por WhatsApp. Es un módulo aparte: no toca el carrito ni los Puntos Z.

   CÓMO SE USA (el paso a paso con ejemplos está en el LEEME):
     1) index.html, antes de </body>:   <script src="cocina.js" defer></script>
     2) app.js, justo ANTES de abrir WhatsApp:
          const ref = window.Z18Cocina && Z18Cocina.registrar({ nombre, telefono, tipoEntrega, direccion, items, notas, total });
          if (ref) mensaje += '\n\nPedido N° ' + ref;           // el mismo código aparece como «#REF» en la pantalla de cocina
     3) (opcional) al abrir el carrito:  window.Z18Cocina && Z18Cocina.calentar();   → deja lista la conexión para que el pedido salga más rápido.

   QUÉ HACE:
     · registrar() valida y arma el pedido AL INSTANTE (síncrono), devuelve el código de 4 letras y manda el pedido a Firestore EN SEGUNDO PLANO: nunca frena ni rompe el botón de WhatsApp.
       Si algo falla (sin internet, Firebase caído, datos incompletos) devuelve null o el pedido simplemente no llega a la cocina; el mensaje de WhatsApp sale igual.
     · Usa una app de Firebase APARTE («pedidos») con sesión ANÓNIMA propia: no pisa ni se mezcla con la cuenta del cliente (Puntos Z, Google, etc.) y no cambia nada del ingreso de la web.
       La sesión anónima se abre recién cuando alguien manda un pedido (o abre el carrito, si se usa calentar()): los que solo miran el menú no generan ningún usuario.
     · Si el cliente toca dos veces o reenvía el MISMO pedido dentro de los 15 minutos, se reutiliza el mismo código y no se duplica en cocina.
   Las reglas de firestore.rules validan cada campo: si algo no cumple, Firestore lo rechaza y el pedido no entra (el WhatsApp sale igual). */
(() => {
  // ───────────────────────── Configuración ─────────────────────────
  const FIREBASE_VERSION = '12.19.0';                 // la MISMA que app.js y admin.js: así el navegador reutiliza los archivos que ya bajó
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyADbG0ywKt-RAsaExZsGJ6dVXdI5iMsTkE",
    authDomain: "z18-web-64b28.firebaseapp.com",
    projectId: "z18-web-64b28",
    storageBucket: "z18-web-64b28.firebasestorage.app",
    messagingSenderId: "525311848484",
    appId: "1:525311848484:web:75a5e99938675aa32f68b1",
    measurementId: "G-F48SGPMW5Q"
  };
  const FB_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const NOMBRE_APP = 'pedidos';                       // app de Firebase propia de este módulo (sesión anónima aparte de la de la web)
  const VENTANA_REPETIDO_MS = 15 * 60e3;              // el mismo pedido reenviado dentro de este tiempo conserva su código y no se duplica
  const LARGO_ID = 20;                                // el código que ve el cliente («Pedido N° ABCD») son las 4 primeras letras de este identificador
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 símbolos, sin I, O, 0 ni 1 (no se confunden al dictarlos)
  const CLAVE_ULTIMO = 'z18_pedido_cocina';
  // Límites: los mismos que valida firestore.rules (si se cambian allá, se cambian acá)
  const MAX_NOMBRE = 60, MIN_DIRECCION = 5, MAX_DIRECCION = 200, MAX_ITEMS = 25, MAX_ITEM = 130, MAX_NOTAS = 500, MAX_TOTAL = 1000000;

  // ───────────────────────── Limpieza de datos ─────────────────────────
  const cortar = (s, max) => { s = s.slice(0, max); return /[\ud800-\udbff]$/.test(s) ? s.slice(0, -1) : s; };      // sin dejar a medias un emoji
  const linea = (t, max) => cortar(String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim(), max);
  const notasLimpias = t => cortar(String(t == null ? '' : t).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), MAX_NOTAS);
  const telefonoLimpio = t => {                       // → solo dígitos con código de país (Uruguay 598), o '' si no alcanza para un número
    let d = String(t == null ? '' : t).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('5980')) d = '598' + d.slice(4);                     // «+598 099 123 456»
    else if (!d.startsWith('598')) {
      if (d.startsWith('0')) d = '598' + d.replace(/^0+/, '');            // «099 123 456» → 598 99123456
      else if (d.length === 8) d = '598' + d;                             // «99123456», «2355 1234»
    }
    return /^[0-9]{8,15}$/.test(d) ? d : '';
  };
  const tipoEntrega = v => {                          // acepta lo que use la web para elegir la entrega («delivery», «retiro», «retiro en local», «envío a domicilio»…)
    const x = String(v == null ? '' : v).trim().toLowerCase();
    if (/retir|local|pickup|take/.test(x)) return 'retiro';
    if (/deliv|env[ií]o|domicil/.test(x)) return 'delivery';
    return '';
  };

  // ───────────────────────── Identificador ─────────────────────────
  const generarId = () => {
    const bytes = new Uint8Array(LARGO_ID), c = (typeof self !== 'undefined' && self.crypto) || null;
    if (c && c.getRandomValues) c.getRandomValues(bytes); else for (let i = 0; i < LARGO_ID; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => ALFABETO[b % 32]).join('');                // 256 es múltiplo de 32: todos los símbolos salen con la misma probabilidad
  };

  // ───────────────────────── Último pedido (para no duplicar) ─────────────────────────
  let enMemoria = null;
  const leerUltimo = () => { try { const o = JSON.parse(localStorage.getItem(CLAVE_ULTIMO) || 'null'); if (o && typeof o === 'object') return o; } catch (e) {} return enMemoria; };
  const guardarUltimo = o => { enMemoria = o; try { localStorage.setItem(CLAVE_ULTIMO, JSON.stringify(o)); } catch (e) {} };

  // ───────────────────────── 1) preparar: validar y armar el pedido (síncrono, nunca lanza error) ─────────────────────────
  function preparar(datos) {
    try {
      const d = datos || {};
      const nombre = linea(d.nombre, MAX_NOMBRE);
      if (nombre.length < 2) return { ok: false, motivo: 'nombre' };
      const telefono = telefonoLimpio(d.telefono);
      if (!telefono) return { ok: false, motivo: 'telefono' };
      const entrega = tipoEntrega(d.tipoEntrega !== undefined ? d.tipoEntrega : d.entrega);
      if (!entrega) return { ok: false, motivo: 'entrega' };
      const direccion = entrega === 'delivery' ? linea(d.direccion, MAX_DIRECCION) : '';
      if (entrega === 'delivery' && direccion.length < MIN_DIRECCION) return { ok: false, motivo: 'direccion' };
      let items = (Array.isArray(d.items) ? d.items : String(d.items == null ? '' : d.items).split('\n')).map(x => linea(x, MAX_ITEM)).filter(Boolean);
      if (!items.length) return { ok: false, motivo: 'items' };
      if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS - 1).concat('… y ' + (items.length - (MAX_ITEMS - 1)) + ' más');
      const total = Math.round(Number(d.total));
      if (!Number.isFinite(total) || total < 0 || total > MAX_TOTAL) return { ok: false, motivo: 'total' };
      const pedido = { nombre, telefono, tipoEntrega: entrega, direccion, items, notas: notasLimpias(d.notas), total };

      // ¿el mismo pedido que se acaba de mandar? → mismo código, y si ya llegó a cocina no se vuelve a escribir
      const firma = JSON.stringify(pedido), previo = leerUltimo(), ahora = Date.now();
      const repetido = !!(previo && previo.firma === firma && typeof previo.id === 'string' && ahora - previo.t >= 0 && ahora - previo.t < VENTANA_REPETIDO_MS);
      const id = repetido ? previo.id : generarId();
      if (!repetido) guardarUltimo({ firma, id, t: ahora, enviado: false });
      return { ok: true, id, ref: id.slice(0, 4), pedido, yaEnviado: repetido && previo.enviado === true };
    } catch (e) {
      console.warn('[Z18 cocina] No se pudo preparar el pedido:', e);
      return { ok: false, motivo: 'error' };
    }
  }

  // ───────────────────────── 2) conexión: SDK de Firebase + sesión anónima (una sola vez por página) ─────────────────────────
  let conexionP = null;
  function conexion() {
    if (!conexionP) {
      conexionP = (async () => {
        const [A, Au, F] = await Promise.all([import(FB_CDN + 'firebase-app.js'), import(FB_CDN + 'firebase-auth.js'), import(FB_CDN + 'firebase-firestore.js')]);
        let app; try { app = A.initializeApp(FIREBASE_CONFIG, NOMBRE_APP); } catch (e) { app = A.getApp(NOMBRE_APP); }
        const auth = Au.getAuth(app);
        let db; try { db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); } catch (e) { db = F.getFirestore(app); }   // detecta redes con proxy que cortan la conexión normal
        await auth.authStateReady();                                          // si el dispositivo ya tenía su sesión anónima, la reutiliza
        if (!auth.currentUser) await Au.signInAnonymously(auth);
        return { auth, db, F };
      })().catch(e => { conexionP = null; throw e; });                        // si falló (sin internet…), la próxima vez se intenta de nuevo
    }
    return conexionP;
  }
  const calentar = () => { conexion().catch(() => {}); };

  // ───────────────────────── 3) enviar: escribir pedidos/{id} (en segundo plano; nunca lanza error) ─────────────────────────
  const enCurso = new Map();                          // id → promesa: un doble toque no escribe dos veces
  function enviar(prep) {
    if (!prep || !prep.ok) return Promise.resolve({ ok: false, code: 'sin-pedido' });
    if (prep.yaEnviado) return Promise.resolve({ ok: true, repetido: true });
    if (enCurso.has(prep.id)) return enCurso.get(prep.id);
    const p = (async () => {
      try {
        const { auth, db, F } = await conexion();
        const x = prep.pedido;
        await F.setDoc(F.doc(db, 'pedidos', prep.id), {   // EXACTAMENTE estos 11 campos (firestore.rules rechaza cualquier otro)
          uid: auth.currentUser.uid, nombre: x.nombre, telefono: x.telefono, tipoEntrega: x.tipoEntrega, direccion: x.direccion, items: x.items, notas: x.notas, total: x.total,
          estado: 'pendiente', createdAt: F.serverTimestamp(), enviadoEn: Date.now()
        });
        const u = leerUltimo(); if (u && u.id === prep.id) guardarUltimo({ ...u, enviado: true });
        return { ok: true };
      } catch (e) {
        const code = (e && e.code) || 'error';
        console.warn('[Z18 cocina] El pedido ' + prep.ref + ' no llegó a la cocina (' + code + ')' + (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation' ? ': habilitá el ingreso «Anónimo» en Firebase Authentication → Sign-in method' : ''), e);
        return { ok: false, code };
      } finally { enCurso.delete(prep.id); }
    })();
    enCurso.set(prep.id, p);
    return p;
  }

  // ───────────────────────── 4) registrar: lo único que llama la web ─────────────────────────
  function registrar(datos) {
    const prep = preparar(datos);
    if (!prep.ok) { console.warn('[Z18 cocina] Pedido no registrado en cocina (falta o es inválido: ' + prep.motivo + '). El WhatsApp sale igual.'); return null; }
    enviar(prep);                                     // sin esperar: no puede frenar la apertura de WhatsApp
    return prep.ref;
  }

  window.Z18Cocina = { registrar, preparar, enviar, calentar, version: '1.0' };
})();
