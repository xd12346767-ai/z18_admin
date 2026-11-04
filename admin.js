'use strict';
/* ═══════════════════════ Z18 · PANTALLA DE COCINA (KDS) · admin.html + admin.css + admin.js ═══════════════════════
   Muestra EN VIVO los pedidos que los clientes mandan por WhatsApp desde la web (colección «pedidos» de Firestore) y deja cambiarles el estado con un toque:
       Pendiente  →  En preparación  →  Listo / En camino  →  Entregado        (y «Cancelar» mientras no esté entregado; cada paso se puede deshacer)
   Cuando entra un pedido nuevo suena una alerta (Web Audio) que se repite hasta que alguien lo toca o la silencia. Cada tarjeta trae un botón para abrir el chat de WhatsApp del cliente.

   QUIÉN ENTRA: solo el personal. Hace falta una cuenta de correo y contraseña (Firebase Authentication) Y un documento  staff/{UID de esa cuenta}  en Firestore.
   Las reglas de firestore.rules son las que mandan: aunque alguien copie esta página, sin ese documento Firestore no le deja ver ni cambiar un solo pedido.

   CÓMO DEJARLO FUNCIONANDO (una sola vez; el detalle paso a paso, con ejemplos, está en el LEEME de la entrega):
     1) Firestore → Reglas: pegá el bloque de reglas-cocina-bloque.txt DENTRO de tus reglas (junto a las de siempre) y publicá. Hacelo ANTES de subir los archivos.
     2) Authentication → Sign-in method: habilitá «Anónimo» (los clientes sin cuenta también mandan pedidos) y confirmá que «Correo electrónico/contraseña» está habilitado.
     3) Authentication → Users → «Agregar usuario»: el correo y la contraseña del personal de cocina. Copiá el «UID» de esa cuenta.
     4) Firestore → colección «staff» → «Agregar documento» con ID = ese UID (un campo cualquiera, por ejemplo rol: "cocina").
     5) Subí admin.html, admin.css, admin.js y cocina.js (lo que manda los pedidos desde la web) a la raíz del repositorio, junto a index.html, y abrí  https://z18-web.vercel.app/admin.html
     6) Para probar sin tocar el checkout: abrí prueba-cocina.html y tocá «Mandar pedido de prueba».

   CUIDADO CON LAS LECTURAS (Firestore cobra por documento leído; el plan gratis trae 50.000 por día):
     · Hay UNA sola escucha (onSnapshot), limitada a los pedidos de las últimas VENTANA_HORAS horas y a MAX_PEDIDOS documentos: nunca se baja toda la colección.
     · Después de la carga inicial, Firestore solo manda los pedidos que cambian o llegan (1 lectura por cambio). Un día de 100 pedidos ≈ unas 600 lecturas.
     · La escucha se renueva cada RENOVAR_ESCUCHA_MS para que la ventana no se vaya corriendo si la tablet queda prendida días.
   Seguridad de lo que se dibuja: todo lo que escribe un cliente (nombre, dirección, notas, productos) se muestra con textContent; esta página no usa innerHTML. */

// ───────────────────────── 1) Configuración ─────────────────────────
const FIREBASE_VERSION = '12.19.0';                  // la MISMA que app.js (firebase-app, firebase-auth y firebase-firestore siempre juntas)
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
const VENTANA_HORAS = 16;                            // se escuchan los pedidos de las últimas 16 horas (un turno completo)
const MAX_PEDIDOS = 150;                             // y nunca más de 150 documentos
const RENOVAR_ESCUCHA_MS = 12 * 3600e3;              // la escucha se vuelve a armar cada 12 h (así la ventana de 16 h no se desplaza)
const REPETIR_ALERTA_MS = 7000;                      // mientras haya pedidos sin ver, la alerta suena cada 7 segundos
const ENTREGADOS_VISIBLES = 25;                      // de los entregados solo se dibujan los 25 más nuevos (el contador muestra el total)
const ESPERA_TOQUE_MS = 700;                         // después de tocar un botón, esa tarjeta ignora otros toques por este tiempo (anti doble toque)
const ZONA = 'America/Montevideo';

// Estados (los mismos que valida firestore.rules → transicionOk): cada pedido solo puede hacer estos pasos
const ESTADOS = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
const SIGUIENTE = { pendiente: 'preparando', preparando: 'listo', listo: 'entregado' };
const ATRAS = { preparando: 'pendiente', listo: 'preparando', entregado: 'listo', cancelado: 'pendiente' };
const PUEDE_CANCELAR = ['pendiente', 'preparando', 'listo'];
const NOMBRE_ESTADO = { pendiente: 'Pendiente', preparando: 'En preparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
const COLUMNA = { pendiente: 'lPendiente', preparando: 'lPreparando', listo: 'lListo', entregado: 'lEntregado', cancelado: 'lCancelado' };

// ───────────────────────── 2) Utilidades de pantalla (sin innerHTML) ─────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, props, ...hijos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  hijos.flat().forEach(h => { if (h !== null && h !== undefined && h !== false) e.append(h.nodeType ? h : document.createTextNode(String(h))); });
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const ico = nombre => {                              // íconos del sprite que build.py arma dentro de admin.html (símbolos «i-…»)
  const s = document.createElementNS(SVG, 'svg'), u = document.createElementNS(SVG, 'use');
  s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  u.setAttribute('href', '#i-' + nombre); s.append(u);
  return s;
};
const VISTAS = ['vCargando', 'vLogin', 'vSinPermiso', 'vTablero'];
const mostrar = vista => VISTAS.forEach(v => { $(v).hidden = v !== vista; });
const avisar = (texto, mal = false) => {             // aviso breve abajo de la pantalla
  const a = el('p', { class: 'aviso' + (mal ? ' mal' : '') }, texto);
  $('avisos').append(a); setTimeout(() => a.remove(), mal ? 6000 : 3000);
  while ($('avisos').children.length > 3) $('avisos').firstChild.remove();
};
const anunciar = texto => { $('anuncio').textContent = ''; setTimeout(() => { $('anuncio').textContent = texto; }, 60); };   // para lectores de pantalla
const hhmm = ms => new Date(ms).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
const dinero = n => '$' + Math.round(n).toLocaleString('es-UY');
const minutos = ms => Math.max(0, Math.floor((Date.now() - ms) / 60000));
const haceTexto = ms => { const m = minutos(ms); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
// ¿Hace cuánto está así el pedido? Pasado cierto tiempo se pinta de atención (ámbar) y de urgente (rojo)
const UMBRAL = { pendiente: [5, 10], preparando: [20, 35], listo: [15, 30] };
const urgencia = o => { const u = UMBRAL[o.estado]; if (!u) return ''; const m = minutos(o.creado); return m >= u[1] ? 'urgente' : m >= u[0] ? 'atencion' : ''; };

// ───────────────────────── 3) Firebase ─────────────────────────
let fb = null;
const cargarFirebase = async () => {
  const [appLib, authLib, storeLib] = await Promise.all([import(FB_CDN + 'firebase-app.js'), import(FB_CDN + 'firebase-auth.js'), import(FB_CDN + 'firebase-firestore.js')]);
  const app = appLib.initializeApp(FIREBASE_CONFIG, 'cocina');       // app con nombre propio: la sesión del personal NO se mezcla con la de un cliente en el mismo navegador
  const auth = authLib.getAuth(app); auth.languageCode = 'es';
  const db = storeLib.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });   // si el wifi de la cocina o un proxy corta las conexiones persistentes, pasa solo a long-polling
  return (fb = { auth, db, onAuthStateChanged: authLib.onAuthStateChanged, signInWithEmailAndPassword: authLib.signInWithEmailAndPassword, signOut: authLib.signOut,
                 doc: storeLib.doc, getDoc: storeLib.getDoc, updateDoc: storeLib.updateDoc, collection: storeLib.collection, query: storeLib.query, where: storeLib.where,
                 orderBy: storeLib.orderBy, limit: storeLib.limit, onSnapshot: storeLib.onSnapshot, serverTimestamp: storeLib.serverTimestamp, Timestamp: storeLib.Timestamp });
};
const errorLogin = e => {
  switch ((e && e.code) || '') {
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': case 'auth/invalid-email': return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests': return 'Demasiados intentos. Esperá un momento y probá de nuevo.';
    case 'auth/network-request-failed': return 'No hay conexión. Revisá internet e intentá de nuevo.';
    case 'auth/user-disabled': return 'Esta cuenta está deshabilitada.';
    case 'auth/operation-not-allowed': return 'El ingreso con correo y contraseña no está habilitado en Firebase (Authentication → Sign-in method).';
    default: console.error('[Z18 cocina] login:', e); return 'No pudimos entrar. Probá de nuevo.';
  }
};

// ───────────────────────── 4) Sesión del personal ─────────────────────────
let usuario = null, sesionSeq = 0, turnoActivo = false;
const alCambiarSesion = async u => {
  const mia = ++sesionSeq;                           // si la sesión cambia mientras se verifica el permiso, la respuesta vieja se descarta
  pararTablero(); usuario = null; turnoActivo = false; pedirSonido(false);
  if (!u) return mostrar('vLogin');
  $('cargandoTexto').textContent = 'Verificando tu cuenta…'; mostrar('vCargando');
  let personal = false;
  try { personal = (await fb.getDoc(fb.doc(fb.db, 'staff', u.uid))).exists(); }
  catch (e) {
    if (mia !== sesionSeq) return;
    console.error('[Z18 cocina] No se pudo verificar el permiso:', e);
    return sinPermiso(u, e && e.code === 'unavailable' ? 'No pudimos verificar el permiso: revisá la conexión y reintentá.' : 'No pudimos verificar el permiso (' + ((e && e.code) || 'error') + ').');
  }
  if (mia !== sesionSeq) return;
  if (!personal) return sinPermiso(u, '');
  usuario = u;
  mostrar('vTablero'); iniciarTablero();
  if (sonidoListo()) entrarAlTurno(); else pedirSonido(true);      // el sonido tiene que activarse con un toque (obligatorio al entrar al turno)
};
const sinPermiso = (u, mensaje) => { $('spUid').textContent = u.uid; $('spError').textContent = mensaje; mostrar('vSinPermiso'); };

$('formLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('lgEmail').value.trim(), pass = $('lgPass').value;
  if (!email || !pass) { $('lgError').textContent = 'Ingresá el correo y la contraseña.'; return; }
  const b = $('lgEntrar'); b.disabled = true; b.textContent = 'Entrando…'; $('lgError').textContent = '';
  try { await fb.signInWithEmailAndPassword(fb.auth, email, pass); $('lgPass').value = ''; }
  catch (err) { $('lgError').textContent = errorLogin(err); }
  finally { b.disabled = false; b.textContent = 'Entrar'; }
});
$('verClave').addEventListener('click', () => {
  const ver = $('lgPass').type === 'password';
  $('lgPass').type = ver ? 'text' : 'password';
  $('verClave').setAttribute('aria-pressed', String(ver)); $('verClave').setAttribute('aria-label', ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
  $('verClave').firstElementChild.firstElementChild.setAttribute('href', ver ? '#i-eye-slash' : '#i-eye');
});
const cerrarSesion = () => { turnoActivo = false; fb.signOut(fb.auth).catch(e => console.error('[Z18 cocina] signOut:', e)); };
$('spSalir').addEventListener('click', cerrarSesion);
$('spReintentar').addEventListener('click', () => { if (fb.auth.currentUser) alCambiarSesion(fb.auth.currentUser); });
let saliendo = 0;                                    // «Salir» pide un segundo toque (evita cerrar la sesión sin querer en plena hora pico)
$('btnSalir').addEventListener('click', () => {
  const t = $('btnSalir').lastElementChild;
  if (!saliendo) { t.textContent = '¿Salir? Tocá otra vez'; saliendo = setTimeout(() => { saliendo = 0; t.textContent = 'Salir'; }, 4000); return; }
  clearTimeout(saliendo); saliendo = 0; t.textContent = 'Salir'; cerrarSesion();
});

// ───────────────────────── 5) Sonido y pantalla encendida ─────────────────────────
let audio = null, silenciado = false, sinAudio = false, timerAlerta = 0, candado = null;
const sonidoListo = () => !!audio && audio.state === 'running';
const nota = (frecuencia, inicio, duracion, volumen) => {
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'triangle'; o.frequency.value = frecuencia;
  g.gain.setValueAtTime(0.0001, inicio); g.gain.exponentialRampToValueAtTime(volumen, inicio + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  o.connect(g); g.connect(audio.destination); o.start(inicio); o.stop(inicio + duracion + 0.05);
};
const sonar = () => {                                // «ding-ding-dong»: se oye bien por encima del ruido de la cocina
  if (!sonidoListo()) return;
  const t = audio.currentTime + 0.02;
  [[880, 0], [1318.5, .16], [1760, .32], [1318.5, .7], [1760, .86]].forEach(([f, dt]) => nota(f, t + dt, .42, .55));
};
const alertar = () => {                              // arranca o frena la alerta repetida según haya pedidos sin ver
  const debe = turnoActivo && sinVer.size > 0 && !silenciado && sonidoListo();
  if (debe && !timerAlerta) { sonar(); timerAlerta = setInterval(() => { if (sinVer.size && !silenciado && sonidoListo()) sonar(); else alertar(); }, REPETIR_ALERTA_MS); }
  if (!debe && timerAlerta) { clearInterval(timerAlerta); timerAlerta = 0; }
};
const pintarAvisosAudio = () => {
  $('avisoSilencio').hidden = !(turnoActivo && silenciado);
  $('avisoAudio').hidden = !(turnoActivo && !sinAudio && !sonidoListo());
};
const pedirPantallaEncendida = async () => {        // Wake Lock: la tablet no se apaga sola con el tablero abierto
  try { if ('wakeLock' in navigator && !candado) { candado = await navigator.wakeLock.request('screen'); candado.addEventListener('release', () => { candado = null; }); } } catch (e) { candado = null; }
};
const pedirSonido = ver => {                        // el cartel «Activar sonido» tapa el tablero y lo deja inerte (ni con el teclado se llega a las tarjetas)
  $('vSonido').hidden = !ver; $('vTablero').inert = ver;
  if (ver) { $('snSinAudio').hidden = true; $('continuarSinSonido').hidden = true; $('activarSonido').focus(); }
};
const entrarAlTurno = () => { turnoActivo = true; pedirSonido(false); pintarAvisosAudio(); alertar(); pedirPantallaEncendida(); };
$('activarSonido').addEventListener('click', async () => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Este navegador no tiene Web Audio');
    if (!audio) { audio = new AC(); audio.addEventListener('statechange', () => { pintarAvisosAudio(); alertar(); }); }
    await audio.resume();
    if (!sonidoListo()) throw new Error('El audio no arrancó (' + audio.state + ')');
    sonar();                                         // suena una vez para comprobar el volumen
  } catch (e) {
    console.warn('[Z18 cocina] Sin sonido:', e && e.message);
    $('snSinAudio').hidden = false; $('continuarSinSonido').hidden = false; return;
  }
  entrarAlTurno();
});
$('continuarSinSonido').addEventListener('click', () => { sinAudio = true; entrarAlTurno(); });
$('btnRearmar').addEventListener('click', async () => { try { await audio.resume(); sonar(); } catch (e) {} pintarAvisosAudio(); alertar(); });
$('btnSonido').addEventListener('click', () => {
  silenciado = !silenciado;
  $('btnSonido').setAttribute('aria-pressed', String(silenciado)); $('btnSonido').setAttribute('aria-label', silenciado ? 'Activar la alerta' : 'Silenciar la alerta');
  $('btnSonido').firstElementChild.firstElementChild.setAttribute('href', silenciado ? '#i-volume-xmark' : '#i-volume-high');
  pintarAvisosAudio(); alertar();
});
$('btnReactivar').addEventListener('click', () => { if (silenciado) $('btnSonido').click(); });
if (!document.documentElement.requestFullscreen) $('btnPantalla').hidden = true;
$('btnPantalla').addEventListener('click', () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !turnoActivo) return;
  if (audio && audio.state !== 'running') audio.resume().catch(() => {});
  pedirPantallaEncendida(); render(); actualizarEdades();
});

// ───────────────────────── 6) Pedidos en vivo ─────────────────────────
const pedidos = new Map();                           // id → pedido (ya normalizado)
const vistos = new Set();                            // ids que ya conocíamos (para saber cuáles son NUEVOS)
const sinVer = new Set();                            // pedidos nuevos que nadie tocó todavía: mientras haya alguno, suena la alerta
const enEspera = new Set();                          // ids con un cambio recién tocado (ignoran otros toques unos instantes)
const movidos = new Set();                           // ids que acaban de cambiar de columna (se resaltan un momento)
let sembrado = false, desuscribir = null, escuchaDesde = 0, escuchaSeq = 0, reintento = 0, reintentoN = 0, armado = null, armadoTimer = 0, estadoRed = 'conectando';
const tarjetas = new Map();                          // id → { el, firma }: una tarjeta no se vuelve a armar si no cambió nada

const aMs = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
const normalizar = (id, d) => {                      // lo que viene de la base se trata como NO confiable: tipos y largos se fuerzan acá
  d = d || {};
  return {
    id, ref: id.slice(0, 4),
    estado: ESTADOS.includes(d.estado) ? d.estado : 'pendiente',
    nombre: String(d.nombre || 'Sin nombre').slice(0, 60),
    telefono: String(d.telefono || '').replace(/\D/g, '').slice(0, 15),
    tipo: d.tipoEntrega === 'retiro' ? 'retiro' : 'delivery',
    direccion: String(d.direccion || '').slice(0, 200),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 25).map(x => String(x).slice(0, 130)),
    notas: String(d.notas || '').slice(0, 500),
    total: Number.isFinite(d.total) ? d.total : 0,
    creado: aMs(d.createdAt) || (Number.isFinite(d.enviadoEn) ? d.enviadoEn : 0)
  };
};
const pintarRed = estado => {
  estadoRed = estado;
  const t = { conectando: 'Conectando…', vivo: 'En vivo', cache: 'Sin conexión', error: 'Con problemas' }[estado];
  $('conexion').dataset.estado = estado; $('conexionTexto').textContent = t;
  $('avisoRed').hidden = estado !== 'cache';
};
const escuchar = () => {
  if (desuscribir) { desuscribir(); desuscribir = null; }
  clearTimeout(reintento); $('avisoError').hidden = true;
  const mia = ++escuchaSeq;
  escuchaDesde = Date.now();
  const desde = fb.Timestamp.fromMillis(escuchaDesde - VENTANA_HORAS * 3600e3);
  const q = fb.query(fb.collection(fb.db, 'pedidos'), fb.where('createdAt', '>=', desde), fb.orderBy('createdAt', 'desc'), fb.limit(MAX_PEDIDOS));
  desuscribir = fb.onSnapshot(q, { includeMetadataChanges: true }, snap => { if (mia === escuchaSeq) alSnapshot(snap); }, e => { if (mia === escuchaSeq) alErrorEscucha(e); });
};
const alSnapshot = snap => {
  reintentoN = 0; $('avisoError').hidden = true;
  const deCache = snap.metadata.fromCache;
  pintarRed(deCache && !sembrado ? 'conectando' : deCache ? 'cache' : 'vivo');
  pedidos.clear();
  snap.docs.forEach(d => pedidos.set(d.id, normalizar(d.id, d.data({ serverTimestamps: 'estimate' }))));
  if (!sembrado) {
    if (!deCache) { pedidos.forEach((o, id) => vistos.add(id)); sembrado = true; }      // lo que ya estaba al abrir se ve, pero NO suena
  } else {
    const nuevos = [];
    pedidos.forEach((o, id) => { if (!vistos.has(id)) { vistos.add(id); if (o.estado === 'pendiente') { sinVer.add(id); nuevos.push(o); } } });
    if (nuevos.length) anunciar(nuevos.length === 1 ? `Pedido nuevo de ${nuevos[0].nombre}` : `${nuevos.length} pedidos nuevos`);
  }
  [...sinVer].forEach(id => { const o = pedidos.get(id); if (!o || o.estado !== 'pendiente') sinVer.delete(id); });   // lo que ya no está pendiente deja de pedir atención
  render(); alertar();
};
const alErrorEscucha = e => {
  console.error('[Z18 cocina] La escucha de pedidos se cortó:', e);
  if (e && (e.code === 'permission-denied' || e.code === 'unauthenticated')) { const u = usuario; pararTablero(); usuario = null; turnoActivo = false; pedirSonido(false); if (u) sinPermiso(u, 'Esta cuenta ya no tiene permiso para ver los pedidos.'); return; }
  pintarRed('error');
  $('avisoErrorTexto').textContent = 'Se cortó la conexión con los pedidos (' + ((e && e.code) || 'error') + '). Reintentando…'; $('avisoError').hidden = false;
  clearTimeout(reintento); reintento = setTimeout(escuchar, Math.min(30000, 4000 * 2 ** reintentoN++));
};
$('btnReintentar').addEventListener('click', () => { reintentoN = 0; pintarRed('conectando'); escuchar(); });

// ── Armado de cada tarjeta ──
const waLink = o => {
  if (!/^\d{8,15}$/.test(o.telefono)) return '';
  const n = o.nombre.trim().split(/\s+/)[0] || 'cliente', r = `N° ${o.ref}`;
  const texto = {
    pendiente: `Hola ${n}, recibimos tu pedido ${r} en Z18. Enseguida lo empezamos a preparar.`,
    preparando: `Hola ${n}, tu pedido ${r} ya está en preparación.`,
    listo: o.tipo === 'retiro' ? `Hola ${n}, tu pedido ${r} ya está listo para retirar.` : `Hola ${n}, tu pedido ${r} va en camino.`,
    entregado: `Gracias por tu pedido, ${n}. ¡Que lo disfrutes! — Z18`,
    cancelado: `Hola ${n}, tuvimos que cancelar tu pedido ${r}. Escribinos y lo resolvemos.`
  }[o.estado];
  return `https://wa.me/${o.telefono}?text=${encodeURIComponent(texto)}`;
};
const mapaLink = dir => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir + ', Montevideo, Uruguay');
const textoPrincipal = o => o.estado === 'pendiente' ? 'Empezar a preparar' : o.estado === 'preparando' ? (o.tipo === 'retiro' ? 'Listo para retirar' : 'Sale en camino') : 'Entregado';
const iconoPrincipal = o => o.estado === 'pendiente' ? 'utensils' : o.estado === 'preparando' ? (o.tipo === 'retiro' ? 'bell' : 'motorcycle') : 'check';
const firmaDe = o => [o.estado, o.nombre, o.telefono, o.tipo, o.direccion, o.items.join('|'), o.notas, o.total, o.creado, +sinVer.has(o.id), +enEspera.has(o.id), +movidos.has(o.id), +(armado === o.id)].join('¦');
const construirTarjeta = o => {
  const sig = SIGUIENTE[o.estado], atras = ATRAS[o.estado], espera = enEspera.has(o.id), wa = waLink(o);
  const boton = (clase, accion, hijos, onclick) => el('button', { type: 'button', class: 'btn ' + clase, dataset: { accion }, disabled: espera, onclick }, hijos);
  const lineas = o.items.map(t => { const m = /^(\d{1,3}) x (.+)$/.exec(t); return el('li', null, m ? [el('b', null, m[1] + '×'), m[2]] : t); });
  return el('article', { class: 'pedido' + (sinVer.has(o.id) ? ' nuevo' : '') + (movidos.has(o.id) ? ' movido' : ''), dataset: { id: o.id, estado: o.estado, tipo: o.tipo }, 'aria-label': `Pedido ${o.ref} de ${o.nombre}, ${NOMBRE_ESTADO[o.estado]}`, onclick: () => marcarVisto(o.id) },
    el('div', { class: 'p-cab' },
      el('span', { class: 'p-ref' }, '#' + o.ref),
      sinVer.has(o.id) ? el('span', { class: 'p-nuevo' }, 'NUEVO') : null,
      el('span', { class: 'p-hora' }, hhmm(o.creado) + ' · ', el('span', { class: 'p-edad ' + urgencia(o), dataset: { t: o.creado, estado: o.estado } }, haceTexto(o.creado)))),
    el('div', { class: 'p-cliente' },
      el('b', null, o.nombre),
      el('span', { class: 'p-tipo ' + o.tipo }, ico(o.tipo === 'retiro' ? 'store' : 'motorcycle'), o.tipo === 'retiro' ? 'Retira en el local' : (o.estado === 'listo' ? 'En camino' : 'Delivery'))),
    o.tipo === 'delivery' && o.direccion ? el('a', { class: 'p-dir', href: mapaLink(o.direccion), target: '_blank', rel: 'noopener noreferrer' }, ico('location-dot'), o.direccion) : null,
    el('ul', { class: 'p-items', 'aria-label': 'Productos' }, lineas),
    o.notas ? el('p', { class: 'p-notas' }, o.notas) : null,
    el('p', { class: 'p-total' }, el('span', null, 'Total'), el('span', null, dinero(o.total))),
    el('div', { class: 'p-acciones' },
      sig ? boton(`principal-fila hacia-${sig}`, 'siguiente', [ico(iconoPrincipal(o)), textoPrincipal(o)], () => cambiarEstado(o.id, sig)) : null,
      wa ? el('a', { class: 'btn wa', href: wa, target: '_blank', rel: 'noopener noreferrer', dataset: { accion: 'whatsapp' } }, ico('whatsapp'), 'WhatsApp') : null,
      atras ? boton('', 'atras', [ico('arrow-rotate-left'), o.estado === 'cancelado' ? 'Reabrir' : o.estado === 'entregado' ? 'Deshacer entrega' : 'Volver a ' + NOMBRE_ESTADO[atras].toLowerCase()], () => cambiarEstado(o.id, atras)) : null,
      PUEDE_CANCELAR.includes(o.estado) ? boton('peligro' + (armado === o.id ? ' armado' : ''), 'cancelar', [ico('xmark'), armado === o.id ? '¿Seguro? Tocá otra vez' : 'Cancelar'], () => cancelar(o.id)) : null));
};
const tarjeta = o => {
  const firma = firmaDe(o), t = tarjetas.get(o.id);
  if (t && t.firma === firma) return t.el;
  const e = construirTarjeta(o); tarjetas.set(o.id, { el: e, firma }); return e;
};
const render = () => {
  if (!usuario) return;
  const foco = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.pedido') : null;
  const focoId = foco && foco.dataset.id, focoAccion = foco && document.activeElement.dataset ? document.activeElement.dataset.accion : null;
  const por = { pendiente: [], preparando: [], listo: [], entregado: [], cancelado: [] }, limite = Date.now() - VENTANA_HORAS * 3600e3;
  pedidos.forEach(o => { if (o.creado >= limite) por[o.estado].push(o); });
  const antiguoPrimero = (a, b) => a.creado - b.creado || (a.id < b.id ? -1 : 1), nuevoPrimero = (a, b) => b.creado - a.creado || (a.id < b.id ? -1 : 1);
  ['pendiente', 'preparando', 'listo'].forEach(k => por[k].sort(antiguoPrimero));          // lo más viejo arriba: se cocina en el orden en que llegó
  ['entregado', 'cancelado'].forEach(k => por[k].sort(nuevoPrimero));
  const total = { entregado: por.entregado.length }; por.entregado = por.entregado.slice(0, ENTREGADOS_VISIBLES);
  const vivos = new Set();
  ESTADOS.forEach(k => {
    $(COLUMNA[k]).replaceChildren(...por[k].map(o => { vivos.add(o.id); return tarjeta(o); }));
    const n = k === 'entregado' ? total.entregado : por[k].length;
    $('cN' + k).textContent = n;
    if ($('pN' + k)) $('pN' + k).textContent = n;                                       // (los cancelados no tienen pestaña)
  });
  [...tarjetas.keys()].forEach(id => { if (!vivos.has(id)) tarjetas.delete(id); });
  $('nPendiente').textContent = por.pendiente.length; $('nPreparando').textContent = por.preparando.length; $('nListo').textContent = por.listo.length;
  $('cancelados').hidden = !por.cancelado.length; $('cNcancelado').textContent = por.cancelado.length;
  $('masEntregados').hidden = total.entregado <= ENTREGADOS_VISIBLES; $('masEntregados').textContent = `Y ${total.entregado - ENTREGADOS_VISIBLES} entregados más (se ven los ${ENTREGADOS_VISIBLES} más nuevos).`;
  $('alertaNuevos').hidden = !sinVer.size; $('alertaTexto').textContent = sinVer.size === 1 ? '1 pedido nuevo' : `${sinVer.size} pedidos nuevos`;
  document.title = (por.pendiente.length ? `(${por.pendiente.length}) ` : '') + 'Cocina · Z18';
  if (focoId && tarjetas.has(focoId)) { const b = tarjetas.get(focoId).el.querySelector(`[data-accion="${focoAccion}"]`); if (b && !b.disabled) b.focus({ preventScroll: true }); }
};
const actualizarEdades = () => document.querySelectorAll('.p-edad').forEach(s => {   // «hace 5 min» y el color de atención / urgente, sin rearmar la tarjeta
  const t = +s.dataset.t; s.textContent = haceTexto(t);
  const u = urgencia({ estado: s.dataset.estado, creado: t }); s.className = 'p-edad ' + u;
});

// ── Acciones ──
const marcarVisto = id => { if (sinVer.delete(id)) { render(); alertar(); } };
const cambiarEstado = async (id, nuevo) => {
  const o = pedidos.get(id);
  if (!o || enEspera.has(id) || !usuario) return;
  if (!(nuevo === SIGUIENTE[o.estado] || nuevo === ATRAS[o.estado] || (nuevo === 'cancelado' && PUEDE_CANCELAR.includes(o.estado)))) return;   // solo los pasos que las reglas permiten
  enEspera.add(id); movidos.add(id); sinVer.delete(id); armado = null;
  setTimeout(() => { enEspera.delete(id); render(); }, ESPERA_TOQUE_MS);
  setTimeout(() => { movidos.delete(id); render(); }, 1500);
  render(); alertar();
  try { await fb.updateDoc(fb.doc(fb.db, 'pedidos', id), { estado: nuevo, estadoAnterior: o.estado, actualizadoEn: fb.serverTimestamp(), actualizadoPor: usuario.uid }); }
  catch (e) {
    console.error('[Z18 cocina] No se pudo cambiar el estado:', e);
    avisar(e && e.code === 'permission-denied' ? 'Ese pedido ya lo cambió otro dispositivo: la pantalla se actualizó.' : 'No se pudo cambiar el estado. Revisá la conexión.', true);
    render();
  }
};
const cancelar = id => {                             // dos toques: el primero arma el botón, el segundo cancela
  clearTimeout(armadoTimer);
  if (armado !== id) { armado = id; armadoTimer = setTimeout(() => { armado = null; render(); }, 4000); render(); return; }
  armado = null; cambiarEstado(id, 'cancelado');
};
$('btnSilenciar').addEventListener('click', () => { sinVer.clear(); render(); alertar(); });
$('btnVer').addEventListener('click', () => { verColumna('pendiente'); const c = document.querySelector('.pedido.nuevo') || $('lPendiente').firstElementChild; if (c) c.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); });   // los pendientes van del más viejo al más nuevo: el pedido nuevo suele quedar al final de la lista, así que «Ver» lleva hasta ESE
const verColumna = v => { $('tablero').dataset.ver = v; document.querySelectorAll('#pestanas button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ver === v))); };
$('pestanas').addEventListener('click', e => { const b = e.target.closest('button[data-ver]'); if (b) verColumna(b.dataset.ver); });

// ── Ciclo de vida del tablero ──
let ticTac = 0;
const iniciarTablero = () => {
  pararTablero();
  pintarRed('conectando'); escuchar();
  const tic = () => { $('reloj').textContent = hhmm(Date.now()); actualizarEdades(); if (Date.now() - escuchaDesde > RENOVAR_ESCUCHA_MS) escuchar(); };
  tic(); ticTac = setInterval(tic, 15000);
  window.addEventListener('online', alVolverLaRed); window.addEventListener('offline', alPerderLaRed);
};
const alPerderLaRed = () => pintarRed('cache');
const alVolverLaRed = () => pintarRed(sembrado ? 'vivo' : 'conectando');
function pararTablero() {
  if (desuscribir) { desuscribir(); desuscribir = null; }
  escuchaSeq++; clearTimeout(reintento); clearInterval(ticTac); ticTac = 0; clearTimeout(armadoTimer); armado = null;
  window.removeEventListener('online', alVolverLaRed); window.removeEventListener('offline', alPerderLaRed);
  pedidos.clear(); vistos.clear(); sinVer.clear(); enEspera.clear(); movidos.clear(); tarjetas.clear(); sembrado = false; reintentoN = 0;
  ESTADOS.forEach(k => $(COLUMNA[k]).replaceChildren());
  alertar(); document.title = 'Cocina · Z18';
}

// ───────────────────────── 7) Arranque ─────────────────────────
const arrancar = async () => {
  $('reintentarCarga').hidden = true; $('cargandoTexto').textContent = 'Cargando…'; mostrar('vCargando');
  try { await cargarFirebase(); }
  catch (e) {
    console.error('[Z18 cocina] No se pudo cargar Firebase:', e);
    $('cargandoTexto').textContent = 'No pudimos conectar con Firebase. Revisá internet.'; $('reintentarCarga').hidden = false; return;
  }
  fb.onAuthStateChanged(fb.auth, alCambiarSesion);   // avisa al abrir (sesión guardada o no) y cada vez que alguien entra o sale
};
$('reintentarCarga').addEventListener('click', arrancar);
arrancar();
