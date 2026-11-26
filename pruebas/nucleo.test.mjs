import assert from "node:assert/strict";
import { test } from "node:test";
import { atender, destinatario, firmaOk, firmar, leerAgentes, normalizar } from "../buzon/nucleo.mjs";

const AGENTES = leerAgentes({ bruno: ["Bruno", "runo", "pruno"], "mari-carmen": ["Mari Carmen", "maricarmen"] });
const SECRETO = "secreto-de-prueba";
const TOKEN = "token-de-prueba";

function almacenMemoria() {
  const notas = [];
  return {
    notas,
    async guardar(n) {
      if (notas.some((x) => x.sesion_id === n.sesion_id)) return false;
      notas.push({ id: notas.length + 1, ...n, atendida: null });
      return true;
    },
    async pendientes(agente) {
      return notas.filter((n) => !n.atendida && (!agente || n.agente === agente));
    },
    async atender(id, cuando) {
      const n = notas.find((x) => x.id === id && !x.atendida);
      if (!n) return false;
      Object.assign(n, { atendida: cuando, texto: "", titulo: "" });
      return true;
    },
    async purgar() {},
  };
}

const ajustes = { secreto: SECRETO, token: TOKEN, agentes: AGENTES };

async function webhook(almacen, texto, extra = {}, secreto = SECRETO) {
  const cuerpo = JSON.stringify({
    id: extra.evento ?? "evt1", type: extra.tipo ?? "session.completed", test: extra.prueba ?? false,
    data: { session: { id: extra.sesion ?? "ses1", title: "Título", started_at: "2026-11-18T10:00:00Z" }, transcript: { text: texto } },
  });
  const cabeceras = { "vocci-signature": extra.firma ?? (await firmar(cuerpo, secreto)), "content-length": String(Buffer.byteLength(cuerpo)) };
  return atender(
    { metodo: "POST", ruta: "/vocci", cabecera: (n) => cabeceras[n] ?? null, cuerpo: async () => new TextEncoder().encode(cuerpo) },
    ajustes, almacen,
  );
}

const leer = (almacen, ruta, metodo = "GET", token = TOKEN) =>
  atender({ metodo, ruta, cabecera: (n) => (n === "authorization" ? `Bearer ${token}` : null), cuerpo: async () => new Uint8Array() }, ajustes, almacen);

test("normalizar quita tildes, mayúsculas y signos", () => {
  assert.equal(normalizar("¡Óyeme, BRUNO!"), "oyeme bruno");
});

test("destinatario: nombre al principio, con muletillas y variantes", () => {
  assert.equal(destinatario("Bruno, apunta esto", AGENTES), "bruno");
  assert.equal(destinatario("[You] Oye, Bruno: apunta esto", AGENTES), "bruno");
  assert.equal(destinatario("Speaker 1: hola a ver pruno apunta", AGENTES), "bruno");
  assert.equal(destinatario("Runo. Apunta esto", AGENTES), "bruno");
  assert.equal(destinatario("\n\nBruno", AGENTES), "bruno");
  assert.equal(destinatario("Oye, Mari Carmen, llama al taller", AGENTES), "mari-carmen");
  assert.equal(destinatario("Hey Maricarmen call the garage", AGENTES), "mari-carmen");
});

test("destinatario: una nota personal no es de nadie", () => {
  assert.equal(destinatario("Tengo que decirle a Bruno que apunte esto", AGENTES), null);
  assert.equal(destinatario("Brunote, apunta", AGENTES), null);
  assert.equal(destinatario("Mari, llama al taller", AGENTES), null);
  assert.equal(destinatario("oye hola vale bueno Bruno", AGENTES), null); // demasiadas muletillas
  assert.equal(destinatario("", AGENTES), null);
});

test("leerAgentes rechaza palabras repetidas entre agentes", () => {
  assert.throws(() => leerAgentes({ ana: ["Ana"], hana: ["ana"] }), /dos agentes/);
  assert.throws(() => leerAgentes("{mal"), /JSON/);
  assert.throws(() => leerAgentes({}), /vacío/);
});

test("firma: correcta, manipulada, caducada y con otro secreto", async () => {
  const cuerpo = new TextEncoder().encode('{"a":"ñ"}');
  const buena = await firmar('{"a":"ñ"}', SECRETO);
  assert.equal(await firmaOk(cuerpo, buena, SECRETO), true);
  assert.equal(await firmaOk(new TextEncoder().encode('{"a":"n"}'), buena, SECRETO), false);
  assert.equal(await firmaOk(cuerpo, buena, "otro"), false);
  assert.equal(await firmaOk(cuerpo, await firmar('{"a":"ñ"}', SECRETO, 1000), SECRETO), false);
  assert.equal(await firmaOk(cuerpo, "t=abc,v1=zz", SECRETO), false);
  assert.equal(await firmaOk(cuerpo, "", SECRETO), false);
  assert.equal(await firmaOk(cuerpo, buena, ""), false);
});

test("webhook: guarda la nota del agente y no guarda la personal", async () => {
  const almacen = almacenMemoria();
  assert.deepEqual((await webhook(almacen, "Bruno, compra pan")).datos, { ok: true, accion: "bruno" });
  assert.deepEqual((await webhook(almacen, "Mañana compro pan", { sesion: "ses2", evento: "evt2" })).datos, { ok: true, accion: "personal" });
  assert.equal(almacen.notas.length, 1);
  assert.equal(almacen.notas[0].texto, "Bruno, compra pan");
});

test("webhook: sin firma válida no entra nada", async () => {
  const almacen = almacenMemoria();
  assert.equal((await webhook(almacen, "Bruno, compra pan", {}, "otro-secreto")).codigo, 401);
  assert.equal((await webhook(almacen, "Bruno, compra pan", { firma: "" })).codigo, 401);
  assert.equal(almacen.notas.length, 0);
});

test("webhook: una grabación repetida no se duplica; otros eventos se ignoran", async () => {
  const almacen = almacenMemoria();
  await webhook(almacen, "Bruno, compra pan");
  await webhook(almacen, "Bruno, compra pan", { evento: "evt-regenerado" });
  assert.equal(almacen.notas.length, 1);
  assert.equal((await webhook(almacen, "Bruno", { tipo: "audio.uploaded", sesion: "s3" })).datos.accion, "ignorado");
  assert.equal(almacen.notas.length, 1);
});

test("webhook: el evento de prueba va al primer agente y cada uno cuenta", async () => {
  const almacen = almacenMemoria();
  await webhook(almacen, "This is a test", { prueba: true, evento: "p1", sesion: "fija" });
  await webhook(almacen, "This is a test", { prueba: true, evento: "p2", sesion: "fija" });
  assert.equal(almacen.notas.length, 2);
  assert.equal(almacen.notas[0].agente, "bruno");
  assert.equal(almacen.notas[0].prueba, true);
});

test("cola: hace falta el token; al entregar se borra el texto", async () => {
  const almacen = almacenMemoria();
  await webhook(almacen, "Bruno, compra pan");
  await webhook(almacen, "Mari Carmen, llama al taller", { sesion: "ses2", evento: "evt2" });
  assert.equal((await leer(almacen, "/cola", "GET", "malo")).codigo, 401);
  assert.equal((await leer(almacen, "/cola")).datos.notas.length, 2);
  assert.equal((await leer(almacen, "/cola?agente=mari-carmen")).datos.notas.length, 1);
  assert.equal((await leer(almacen, "/cola/1/hecho", "POST", "malo")).codigo, 401);
  assert.equal((await leer(almacen, "/cola/1/hecho", "POST")).codigo, 200);
  assert.equal((await leer(almacen, "/cola/1/hecho", "POST")).codigo, 404);
  assert.equal(almacen.notas[0].texto, "");
  assert.equal((await leer(almacen, "/cola")).datos.notas.length, 1);
  assert.equal((await leer(almacen, "/salud")).codigo, 200);
  assert.equal((await leer(almacen, "/otra")).codigo, 404);
});
