const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JNcXxzrlvFDXcrGo2b47';

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

const SILENCE_TIMEOUT = 0;

const ALEX_PROFILE = `Eres Alex, un project manager de 32 años de Buenos Aires con experiencia en empresas internacionales. Responde de forma amigable y profesional.`;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let botId = null;
  let conversationHistory = [];

  // Función OPTIMIZADA para generar audio con ElevenLabs (Turbo v2.5)
  async function generateElevenLabsAudio(text) {
    try {
      console.log('🎙️ Generando audio con ElevenLabs Turbo...');
      console.log(`📝 Texto: "${text}"`);

      const startTime = Date.now();

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5', // ✅ MODELO TURBO (mucho más rápido)
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          },
          optimize_streaming_latency: 4 // ✅ Máxima optimización de latencia
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ElevenLabs error: ${response.status} - ${error}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const mp3Base64 = Buffer.from(audioBuffer).toString('base64');

      const duration = Date.now() - startTime;
      console.log(`✅ Audio generado en ${duration}ms: ${mp3Base64.length} caracteres`);
      
      return mp3Base64;

    } catch (error) {
      console.error('❌ Error generando audio con ElevenLabs:', error.message);
      throw error;
    }
  }

  // Función para enviar audio al bot de Recall.ai
  async function sendAudioToBot(audioBase64) {
    if (!botId) {
      console.error('❌ No hay bot_id disponible para enviar audio');
      return;
    }

    try {
      console.log('🔊 Enviando audio al bot de Recall.ai...');
      const startTime = Date.now();
      
      const response = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${RECALL_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          kind: 'mp3',
          b64_data: audioBase64
        })
      });

      const duration = Date.now() - startTime;

      if (response.ok) {
        console.log(`✅ Audio enviado al bot en ${duration}ms`);
      } else {
        const error = await response.text();
        console.error('❌ Error enviando audio al bot:', response.status, error);
      }
    } catch (error) {
      console.error('❌ Error en sendAudioToBot:', error.message);
    }
  }

  // Función OPTIMIZADA para obtener respuesta de GPT-4
  async function getGPT4Response(userMessage) {
    try {
      console.log('🤖 Obteniendo respuesta de GPT-4o-mini...');
      const startTime = Date.now();

      conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: ALEX_PROFILE
            },
            ...conversationHistory
          ],
          temperature: 0.7,
          max_tokens: 150, // ✅ Reducido para respuestas más cortas y rápidas
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message.content;

      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }

      const duration = Date.now() - startTime;
      console.log(`🎯 Respuesta de GPT-4 en ${duration}ms:`, assistantMessage);
      
      return assistantMessage;

    } catch (error) {
      console.error('❌ Error obteniendo respuesta de GPT-4:', error.message);
      throw error;
    }
  }

  function detectAlexMention(text) {
    const lowerText = text.toLowerCase();
    return lowerText.includes('alex');
  }

  async function sendToAlex(text) {
    try {
      console.log('\n📤 Procesando mensaje para Alex:', text);
      const totalStartTime = Date.now();

      // ✅ OPTIMIZACIÓN: Ejecutar en secuencia pero con tracking de tiempo
      const responseText = await getGPT4Response(text);
      const audioBase64 = await generateElevenLabsAudio(responseText);
      await sendAudioToBot(audioBase64);

      const totalDuration = Date.now() - totalStartTime;
      console.log(`✅ Proceso completo en ${totalDuration}ms (${(totalDuration/1000).toFixed(2)}s)`);

    } catch (error) {
      console.error('❌ Error en sendToAlex:', error.message);
    }
  }

  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;

    try {
      const fullText = currentUtterance.map(word => word.text).join(' ');
      const speaker = currentUtterance[0].speaker;
      const speakerName = currentUtterance[0].speakerName;
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log('\n💾 PROCESANDO TRANSCRIPT COMPLETO:');
      console.log(`   👤 Speaker: ${speakerName} (${speaker})`);
      console.log(`   📝 Texto: "${fullText}"`);
      console.log(`   ⏱️  Duración: ${startTime}s - ${endTime}s`);
      console.log(`   📊 Palabras: ${currentUtterance.length}`);

      if (detectAlexMention(fullText)) {
        console.log('🔔 ¡Alex fue mencionado! Procesando respuesta...');
        await sendToAlex(fullText);
      }

      currentUtterance = [];

    } catch (error) {
      console.error('❌ Error en processCompleteUtterance:', error.message);
    }
  }

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'transcript.data') {
        const words = data.data?.data?.words;
        const participant = data.data?.data?.participant;
        
        if (!botId && data.data?.bot?.id) {
          botId = data.data.bot.id;
          console.log(`🤖 Bot ID capturado: ${botId}`);
        }

        if (words && words.length > 0 && participant) {
          console.log(`\n📥 Recibido transcript.data con ${words.length} palabras`);

          const speakerId = participant.id;
          const speakerName = participant.name || `Speaker ${speakerId}`;

          if (lastSpeaker !== null && lastSpeaker !== speakerId) {
            console.log(`🔄 Cambio de speaker detectado: ${lastSpeaker} → ${speakerId}`);
            processCompleteUtterance();
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
      } else if (data.event === 'transcript.partial_data') {
        console.log('   ⏭️  Ignorando partial_data');
      }
      
    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message);
    }
  });

  ws.on('close', async function close(code, reason) {
    console.log(`\n❌ Conexión cerrada desde: ${clientIp}`);
    console.log(`   Código: ${code}, Razón: ${reason || 'No especificada'}`);
    
    if (currentUtterance.length > 0) {
      await processCompleteUtterance();
    }
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  ws.on('error', function error(err) {
    console.error('❌ Error en WebSocket:', err.message);
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  ws.on('close', () => {
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
