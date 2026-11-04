// ── Z18 · pedido a cocina ── pegar en app.js, en el botón «Enviar pedido por WhatsApp», JUSTO ANTES de abrir WhatsApp ──
// Los nombres de la derecha (mensaje, datos, carrito, notas, total) son los de tu código: cambialos por los que uses ahí.
let textoWhatsApp = mensaje;                                   // «mensaje» = el texto que hoy se le pasa a wa.me
try {
  const ref = window.Z18Cocina && Z18Cocina.registrar({
    nombre: datos.nombre, telefono: datos.telefono,             // «Tus datos para el pedido»
    tipoEntrega: datos.tipoEntrega, direccion: datos.direccion, // 'delivery' o 'retiro' (también entiende «retiro en local», «envío a domicilio»…)
    items: carrito.map(i => i.cantidad + ' x ' + i.nombre),     // una línea por producto: «2 x Z18 Original»
    notas: notas,                                               // aclaraciones del cliente ('' si no puso nada)
    total: total                                                // total del pedido en pesos
  });
  if (ref) textoWhatsApp += '\n\nPedido N° ' + ref;            // el mismo código se ve como «#REF» en la pantalla de cocina
} catch (e) { /* si algo falla, el pedido por WhatsApp sale igual */ }
// …y abrir WhatsApp con textoWhatsApp (en lugar de mensaje):  window.open('https://wa.me/' + NUMERO + '?text=' + encodeURIComponent(textoWhatsApp), '_blank');
