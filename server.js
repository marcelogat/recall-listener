const ws = require('ws');
const WebSocket = ws.WebSocket || ws;
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const OPENAI_WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

const wss = new ws.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

const SILENCE_TIMEOUT = 3000;

const ALEX_PROFILE = `Eres Alex, un project manager experto que vive en Buenos Aires, Argentina. 
Tienes 32 años y amplia experiencia trabajando en empresas internacionales.
Tu rol es asistir en reuniones cuando te mencionen por nombre.
Responde de forma breve y concisa, como en una conversación normal.`;

wss.on('connection', function connection(ws_client, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let openaiWs = null;
  let openaiReady = false;
  let audioBuffer = [];
  let ACTIVE_BOT_ID = null;

  function initOpenAI() {
    if (!OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY no configurada - OpenAI deshabilitado');
      return;
    }

    console.log('\n🤖 Iniciando sesión con OpenAI Realtime API...');
    
    try {
      openaiWs = new WebSocket(OPENAI_WS_URL, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      openaiWs.on('open', function() {
        console.log('✅ Conectado a OpenAI Realtime API');
        
        try {
          const sessionUpdate = {
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: ALEX_PROFILE,
              voice: 'alloy',
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              turn_detection: null,
              temperature: 0.8
            }
          };
          
          openaiWs.send(JSON.stringify(sessionUpdate));
          console.log('📋 Perfil de Alex enviado a OpenAI (con audio habilitado)');
          openaiReady = true;
        } catch (e) {
          console.error('❌ Error enviando configuración a OpenAI:', e.message);
        }
      });

      openaiWs.on('message', function(message) {
        try {
          const event = JSON.parse(message);
          
          if (event.type === 'response.text.delta') {
            console.log(`🤖 ALEX (texto): ${event.delta}`);
          } else if (event.type === 'response.text.done') {
            console.log(`\n✅ ALEX terminó de escribir: ${event.text}`);
          }
          
          else if (event.type === 'response.audio.delta') {
            console.log(`🔊 Recibiendo chunk de audio de OpenAI`);
            audioBuffer.push(Buffer.from(event.delta, 'base64'));
          } else if (event.type === 'response.audio.done') {
            console.log(`✅ Audio completo recibido de OpenAI`);
            const fullAudio = Buffer.concat(audioBuffer);
            audioBuffer = [];
            sendAudioToRecall(fullAudio);
          }
          
          else if (event.type === 'response.done') {
            console.log(`✅ Respuesta completa de OpenAI`);
          } else {
            console.log(`📨 OpenAI event: ${event.type}`);
          }
        } catch (e) {
          console.error('❌ Error procesando mensaje de OpenAI:', e.message);
        }
      });

      openaiWs.on('error', function(error) {
        console.error('❌ Error en OpenAI WebSocket:', error.message);
        openaiReady = false;
      });

      openaiWs.on('close', function() {
        console.log('❌ Desconectado de OpenAI');
        openaiReady = false;
      });
    } catch (error) {
      console.error('❌ Error inicializando OpenAI:', error.message);
    }
  }

  async function sendAudioToRecall(audioBuffer) {
    if (!ACTIVE_BOT_ID) {
      console.log('⚠️  No tengo bot_id todavía — no envío audio');
      return;
    }

    if (!RECALL_API_KEY) {
      console.log('⚠️  RECALL_API_KEY no configurada');
      return;
    }

    try {
      console.log(`\n🔊 Enviando audio de Alex a Recall.ai...`);
      
      const base64Audio = audioBuffer.toString('base64');

      const response = await axios.post(
        `https://us-west-2.recall.ai/api/v1/bot/${ACTIVE_BOT_ID}/output_audio/`,
        {
          kind: 'raw',
          b64_data: base64Audio
        },
        {
          headers: {
            'Authorization': `Token ${RECALL_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Audio enviado a Recall.ai (BOT: ${ACTIVE_BOT_ID})`);
    } catch (e) {
      console.error('❌ Error enviando audio a Recall:', e.response?.data || e.message);
    }
  }

  initOpenAI();

  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;

    try {
      const fullText = currentUtterance.map(word => word.text).join(' ');
      const speaker = currentUtterance[0].speaker;
      const speakerName = currentUtterance[0].speakerName;
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log('\n' + '='.repeat(80));
      console.log(`💾 GUARDANDO EN SUPABASE:`);
      console.log(`   Speaker: ${speakerName} (${speaker})`);
      console.log(`   Texto: ${fullText}`);
      console.log(`   Duración: ${startTime}s - ${endTime}s`);
      console.log('='.repeat(80));

      if (fullText.toLowerCase().includes('alex')) {
        console.log('\n🔔 ¡ALEX FUE MENCIONADO!');
        
        if (openaiReady && openaiWs && openaiWs.readyState === 1) {
          try {
            const conversationItem = {
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: fullText
                  }
                ]
              }
            };
            
            openaiWs.send(JSON.stringify(conversationItem));
            
            const responseCreate = {
              type: 'response.create',
              response: {
                modalities: ['text', 'audio'],
                instructions: 'Responde de forma natural y conversacional en español.'
              }
            };
            
            openaiWs.send(JSON.stringify(responseCreate));
            
            console.log(`📤 Texto enviado a OpenAI: "${fullText}"`);
            console.log(`🎤 Esperando respuesta en audio...`);
          } catch (e) {
            console.error('❌ Error enviando a OpenAI:', e.message);
          }
        } else {
          console.log(`⚠️  OpenAI no está listo (ready: ${openaiReady})`);
        }
      }

      const { data, error } = await supabase
        .from('transcripts')
        .insert([
          {
            speaker: speakerName,
            text: fullText,
            start_time: startTime,
            end_time: endTime,
            word_count: currentUtterance.length,
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) {
        console.error('❌ Error al guardar en Supabase:', error);
      } else {
        console.log('✅ Guardado exitosamente en Supabase');
      }

      currentUtterance = [];
      
    } catch (error) {
      console.error('❌ Error en processCompleteUtterance:', error);
    }
  }

  ws_client.on('message', async function incoming(message) {
    try {
      let data;
      try {
        data = JSON.parse(message);
      } catch (parseError) {
        console.log('⚠️  Mensaje no-JSON recibido');
        return;
      }

      const eventType = data.event;

      console.log(`\n🔍 DEBUG - Evento: ${eventType}`);
      console.log(`🔍 DEBUG - Data:`, JSON.stringify(data, null, 2));

      if (!ACTIVE_BOT_ID) {
        if (data.bot_id) {
          ACTIVE_BOT_ID = data.bot_id;
          console.log('🎯 BOT ID detectado (root):', ACTIVE_BOT_ID);
        } else if (data.data?.bot_id) {
          ACTIVE_BOT_ID = data.data.bot_id;
          console.log('🎯 BOT ID detectado (data.bot_id):', ACTIVE_BOT_ID);
        } else if (data.data?.data?.bot_id) {
          ACTIVE_BOT_ID = data.data.data.bot_id;
          console.log('🎯 BOT ID detectado (data.data.bot_id):', ACTIVE_BOT_ID);
        }
      }

      if (eventType === 'transcript.data' || eventType === 'transcript.partial_data') {
        
        const words = data.data?.data?.words || [];
        const participant = data.data?.data?.participant;
        
        if (!words || words.length === 0) {
          return;
        }

        const speakerId = participant?.id || 'unknown';
        const speakerName = participant?.name || `Speaker ${speakerId}`;

        console.log(`\n📝 [${speakerName}] Recibidas ${words.length} palabras`);
        console.log(`   Texto: ${words.map(w => w.text).join(' ')}`);

        if (lastSpeaker !== null && lastSpeaker !== speakerId) {
          console.log(`🔄 Cambio de speaker detectado`);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          await processCompleteUtterance();
        }

        if (eventType === 'transcript.data') {
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
        } else {
          console.log(`   ⏭️  Ignorando partial_data (esperando transcript.data completo)`);
        }
      }
      
    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message);
    }
  });

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
    clearInterval(p
