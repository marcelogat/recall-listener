// =====================================================================================
//  SERVIDOR COMPLETO RECALL.AI + OPENAI REALTIME
//  BOT_ID DINÁMICO — VERSIÓN CORREGIDA
// =====================================================================================

const WebSocket = require("ws");
const axios = require("axios");
const { createClient } = require('@supabase/supabase-js');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_WS_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

const wss = new WebSocket.Server({ port: 8080 });

const SILENCE_TIMEOUT = 3000;

console.log("🚀 Servidor WebSocket escuchando Recall.ai en puerto 8080");

// =====================================================================================
// CONEXIÓN CON RECALL.AI
// =====================================================================================
wss.on("connection", (recallWs, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n🎧 Nueva conexión de Recall.ai desde: ${clientIp}`);

  let openaiWs = null;
  let openaiReady = false;
  let ACTIVE_BOT_ID = null;
  let audioChunks = [];
  
  // Variables para transcripción
  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;

  // =====================================================================================
  // INICIALIZAR OPENAI
  // =====================================================================================
  function initOpenAI() {
    if (!OPENAI_API_KEY) {
      console.log("⚠️ OPENAI_API_KEY no configurada");
      return;
    }

    console.log("\n🤖 Iniciando sesión con OpenAI Realtime API...");

    openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on("open", () => {
      console.log("✅ OpenAI conectado");

      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions:
              "Eres Alex, un project manager experto que vive en Buenos Aires, Argentina. Tienes 32 años y amplia experiencia trabajando en empresas internacionales. Responde de forma breve y concisa en español.",
            voice: "alloy",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: null,
            temperature: 0.8,
          },
        })
      );

      openaiReady = true;
      console.log("📋 Perfil de Alex enviado a OpenAI");
    });

    openaiWs.on("message", (raw) => {
      try {
        const event = JSON.parse(raw);

        // Logs de eventos
        if (event.type === "response.text.delta") {
          console.log(`🤖 ALEX: ${event.delta}`);
        } else if (event.type === "response.text.done") {
          console.log(`\n✅ ALEX terminó: ${event.text}`);
        }

        // Recibir audio de OpenAI
        if (event.type === "response.audio.delta") {
          console.log(`🔊 Recibiendo chunk de audio de OpenAI`);
          audioChunks.push(Buffer.from(event.delta, "base64"));
        }

        if (event.type === "response.audio.done") {
          console.log(`✅ Audio completo recibido de OpenAI`);
          const fullAudio = Buffer.concat(audioChunks);
          audioChunks = [];
          sendAudioToRecall(fullAudio);
        }

        if (event.type === "response.done") {
          console.log(`✅ Respuesta completa de OpenAI`);
        } else if (
          event.type !== "response.audio.delta" &&
          event.type !== "response.text.delta"
        ) {
          console.log(`📨 OpenAI event: ${event.type}`);
        }
      } catch (e) {
        console.error("❌ Error procesando mensaje de OpenAI:", e.message);
      }
    });

    openaiWs.on("error", (error) => {
      console.error("❌ Error en OpenAI WebSocket:", error.message);
      openaiReady = false;
    });

    openaiWs.on("close", () => {
      console.log("❌ OpenAI desconectado");
      openaiReady = false;
    });
  }

  // =====================================================================================
  // ENVIAR AUDIO A RECALL
  // =====================================================================================
  async function sendAudioToRecall(buffer) {
    if (!ACTIVE_BOT_ID) {
      console.log("⚠️ No tengo bot_id todavía — no envío audio");
      return;
    }

    try {
      // Convertir PCM16 a base64
      const base64Audio = buffer.toString("base64");

      const response = await axios.post(
        `https://us-west-2.recall.ai/api/v1/bot/${ACTIVE_BOT_ID}/output_audio/`,
        {
          kind: "raw",
          b64_data: base64Audio,
        },
        {
          headers: {
            Authorization: `Token ${RECALL_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`🔊 Audio enviado a Recall (BOT: ${ACTIVE_BOT_ID})`);
    } catch (e) {
      console.error("❌ Error enviando audio:", e.response?.data || e.message);
    }
  }

  // =====================================================================================
  // PROCESAR UTTERANCE COMPLETO (SUPABASE)
  // =====================================================================================
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;

    try {
      const fullText = currentUtterance.map((word) => word.text).join(" ");
      const speaker = currentUtterance[0].speaker;
      const speakerName = currentUtterance[0].speakerName;
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log("\n" + "=".repeat(80));
      console.log(`💾 GUARDANDO EN SUPABASE:`);
      console.log(`   Speaker: ${speakerName} (${speaker})`);
      console.log(`   Texto: ${fullText}`);
      console.log(`   Duración: ${startTime}s - ${endTime}s`);
      console.log("=".repeat(80));

      // Verificar si mencionan a "Alex"
      if (fullText.toLowerCase().includes("alex")) {
        console.log("\n🔔 ¡ALEX FUE MENCIONADO!");

        if (openaiReady && openaiWs && openaiWs.readyState === 1) {
          try {
            openaiWs.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: fullText,
                    },
                  ],
                },
              })
            );

            openaiWs.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                  instructions: "Responde de forma natural y conversacional en español.",
                },
              })
            );

            console.log(`📤 Texto enviado a OpenAI: "${fullText}"`);
            console.log(`🎤 Esperando respuesta en audio...`);
          } catch (e) {
            console.error("❌ Error enviando a OpenAI:", e.message);
          }
        } else {
          console.log(`⚠️ OpenAI no está listo (ready: ${openaiReady})`);
        }
      }

      // Guardar en Supabase
      const { data, error } = await supabase
        .from("transcripts")
        .insert([
          {
            speaker: speakerName,
            text: fullText,
            start_time: startTime,
            end_time: endTime,
            word_count: currentUtterance.length,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (error) {
        console.error("❌ Error al guardar en Supabase:", error);
      } else {
        console.log("✅ Guardado exitosamente en Supabase");
      }

      currentUtterance = [];
    } catch (error) {
      console.error("❌ Error en processCompleteUtterance:", error);
    }
  }

  // =====================================================================================
  // INICIALIZAR OPENAI AL CONECTAR
  // =====================================================================================
  initOpenAI();

  // =====================================================================================
  // MANEJO DE MENSAJES DE RECALL.AI
  // =====================================================================================
  recallWs.on("message", async (msg) => {
    let data;

    try {
      data = JSON.parse(msg);
    } catch {
      console.log("⚠️ Mensaje no-JSON recibido");
      return;
    }

    const eventType = data.event;

    // Detectar BOT ID
    if (!ACTIVE_BOT_ID && data.data?.bot_id) {
      ACTIVE_BOT_ID = data.data.bot_id;
      console.log("🎯 BOT ID detectado:", ACTIVE_BOT_ID);
    }

    // Procesar transcripción
    if (eventType === "transcript.data" || eventType === "transcript.partial_data") {
      const words = data.data?.data?.words || [];
      const participant = data.data?.data?.participant;

      if (!words || words.length === 0) {
        return;
      }

      const speakerId = participant?.id || "unknown";
      const speakerName = participant?.name || `Speaker ${speakerId}`;

      console.log(`\n📝 [${speakerName}] Recibidas ${words.length} palabras`);
      console.log(`   Texto: ${words.map((w) => w.text).join(" ")}`);

      // Cambio de speaker
      if (lastSpeaker !== null && lastSpeaker !== speakerId) {
        console.log(`🔄 Cambio de speaker detectado`);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        await processCompleteUtterance();
      }

      // Solo procesar transcript.data (completo)
      if (eventType === "transcript.data") {
        words.forEach((word) => {
          const text = word.text || "";
          if (text.trim()) {
            currentUtterance.push({
              text: text,
              speaker: speakerId,
              speakerName: speakerName,
              start_time: word.start_timestamp?.relative || 0,
              end_time: word.end_timestamp?.relative || 0,
            });
          }
        });

        lastSpeaker = speakerId;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
          processCompleteUtterance();
        }, SILENCE_TIMEOUT);

        console.log(`   Total acumulado: ${currentUtterance.length} palabras`);
      } else {
        console.log(`   ⏭️ Ignorando partial_data (esperando transcript.data completo)`);
      }
    }
  });

  // =====================================================================================
  // CERRAR CONEXIÓN
  // =====================================================================================
  recallWs.on("close", async (code, reason) => {
    console.log(`\n❌ Conexión cerrada desde: ${clientIp}`);
    console.log(`   Código: ${code}, Razón: ${reason || "No especificada"}`);

    if (currentUtterance.length > 0) {
      console.log("💾 Procesando transcript pendiente...");
      await processCompleteUtterance();
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (openaiWs) {
      try {
        openaiWs.close();
        console.log("🤖 Conexión con OpenAI cerrada");
      } catch (e) {
        console.error("❌ Error cerrando OpenAI:", e.message);
      }
    }
  });

  recallWs.on("error", (err) => {
    console.error("❌ Error en WebSocket:", err.message);
  });
});

process.on("uncaughtException", (error) => {
  console.error("❌ Error no capturado:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Promesa rechazada:", reason);
});

console.log("\n📡 Esperando conexiones de Recall.ai...\n");
