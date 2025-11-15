const ws = require('ws');
const WebSocket = ws.WebSocket || ws;
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';

// ========== ELEVENLABS EN HOLD - DESCOMENTÁ ESTO PARA USAR ELEVENLABS ==========
// const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JNcXxzrlvFDXcrGo2b47';
// ================================================================================

const OPENAI_WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

const wss = new ws.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');
console.log('🎤 Modo: OpenAI Realtime API (Audio directo)');
console.log('💡 ElevenLabs: EN HOLD (para comparar)\n');

const SILENCE_TIMEOUT = 3000;

const ALEX_PROFILE = `Sos Alex, un project manager experto que vive en Buenos Aires, Argentina. 
Tenés 32 años y amplia experiencia trabajando en empresas internacionales.
Tu rol es asistir en reuniones cuando te mencionen por nombre.
Respondé de forma breve y natural, usando modismos argentinos cuando sea apropiado.
Hablá como un porteño: usá "vos" en lugar de "tú", conjugá los verbos en forma rioplatense.
Ejemplos: "¿Cómo andás?", "Dale, dale", "Mirá", "Bueno, che", "Perfecto, dale".
Mantené un tono profesional pero cercano, como en una charla de oficina en Buenos Aires.`;

wss.on('connection', function connection(ws_client, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let openaiWs = null;
  let openaiReady = false;
  let audioChunks = [];
  let botId = null;
  let conversationStartTime = null;

  // =====================================================================================
  // FUNCIÓN: Inicializar OpenAI Realtime API con AUDIO
  // =====================================================================================
  function initOpenAI() {
    console.log('\n🔍 Verificando OPENAI_API_KEY...');
    console.log('   Key presente:', !!OPENAI_API_KEY);
    console.log('   Key length:', OPENAI_API_KEY ? OPENAI_API_KEY.length : 0);
    
    if (!OPENAI_API_KEY) {
      console.log('❌ OPENAI_API_KEY no configurada - OpenAI deshabilitado');
      return;
    }

    console.log('\n🤖 Iniciando sesión con OpenAI Realtime API (AUDIO)...');
    console.log('   URL:', OPENAI_WS_URL);
    
    try {
      openaiWs = new WebSocket(OPENAI_WS_URL, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      openaiWs.on('open', () => {
        console.log('✅ Conectado a OpenAI Realtime API');
        
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],  // ← AUDIO HABILITADO
            instructions: ALEX_PROFILE,
            voice: 'shimmer',  // ← Voz más natural y cálida (opciones: alloy, echo, shimmer)
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: null,  // Desactivado, controlamos manualmente
            temperature: 0.9,  // ← Más creatividad para sonar más natural
            max_response_output_tokens: 150  // ← Respuestas cortas y concisas
          }
        };
        
        openaiWs.send(JSON.stringify(sessionConfig));
        console.log('📋 Perfil de Alex configurado (con audio)');
        openaiReady = true;
      });
    } catch (error) {
      console.error('❌ Error creando WebSocket de OpenAI:', error.message);
      console.error('   Stack:', error.stack);
      return;
    }

    // =====================================================================================
    // MANEJO DE MENSAJES DE OPENAI
    // =====================================================================================
    openaiWs.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        
        // ============ CAPTURAR AUDIO ============
        if (event.type === 'response.audio.delta') {
          console.log('🎵 Chunk de audio recibido');
          audioChunks.push(event.delta);
        }

        // ============ AUDIO COMPLETO ============
        if (event.type === 'response.audio.done') {
          const endTime = Date.now();
          const totalTime = conversationStartTime ? endTime - conversationStartTime : 0;
          
          console.log(`✅ Audio completo recibido (${totalTime}ms desde inicio)`);
          
          const fullAudio = audioChunks.join('');
          console.log(`📦 Audio total: ${fullAudio.length} caracteres en base64`);
          
          if (botId && fullAudio) {
            sendAudioToRecall(fullAudio);
          }
          
          audioChunks = [];
        }

        // ============ TEXTO DE RESPUESTA (para logging) ============
        if (event.type === 'response.text.delta') {
          console.log('💬 Texto:', event.delta);
        }

        // ============ ERROR HANDLING ============
        if (event.type === 'error') {
          console.error('❌ Error de OpenAI:', event.error);
        }

      } catch (e) {
        console.error('❌ Error procesando mensaje de OpenAI:', e.message);
      }
    });

    openaiWs.on('error', (error) => {
      console.error('❌ Error en WebSocket de OpenAI:', error.message);
      console.error('   Código:', error.code);
      console.error('   Stack:', error.stack);
    });

    openaiWs.on('close', (code, reason) => {
      console.log('🔌 Conexión con OpenAI cerrada');
      console.log('   Código:', code);
      console.log('   Razón:', reason ? reason.toString() : 'No especificada');
      openaiReady = false;
    });
  }

  // =====================================================================================
  // FUNCIÓN: Enviar audio a Recall.ai
  // =====================================================================================
  async function sendAudioToRecall(audioBase64) {
    if (!botId) {
      console.log('⚠️  No hay bot_id, no se puede enviar audio');
      return;
    }

    console.log(`📤 Enviando audio a Recall bot ${botId}...`);
    
    try {
      const response = await axios.post(
        `https://api.recall.ai/api/v1/bot/${botId}/send_audio`,
        {
          audio: audioBase64,
          sample_rate: 24000
        },
        {
          headers: {
            'Authorization': `Token ${RECALL_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 200) {
        console.log('✅ Audio enviado exitosamente a Recall.ai');
      } else {
        console.log(`⚠️  Respuesta inesperada de Recall.ai: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error enviando audio a Recall:', error.response?.data || error.message);
    }
  }

  // =====================================================================================
  // FUNCIÓN: Enviar texto a Alex (OpenAI) y recibir AUDIO de respuesta
  // =====================================================================================
  async function sendToAlex(text) {
    if (!openaiReady || !openaiWs) {
      console.log('⚠️  OpenAI no está listo');
      return;
    }

    conversationStartTime = Date.now();
    console.log(`\n⏱️  [${conversationStartTime}] Enviando a Alex: "${text}"`);

    try {
      audioChunks = [];
      
      const message = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text
            }
          ]
        }
      };

      openaiWs.send(JSON.stringify(message));
      
      const createResponse = {
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],  // ← Pedimos audio en la respuesta
          instructions: 'Respondé de forma natural y breve, como en una charla de oficina. Usá el voseo argentino.'
        }
      };

      openaiWs.send(JSON.stringify(createResponse));
      
      console.log('📤 Mensaje enviado a OpenAI (esperando audio)...');

    } catch (error) {
      console.error('❌ Error enviando a OpenAI:', error.message);
    }
  }

  // =====================================================================================
  // FUNCIÓN: Procesar transcript completo (al detectar silencio)
  // =====================================================================================
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;

    try {
      const fullText = currentUtterance.map(word => word.text).join(' ');
      const speaker = currentUtterance[0].speakerName || 'Desconocido';
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log(`\n💬 Utterance completa de ${speaker}:`);
      console.log(`   "${fullText}"`);
      console.log(`   Duración: ${startTime}s - ${endTime}s`);

      // Guardar en Supabase
      try {
        const { data, error } = await supabase
          .from('transcripts')
          .insert([{
            speaker: speaker,
            text: fullText,
            start_time: startTime,
            end_time: endTime,
            word_count: currentUtterance.length,
            created_at: new Date().toISOString()
          }]);

        if (error) {
          console.error('❌ Error guardando en Supabase:', error.message);
        } else {
          console.log('✅ Guardado en Supabase exitosamente');
        }
      } catch (dbError) {
        console.error('❌ Error de base de datos:', dbError.message);
      }

      // ============ DETECCIÓN DE "ALEX" ============
      const lowerText = fullText.toLowerCase();
      if (lowerText.includes('alex')) {
        console.log('\n🎯 ¡Palabra clave "ALEX" detectada!');
        await sendToAlex(fullText);
      }

      currentUtterance = [];

    } catch (error) {
      console.error('❌ Error procesando utterance:', error.message);
    }
  }

  // =====================================================================================
  // MANEJO DE MENSAJES DE RECALL.AI
  // =====================================================================================
  ws_client.on('message', async function incoming(message) {
    try {
      const data = JSON.parse(message);

      // ============ CAPTURAR BOT_ID ============
      if (data.event === 'bot.status_change') {
        if (!botId && data.data?.id) {
          botId = data.data.id;
          console.log(`\n🤖 Bot ID capturado: ${botId}`);
          initOpenAI();
        }
      }

      // ============ PROCESAR TRANSCRIPTS ============
      if (data.event === 'transcript.data') {
        if (!data.data?.data?.words) {
          return;
        }

        const words = data.data.data.words;
        const speakerId = data.data.speaker_id || 'unknown';
        const speakerName = data.data.speaker || 'Speaker';

        console.log(`\n📝 Transcript de ${speakerName}:`);
        console.log(`   ${words.length} palabras nuevas`);

        if (lastSpeaker && lastSpeaker !== speakerId && currentUtterance.length > 0) {
          console.log('🔄 Cambio de speaker detectado');
          await processCompleteUtterance();
        }

        words.forEach(word => {
          const text = word.text || '';
          if (text.trim()) {
            currentUtterance.push({
              text: text,
              speaker: speakerId,
              speakerName: speakerName,
              start_time: word.start_timestamp?.relative || 0,
              end_time: word.end_timestamp?.relative || 0
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
      }

    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message);
    }
  });

  // =====================================================================================
  // CLEANUP AL CERRAR CONEXIÓN
  // =====================================================================================
  ws_client.on('close', async function close(code, reason) {
    console.log(`\n❌ Conexión cerrada desde: ${clientIp}`);
    console.log(`   Código: ${code}, Razón: ${reason || 'No especificada'}`);
    
    if (currentUtterance.length > 0) {
      console.log('💾 Procesando transcript pendiente...');
      await processCompleteUtterance();
    }
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (openaiWs) {
      try {
        openaiWs.close();
        console.log('🤖 Conexión con OpenAI cerrada');
      } catch (e) {
        console.error('❌ Error cerrando OpenAI:', e.message);
      }
    }
  });

  ws_client.on('error', function error(err) {
    console.error('❌ Error en WebSocket:', err.message);
  });

  const pingInterval = setInterval(() => {
    if (ws_client.readyState === 1) {
      ws_client.ping();
    }
  }, 30000);

  ws_client.on('close', () => {
    clearInterval(pingInterval);
  });
});

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promesa rechazada:', reason);
});

console.log('\n📡 Esperando conexiones de Recall.ai...\n');


// =====================================================================================
// =====================================================================================
//
//  📝 CÓDIGO DE ELEVENLABS EN HOLD (COMENTADO)
//
//  Para volver a usar ElevenLabs en lugar de OpenAI audio:
//  1. Descomentá las constantes de ElevenLabs al inicio
//  2. Reemplazá la función sendToAlex con esta versión:
//
// =====================================================================================
// =====================================================================================

/*
async function sendToAlex(text) {
  try {
    console.log(`\n⏱️  Enviando a Alex: "${text}"`);
    const startTime = Date.now();

    // 1. GPT-4o-mini para texto
    const gptResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: ALEX_PROFILE },
          { role: 'user', content: text }
        ],
        max_tokens: 100,
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const responseText = gptResponse.data.choices[0].message.content;
    const gptTime = Date.now() - startTime;
    console.log(`✅ GPT-4o-mini respondió (${gptTime}ms): "${responseText}"`);

    // 2. ElevenLabs streaming TTS
    const ttsStartTime = Date.now();
    const ttsResponse = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
      {
        text: responseText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    const audioBuffer = Buffer.from(ttsResponse.data);
    const audioBase64 = audioBuffer.toString('base64');
    const ttsTime = Date.now() - ttsStartTime;
    console.log(`✅ ElevenLabs TTS completado (${ttsTime}ms)`);

    // 3. Enviar a Recall.ai
    if (botId) {
      await sendAudioToRecall(audioBase64);
    }

    const totalTime = Date.now() - startTime;
    console.log(`⏱️  Tiempo total: ${totalTime}ms (GPT: ${gptTime}ms + TTS: ${ttsTime}ms)`);

  } catch (error) {
    console.error('❌ Error en sendToAlex:', error.response?.data || error.message);
  }
}
*/
