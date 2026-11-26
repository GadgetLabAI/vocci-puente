// Núcleo del buzón: lo mismo corre en un Cloudflare Worker y en un servidor propio (Node).
// No depende de nada: solo WebCrypto, que existe en los dos sitios.
//
// Qué hace:
//   1. Comprueba la firma del webhook de Vocci (cabecera Vocci-Signature, HMAC-SHA256 de "<t>.<cuerpo>").
//   2. Mira cómo empieza la nota. Si empieza por la palabra de un agente, la guarda en su cola.
//      Si no nombra a nadie es una nota personal: no se guarda nada de su contenido.
//   3. Sirve la cola a quien traiga el token de lectura y borra el texto en cuanto se entrega.

export const MULETILLAS = [
  // Lo que se dice antes del nombre sin que la nota deje de ser un encargo.
  "oye", "hola", "eh", "ey", "vale", "bueno", "venga", "a", "ver", "mira", "escucha", "buenas",
  "hey", "hi", "hello", "ok", "okay", "so", "well", "listen",
];
export const MAX_CUERPO = 1_100_000; // Vocci recorta el evento a 1 MB
export const MAX_TEXTO = 20_000;
export const TOLERANCIA_RELOJ = 300; // segundos
export const DIAS_RASTRO = 30;

export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Primera línea con texto, sin la etiqueta de hablante («[You]», «Speaker 1:»). */
export function primeraIntervencion(transcripcion) {
  for (const linea of String(transcripcion ?? "").split(/\r?\n/)) {
    const limpia = linea.replace(/^\s*(\[[^\]]*\]|speaker\s*\d+\s*:)\s*/i, "").trim();
    if (limpia) return limpia;
  }
  return "";
}

/**
 * Lee los agentes del ajuste AGENTES: {"bruno": ["bruno", "runo", "pruno"], ...}.
 * Devuelve [[idAgente, [palabras normalizadas, las más largas primero]], ...].
 */
export function leerAgentes(valor) {
  let datos = valor;
  if (typeof valor === "string") {
    try {
      datos = JSON.parse(valor);
    } catch {
      throw new Error("AGENTES no es JSON válido");
    }
  }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new Error("AGENTES debe ser un objeto");
  const agentes = [];
  const vistas = new Map();
  for (const [id, palabras] of Object.entries(datos)) {
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) throw new Error(`Identificador de agente no válido: ${id}`);
    const lista = [...new Set([id, ...(Array.isArray(palabras) ? palabras : [])].map(normalizar).filter(Boolean))];
    for (const palabra of lista) {
      if (vistas.has(palabra) && vistas.get(palabra) !== id) {
        throw new Error(`La palabra «${palabra}» está en dos agentes: ${vistas.get(palabra)} y ${id}`);
      }
      vistas.set(palabra, id);
    }
    agentes.push([id, lista.sort((a, b) => b.length - a.length)]);
  }
  if (!agentes.length) throw new Error("AGENTES está vacío");
  return agentes;
}

/**
 * A qué agente va la nota, o null si es personal.
 * Solo cuenta el nombre al principio, quizá tras alguna muletilla («Oye, Bruno…»).
 * Nombrar a alguien a mitad de frase no convierte la nota en un encargo.
 */
export function destinatario(transcripcion, agentes, muletillas = MULETILLAS) {
  let palabras = normalizar(primeraIntervencion(transcripcion)).split(" ").filter(Boolean);
  const saltar = new Set(muletillas.map(normalizar));
  for (let salto = 0; salto <= 3; salto++) {
    const resto = palabras.join(" ");
    for (const [id, lista] of agentes) {
      for (const palabra of lista) {
        if (resto === palabra || resto.startsWith(palabra + " ")) return id;
      }
    }
    if (!palabras.length || !saltar.has(palabras[0])) return null;
    palabras = palabras.slice(1);
  }
  return null;
}

const codificar = (texto) => new TextEncoder().encode(texto);

function deHex(hex) {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** cuerpo: Uint8Array con los bytes tal como llegaron. */
export async function firmaOk(cuerpo, cabecera, secreto, ahoraSeg = Date.now() / 1000) {
  if (!secreto || !cabecera) return false;
  const partes = {};
  for (const trozo of String(cabecera).split(",")) {
    const corte = trozo.indexOf("=");
    if (corte > 0) partes[trozo.slice(0, corte).trim()] = trozo.slice(corte + 1).trim();
  }
  if (!/^\d+$/.test(partes.t ?? "")) return false;
  if (Math.abs(ahoraSeg - Number(partes.t)) > TOLERANCIA_RELOJ) return false;
  const firma = deHex(partes.v1 ?? "");
  if (!firma) return false;
  const prefijo = codificar(partes.t + ".");
  const firmado = new Uint8Array(prefijo.length + cuerpo.length);
  firmado.set(prefijo);
  firmado.set(cuerpo, prefijo.length);
  const clave = await crypto.subtle.importKey("raw", codificar(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", clave, firma, firmado); // comparación en tiempo constante
}

/** Firma un cuerpo como lo hace Vocci. Solo para pruebas. */
export async function firmar(cuerpo, secreto, t = Math.floor(Date.now() / 1000)) {
  const clave = await crypto.subtle.importKey("raw", codificar(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, codificar(`${t}.${cuerpo}`)));
  return `t=${t},v1=${[...firma].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function tokenOk(cabecera, token) {
  if (!token || !cabecera?.startsWith("Bearer ")) return false;
  // Comparar los resúmenes evita dar pistas por el tiempo de respuesta.
  const [a, b] = await Promise.all(
    [cabecera.slice(7).trim(), token].map((t) => crypto.subtle.digest("SHA-256", codificar(t))),
  );
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let distinto = 0;
  for (let i = 0; i < x.length; i++) distinto |= x[i] ^ y[i];
  return distinto === 0;
}

const ahoraIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/**
 * Atiende una petición.
 *   peticion: { metodo, ruta, cabecera(nombre) -> string|null, cuerpo() -> Promise<Uint8Array> }
 *   ajustes:  { secreto, token, agentes (de leerAgentes), muletillas?, prefijo? }
 *   almacen:  { guardar(nota) -> bool, pendientes(agente|null) -> [], atender(id) -> bool, purgar(antesDe) }
 *   registrar: función para el registro. Nunca recibe texto de notas ni claves.
 * Devuelve { codigo, datos }.
 */
export async function atender(peticion, ajustes, almacen, registrar = () => {}) {
  const prefijo = (ajustes.prefijo ?? "").replace(/\/+$/, "");
  if (!peticion.ruta.startsWith(prefijo + "/") && peticion.ruta !== prefijo) return { codigo: 404, datos: { error: "no existe" } };
  const [ruta, consulta = ""] = peticion.ruta.slice(prefijo.length).split("?");

  if (peticion.metodo === "GET" && ruta === "/salud") return { codigo: 200, datos: { ok: true } };

  if (ruta === "/cola" || /^\/cola\/\d+\/hecho$/.test(ruta)) {
    if (!(await tokenOk(peticion.cabecera("authorization"), ajustes.token))) {
      return { codigo: 401, datos: { error: "token no válido" } };
    }
    if (peticion.metodo === "GET" && ruta === "/cola") {
      const agente = new URLSearchParams(consulta).get("agente");
      return { codigo: 200, datos: { notas: await almacen.pendientes(agente || null) } };
    }
    if (peticion.metodo === "POST" && ruta !== "/cola") {
      const ok = await almacen.atender(Number(ruta.split("/")[2]), ahoraIso());
      return { codigo: ok ? 200 : 404, datos: { ok } };
    }
    return { codigo: 405, datos: { error: "método no válido" } };
  }

  if (peticion.metodo !== "POST" || ruta !== "/vocci") return { codigo: 404, datos: { error: "no existe" } };

  const largo = Number(peticion.cabecera("content-length") ?? 0);
  if (largo > MAX_CUERPO) return { codigo: 413, datos: { error: "tamaño no válido" } };
  const cuerpo = await peticion.cuerpo();
  if (!cuerpo.length || cuerpo.length > MAX_CUERPO) return { codigo: 413, datos: { error: "tamaño no válido" } };
  if (!(await firmaOk(cuerpo, peticion.cabecera("vocci-signature"), ajustes.secreto))) {
    registrar("rechazado: firma no válida");
    return { codigo: 401, datos: { error: "firma no válida" } };
  }
  let evento;
  try {
    evento = JSON.parse(new TextDecoder().decode(cuerpo));
  } catch {
    return { codigo: 400, datos: { error: "JSON no válido" } };
  }

  const prueba = Boolean(evento.test);
  if (evento.type !== "session.completed") {
    registrar(`ignorado: ${String(evento.type).slice(0, 40)}${prueba ? " (prueba)" : ""}`);
    return { codigo: 200, datos: { ok: true, accion: "ignorado" } };
  }
  const sesion = evento.data?.session ?? {};
  const texto = String(evento.data?.transcript?.text ?? "");
  let agente = destinatario(texto, ajustes.agentes, ajustes.muletillas);
  // El botón «Send test event» de Vocci sirve para comprobar la tubería: va al primer agente.
  if (!agente && prueba) agente = ajustes.agentes[0][0];
  if (!agente) {
    registrar("nota personal: sin destinatario, no se guarda");
    return { codigo: 200, datos: { ok: true, accion: "personal" } };
  }

  const recibida = ahoraIso();
  const eventoId = String(evento.id ?? "");
  const nueva = await almacen.guardar({
    evento_id: eventoId,
    // Cada evento de prueba cuenta como una nota distinta; una grabación real, una sola vez.
    sesion_id: prueba ? `prueba-${eventoId || recibida}` : String(sesion.id ?? eventoId),
    agente,
    titulo: String(sesion.title ?? "").slice(0, 300),
    texto: texto.slice(0, MAX_TEXTO),
    grabada: String(sesion.started_at ?? ""),
    recibida,
    prueba,
  });
  await almacen.purgar(new Date(Date.now() - DIAS_RASTRO * 86_400_000).toISOString());
  registrar(`nota para ${agente}${prueba ? " (prueba)" : ""}${nueva ? "" : " (repetida)"}`);
  return { codigo: 200, datos: { ok: true, accion: agente } };
}
