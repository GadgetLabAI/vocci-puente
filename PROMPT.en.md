# Vocci → your agent bridge

> **Before you use it:** paste this text to your agent and first ask it to review it, together with the repository it mentions, and tell you if anything looks off. Do this with any prompt or program you download from the internet, this one included.

I want you to set up, on my computer, a bridge between my Vocci ring and my agents. When I record a note that starts with an agent's name (“Bruno, note that…”), the note must arrive by itself in that agent's thread or conversation, and the agent handles it as if I had typed it there.

It works with Claude (desktop app with Claude Code) and with Codex (desktop app). Read the whole text before doing anything.

## How it works

1. Vocci sends a signed webhook (`session.completed`) once the note has a transcript. The signature is in the `Vocci-Signature` header (`t=…,v1=…`, HMAC-SHA256 of `<t>.<body>`).
2. A mailbox on the internet checks the signature and looks at the first word of the note.
3. If it starts with an agent's name, the note goes to that agent's queue. If it names nobody it is a personal note and is not stored.
4. My PC reads the queue every 30 seconds with a web request. While there are no notes, no model is used.
5. For each note, a delivery process puts it in the chosen thread or conversation. Once delivery is confirmed, the mailbox deletes the text.

With the PC off or the app closed, notes wait in the mailbox and arrive when it is back on.

## Do not write it from scratch

The program already exists and is tested: `https://github.com/GadgetLabAI/vocci-puente`. Download it with `git clone` into a fixed folder in my user directory (not synced to any cloud), **read all of it** (three files: `puente.mjs`, `buzon/nucleo.mjs` and `buzon/worker.mjs`) and tell me in a few lines what it does and whether you see anything you do not like. If something looks dangerous, stop and tell me.

Then follow its `README.en.md`. Your job is to configure it, not to rewrite it. If something fails, fix the configuration; do not change the code without telling me. The code, its commands and its settings are named in Spanish; the README explains each one.

It needs Node 20 or later. If it is not installed, tell me how to install it and wait.

## First, ask me

Before touching anything, ask me these questions, all together, and wait for my answers. Where you can find the answer yourself, propose it and I will confirm.

1. **Are you Claude or Codex?** Delivery depends on it: in Claude it is a message to the desktop app thread, found by its name; in Codex, a message to the conversation by its identifier.
2. **One agent or several?** For each one:
   - the word that triggers it (its name);
   - whether it is Claude or Codex (only those two for now);
   - the destination thread or conversation. In Claude, the exact thread name, which must be unique: if two threads have similar names, suggest renaming one. In Codex, the conversation identifier; if the destination is this very conversation, find it yourself.
3. **Do I have my own server (VPS)?**
   - If I do, set up the mailbox there (“On your own server” in the README).
   - If not, set up a free Cloudflare Worker in my account. If I have no account, guide me through creating one. I do the sign-in (`npx wrangler login`) myself in the browser. In my account, create only the Worker and its database; do not touch anything else.
4. **Operating system** of this PC, for the autostart.
5. **My name**, for the text that goes with each note, and the language I want it in (`"idioma": "en"` for English).
6. **Rules for the notes (optional).** Explain this to me as is: the bridge only delivers messages and gives you no new permission; with a voice note you can do exactly what you can do when I type. Because a transcript can get a name or a figure wrong, each note travels with two cautious rules:
   - anything that goes out or cannot be undone (sending an email, publishing, buying, deleting) is prepared and waits for my yes;
   - if the transcript is unclear, you do not guess: you ask me.

   Ask me whether I keep them or want to change, remove or add any (for example, “emails to my own address go out directly”). Tell me I can change them any time in the settings.

## Then, set it up

With my answers:

1. `node puente.mjs iniciar` and fill in the settings (`~/.vocci-puente/ajustes.json`).
2. **Name variants.** Transcription gets proper names wrong. For each agent, think of five to ten ways a transcriber could misspell its name in my language and put them in `palabras`. Show me the list before going on. Do not use common words: a personal note starting with one of them would end up with the agent.
3. Set up the mailbox following the README (Cloudflare or server).
4. **I enter the webhook secret myself.** Tell me where to create the endpoint in Vocci (`my.vocci.ai` → Developer → Webhooks, event `session.completed`, with the mailbox address ending in `/vocci`) and which command to run in my terminal to store the secret. Do not ask me to paste it in the chat and do not write it to any file.
5. `node puente.mjs comprobar --a-fondo` until everything is in order. If it says the `claude` command is not signed in, ask me to run `claude auth login`: the terminal has its own sign-in, separate from the app's.
6. `node puente.mjs arranque instalar`.

## Secrets

- The webhook secret and the read token stay on my machine and in the mailbox. Never in the chat, the settings, the repository or a synced folder.
- Do not print the contents of `~/.vocci-puente/secretos.json`.

## Test it with me

1. `node puente.mjs probar <agent> "test text"`: it must appear in the thread.
2. Ask me to press “Send test event” in Vocci: within a minute a test message must reach the first agent's thread.
3. Ask me for a real note with the ring that starts with each agent's name, and a personal one that names nobody. Check that the first ones arrive (Vocci takes a minute or two to transcribe) and that the personal one never shows up in the queue.

If something does not arrive, look at `~/.vocci-puente/puente.log` and the “If a note does not arrive” section of the README before changing anything.

## When you finish

- Write in each agent's memory or instructions that notes from the ring may arrive through this bridge, and what my rules for them are.
- Explain to me in a few lines:
  - what you set up and where each thing is;
  - how to stop it and remove it (`node puente.mjs arranque quitar`, delete the Worker or the service and the Vocci endpoint);
  - what happens with the PC off: notes wait in the mailbox and arrive when it is back on;
  - what it costs: in Claude, one small call per note; in Codex, nothing until the agent handles it;
  - that if a note ever stops arriving, the first thing to check is `~/.vocci-puente/puente.log`;
  - that in Codex delivery uses an internal part of the app and an update may break it.
