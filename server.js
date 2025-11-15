const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

const SILENCE_TIMEOUT = 3000;

// Perfil de Alex
const ALEX_PROFILE = `Eres Alex, un project manager experto que vive en Buenos Aires, Argentina. 
Tienes 32 años y amplia experiencia trabajando en empresas internacionales.
Tu rol es asistir en reuniones cuando te mencionen por nombre.`;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let openaiWs = null;
  let openaiReady = false;

  // Función para inicializar conexión con OpenAI (NO BLOQUEANTE)
  function initOpenAI() {
    if (!OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY no configurada');
      return;
    }

    setTimeout(() => {
      try {
        console.log('\n🤖 Iniciando sesión con OpenAI Realtime API...');
        
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
                modalities: ['text'],
                instructions: ALEX_PROFILE,
                voice: 'alloy',
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                turn_detection: null
              }
            };
            
            openaiWs.send(JSON.stringify(sessionUpdate));
            console.log('📋 Perfil de Alex enviado a OpenAI');
            openaiReady = true;
          } catch (e) {
            console.error('❌ Error enviando configuración a OpenAI:', e.message);
          }
        });

        openaiWs.on('message', function(message) {
          try {
            const event = JSON.parse(message);
            
            if (event.type === 'response.text.delta') {
              console.log(`🤖 ALEX: ${event.delta}`);
            } else if (event.type === 'response.text.done') {
              console.log(`\n✅ ALEX terminó: ${event.text}`);
            } else if (event.type === 'response.done') {
              console.log(`✅ Respuesta completa`);
            } else {
              console.log(`📨 OpenAI: ${event.type}`);
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
    }, 100); // Ejecutar después de 100ms, sin bloquear
  }

  // Iniciar OpenAI en background
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

      // Verificar si mencionan a "Alex" (case insensitive)
      if (fullText.toLowerCase().includes('alex')) {
        console.log('\n🔔 ¡ALEX FUE MENCIONADO!');
        
        if (openaiReady && openaiWs && openaiWs.readyState === WebSocket.OPEN) {
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
              type: 'response.create'
            };
            
            openaiWs.send(JSON.stringify(responseCreate));
            
            console.log(`📤 Texto enviado a OpenAI: "${fullText}"`);
          } catch (e) {
            console.error('❌ Error enviando a OpenAI:', e.message);
          }
        } else {
          console.log(`⚠️  OpenAI no está listo (ready: ${openaiReady}, state: ${openaiWs?.readyState})`);
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

  ws.on('message', async function incoming(message) {
    try {
      let data;
      try {
        data = JSON.parse(message);
      } catch (parseError) {
        console.log('⚠️  Mensaje no-JSON recibido');
        return;
      }

      const eventType = data.event;

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

  ws.on('close', async function close(code, reason) {
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
