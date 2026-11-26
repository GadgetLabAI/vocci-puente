// Buzón en un Cloudflare Worker (plan gratis), con una base D1 como almacén.
//
// Ajustes (wrangler.toml, sección [vars]):
//   AGENTES     {"bruno": ["bruno", "runo"], ...}  palabra que activa a cada agente y sus variantes
//   MULETILLAS  opcional, lista JSON que sustituye a la de serie
// Secretos (npx wrangler secret put ...), nunca en el repositorio:
//   SECRETO_WEBHOOK  el que da Vocci al crear el endpoint
//   TOKEN_LECTURA    el que usa tu PC para leer la cola
//
// Rutas:
//   POST /vocci             webhook de Vocci
//   GET  /cola              notas pendientes (Authorization: Bearer TOKEN_LECTURA)
//   POST /cola/<id>/hecho   nota entregada: se borra su texto
//   GET  /salud             comprobación sin datos

import { atender, leerAgentes } from "./nucleo.mjs";

const ESQUEMA = `CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id TEXT,
  sesion_id TEXT UNIQUE,
  agente TEXT,
  titulo TEXT,
  texto TEXT,
  grabada TEXT,
  recibida TEXT,
  prueba INTEGER,
  atendida TEXT
)`;

let esquemaListo = false;

function almacenD1(db) {
  const preparar = async () => {
    if (esquemaListo) return;
    await db.prepare(ESQUEMA).run();
    esquemaListo = true;
  };
  return {
    async guardar(n) {
      await preparar();
      const r = await db
        .prepare(
          "INSERT OR IGNORE INTO notas (evento_id, sesion_id, agente, titulo, texto, grabada, recibida, prueba)" +
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(n.evento_id, n.sesion_id, n.agente, n.titulo, n.texto, n.grabada, n.recibida, n.prueba ? 1 : 0)
        .run();
      return r.meta.changes === 1; // 0 = reintento de Vocci o resumen regenerado
    },
    async pendientes(agente) {
      await preparar();
      const base = "SELECT id, sesion_id, agente, titulo, texto, grabada, recibida, prueba FROM notas WHERE atendida IS NULL";
      const consulta = agente
        ? db.prepare(base + " AND agente = ? ORDER BY id LIMIT 50").bind(agente)
        : db.prepare(base + " ORDER BY id LIMIT 50");
      const { results } = await consulta.all();
      return results.map((f) => ({ ...f, prueba: Boolean(f.prueba) }));
    },
    async atender(id, cuando) {
      await preparar();
      // Entregada: fuera el contenido. Queda el rastro para no repetir la grabación.
      const r = await db
        .prepare("UPDATE notas SET atendida = ?, texto = '', titulo = '' WHERE id = ? AND atendida IS NULL")
        .bind(cuando, id)
        .run();
      return r.meta.changes === 1;
    },
    async purgar(antesDe) {
      await db.prepare("DELETE FROM notas WHERE atendida IS NOT NULL AND atendida < ?").bind(antesDe).run();
    },
  };
}

export default {
  async fetch(request, env) {
    const responder = (codigo, datos) =>
      new Response(JSON.stringify(datos), {
        status: codigo,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    let ajustes;
    try {
      if (!env.SECRETO_WEBHOOK || !env.TOKEN_LECTURA) throw new Error("faltan los secretos SECRETO_WEBHOOK o TOKEN_LECTURA");
      if (!env.DB) throw new Error("falta la base D1 (binding DB)");
      ajustes = {
        secreto: env.SECRETO_WEBHOOK,
        token: env.TOKEN_LECTURA,
        agentes: leerAgentes(env.AGENTES),
        muletillas: env.MULETILLAS ? JSON.parse(env.MULETILLAS) : undefined,
      };
    } catch (e) {
      const url = new URL(request.url);
      if (url.pathname === "/salud") return responder(503, { ok: false, error: e.message });
      return responder(503, { error: "buzón sin configurar" });
    }
    const url = new URL(request.url);
    const peticion = {
      metodo: request.method,
      ruta: url.pathname + url.search,
      cabecera: (nombre) => request.headers.get(nombre),
      cuerpo: async () => new Uint8Array(await request.arrayBuffer()),
    };
    try {
      // console.log va al registro del Worker (npx wrangler tail). Nunca lleva texto de notas.
      const { codigo, datos } = await atender(peticion, ajustes, almacenD1(env.DB), (linea) => console.log(linea));
      return responder(codigo, datos);
    } catch (e) {
      console.log(`error: ${e.message}`);
      return responder(500, { error: "fallo interno" });
    }
  },
};
