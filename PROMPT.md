# Puente Vocci → tu agente

> **Antes de usarlo:** pega este texto a tu agente y pídele primero que lo analice, junto con el repositorio que menciona, y que te diga si ve algo raro. Hazlo siempre con cualquier prompt o programa que te bajes de internet, este incluido.

Quiero que montes en mi ordenador un puente entre mi anillo Vocci y mis agentes. Cuando grabe una nota que empiece por el nombre de un agente («Bruno, apunta que…»), la nota tiene que llegar sola al hilo o conversación de ese agente, y él la atiende como si yo se la hubiera escrito allí.

Vale para Claude (app de escritorio con Claude Code) y para Codex (app de escritorio). Lee el texto entero antes de hacer nada.

## Cómo funciona

1. Vocci manda un webhook firmado (`session.completed`) cuando la nota ya tiene transcripción. La firma va en la cabecera `Vocci-Signature` (`t=…,v1=…`, HMAC-SHA256 de `<t>.<cuerpo>`).
2. Un buzón en internet comprueba la firma y mira la primera palabra de la nota.
3. Si empieza por el nombre de un agente, la nota pasa a la cola de ese agente. Si no nombra a nadie es una nota personal y no se guarda.
4. Mi PC lee la cola cada 30 segundos con una petición web. Mientras no hay notas no se gasta ningún modelo.
5. Por cada nota, un repartidor la entrega en el hilo o conversación elegidos. Cuando la entrega está confirmada, el buzón borra el texto.

Con el PC apagado o la app cerrada, las notas esperan en el buzón y entran al encenderlo.

## No lo escribas desde cero

El programa ya está hecho y probado: `https://github.com/GadgetLabAI/vocci-puente`. Descárgalo con `git clone` en una carpeta fija de mi usuario (que no esté sincronizada con ninguna nube), **léelo entero** (son tres archivos: `puente.mjs`, `buzon/nucleo.mjs` y `buzon/worker.mjs`) y dime en pocas líneas qué hace y si ves algo que no te guste. Si algo te parece peligroso, para y cuéntamelo.

Después sigue su `README.md`. Tu trabajo es configurarlo, no reescribirlo. Si algo falla, arregla la configuración; no cambies el código sin decírmelo.

Hace falta Node 20 o superior. Si no está instalado, dime cómo instalarlo y espera.

## Primero, pregúntame

Antes de tocar nada, hazme estas preguntas, todas juntas, y espera mis respuestas. Donde puedas averiguar la respuesta tú, propónmela y yo la confirmo.

1. **¿Eres Claude o Codex?** De eso depende la entrega: en Claude es un mensaje al hilo de la app de escritorio, buscado por su nombre; en Codex, un mensaje a la conversación por su identificador.
2. **¿Un agente o varios?** Para cada uno:
   - la palabra que lo activa (su nombre);
   - si es Claude o Codex (por ahora solo valen esos dos);
   - el hilo o conversación de destino. En Claude, el nombre exacto del hilo, que tiene que ser único: si hay dos con nombres parecidos, proponme renombrar uno. En Codex, el identificador de la conversación; si el destino es esta misma, averígualo tú.
3. **¿Tengo servidor propio (VPS)?**
   - Si lo tengo, monta allí el buzón (apartado «En tu servidor» del README).
   - Si no, monta un Cloudflare Worker gratis en mi cuenta. Si no tengo cuenta, guíame para crearla. El inicio de sesión (`npx wrangler login`) lo hago yo en el navegador. En mi cuenta crea solo el Worker y su base de datos; no toques nada más.
4. **Sistema operativo** de este PC, para el arranque automático.
5. **Cómo me llamo**, para el texto que acompaña a cada nota, y en qué idioma lo quiero (español o inglés).
6. **Reglas para las notas (opcional).** Explícame esto tal cual: el puente solo entrega mensajes y no te da ningún permiso nuevo; con una nota de voz podrás hacer lo mismo que cuando te escribo. Como una transcripción puede equivocarse con un nombre o una cifra, cada nota viaja con dos reglas de prudencia:
   - lo que salga hacia fuera o no se pueda deshacer (enviar un correo, publicar, comprar, borrar) se prepara y espera mi sí;
   - si la transcripción no se entiende, no se adivina: se me pregunta.

   Pregúntame si las dejo así o quiero cambiar, quitar o añadir alguna (por ejemplo, «los correos a mi propia dirección salen directos»). Dime que puedo cambiarlas cuando quiera en los ajustes.

## Después, móntalo

Con mis respuestas:

1. `node puente.mjs iniciar` y rellena los ajustes (`~/.vocci-puente/ajustes.json`).
2. **Variantes del nombre.** La transcripción se equivoca con los nombres propios. Para cada agente, piensa cinco o diez formas en que un transcriptor podría escribir mal su nombre en mi idioma (por ejemplo, para «Bruno»: pruno, runo, bruna, brunno, brumo) y ponlas en `palabras`. Enséñame la lista antes de seguir. No pongas palabras corrientes: una nota personal que empiece por una de ellas acabaría en el agente.
3. Monta el buzón siguiendo el README (Cloudflare o servidor).
4. **El secreto del webhook lo pongo yo.** Dime dónde crear el endpoint en Vocci (`my.vocci.ai` → Developer → Webhooks, evento `session.completed`, con la dirección del buzón terminada en `/vocci`) y qué orden ejecutar en mi terminal para guardar el secreto. No me pidas que lo pegue en el chat y no lo escribas en ningún archivo.
5. `node puente.mjs comprobar --a-fondo` hasta que todo salga en orden. Si dice que el comando `claude` no tiene la sesión iniciada, pídeme que ejecute `claude auth login`: la terminal lleva su propio inicio de sesión, aparte del de la app.
6. `node puente.mjs arranque instalar`.

## Las claves

- El secreto del webhook y el token de lectura se quedan en mi equipo y en el buzón. Nunca en el chat, en los ajustes, en el repositorio ni en una carpeta sincronizada.
- No imprimas el contenido de `~/.vocci-puente/secretos.json`.

## Pruébalo conmigo

1. `node puente.mjs probar <agente> "texto de prueba"`: tiene que aparecer en el hilo.
2. Pídeme que pulse «Send test event» en Vocci: en menos de un minuto debe llegar un mensaje de prueba al hilo del primer agente.
3. Pídeme una nota real con el anillo que empiece por el nombre de cada agente, y otra personal que no nombre a nadie. Comprueba que las primeras llegan (Vocci tarda uno o dos minutos en transcribir) y que la personal no aparece en la cola.

Si algo no llega, mira `~/.vocci-puente/puente.log` y el apartado «Si una nota no llega» del README antes de cambiar nada.

## Al terminar

- Apunta en la memoria o en las instrucciones de cada agente que le pueden llegar notas del anillo por este puente y cuáles son mis reglas para ellas.
- Explícame en pocas líneas:
  - qué has montado y dónde está cada cosa;
  - cómo se para y cómo se quita (`node puente.mjs arranque quitar`, borrar el Worker o el servicio y el endpoint de Vocci);
  - qué pasa con el PC apagado: las notas esperan en el buzón y entran al encenderlo;
  - qué gasta: en Claude, una llamada pequeña por nota; en Codex, nada hasta que el agente la atiende;
  - que si un día deja de llegar una nota, lo primero es mirar `~/.vocci-puente/puente.log`;
  - que en Codex la entrega usa una pieza interna de la app y una actualización puede romperla.
