const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Adam (puedes cambiar)

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

const SILENCE_TIMEOUT = 3000;

const ALEX_PROFILE = `Eres Alex, un project manager experto que vive en Buenos Aires, Argentina. 
Tienes 32 años y amplia experiencia trabajando en empresas internacionales liderando equipos y proyectos complejos.

Tu personalidad es cálida, profesional y colaborativa. Hablas de forma natural y conversacional, como un colega experimentado que está genuinamente interesado en ayudar.

Cuando te llaman en una reunión:
- Saluda de forma amigable y muestra que estás presente y atento
- Responde con entusiasmo profesional, mostrando interés genuino
- Da respuestas completas y útiles (2-4 oraciones está perfecto)
- Usa un tono conversacional y cercano, como si estuvieras físicamente en la sala
- Comparte insights basados en tu experiencia cuando sea relevante
- Pregunta si necesitan más detalles o si puedes ayudar con algo específico
- Usa expresiones naturales argentinas ocasionalmente (pero sin exagerar)

Ejemplos de cómo deberías responder:
- "¡Hola! Sí, aquí estoy. ¿En qué los puedo ayudar hoy?"
- "Claro que sí, con gusto. Basándome en proyectos similares que he manejado, les recomendaría enfocarse primero en [X] porque [razón]. ¿Quieren que profundice en algún aspecto?"
- "Buena pregunta. En mi experiencia, cuando nos enfrentamos a esto lo mejor es [sugerencia detallada]. ¿Tiene sentido para el equipo o prefieren explorar otras alternativas?"
- "Dale, perfecto. Lo que yo haría es [explicación]. ¿Eso se alinea con lo que tenían en mente?"

Lo que NO debes hacer:
- No des respuestas de una sola palabra o muy cortantes
- No seas excesivamente formal o corporativo
- No suenes como un asistente virtual genérico
- No uses frases como "como modelo de lenguaje" o "como IA"
- No repitas exactamente lo que te dijeron, agrega valor

Recuerda: Eres un PM real con experiencia real. Habla como tal.`;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let botId = null;
  let conversationHistory = []; // Para mantener contexto

  // Función para generar audio con ElevenLabs
  async function generateElevenLabsAudio(text) {
    try {
      console.log('🎙️ Generando audio con ElevenLabs...');
      console.log(`📝 Texto: "${text}"`);

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2', // Soporta español argentino
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ElevenLabs error: ${response.status} - ${error}`);
      }

      // ElevenLabs devuelve MP3 directamente
      const audioBuffer = await response.arrayBuffer();
      const mp3Base64 = Buffer.from(audioBuffer).toString('base64');

      console.log(`✅ Audio generado: ${mp3Base64.length} caracteres en base64`);
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
      console.log(`📍 URL: https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/output_audio/`);
      
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

      if (response.ok) {
        console.log('✅ Audio MP3 enviado exitosamente al bot');
      } else {
        const error = await response.text();
        console.error('❌ Error enviando audio al bot:', response.status, error);
      }
    } catch (error) {
      console.error('❌ Error en sendAudioToBot:', error.message);
    }
  }

  // Función para obtener respuesta de GPT-4
  async function getGPT4Response(userMessage) {
    try {
      console.log('🤖 Obteniendo respuesta de GPT-4...');

      // Agregar mensaje del usuario al historial
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
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: ALEX_PROFILE
            },
            ...conversationHistory
          ],
          temperature: 0.9,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message.content;

      // Agregar respuesta al historial
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Mantener solo los últimos 10 mensajes para no exceder límites
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }

      console.log('🎯 Respuesta de GPT-4:', assistantMessage);
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

      // 1. Obtener respuesta de texto de GPT-4
      const responseText = await getGPT4Response(text);

      // 2. Generar audio con ElevenLabs
      const audioBase64 = await generateElevenLabsAudio(responseText);

      // 3. Enviar audio al bot
      await sendAudioToBot(audioBase64);

      console.log('✅ Proceso completo: texto → audio → enviado');

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
      console.log(`   🤖 Bot ID: ${botId}`);

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
