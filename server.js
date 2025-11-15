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

wss.on('connection', function connection(ws_client, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;
  let openaiWs = null;

  // Función para inicializar conexión con OpenAI
  function initOpenAI() {
    console.log('\n🤖 Iniciando sesión con OpenAI Realtime API...');
    
    openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    openaiWs.on('open', () => {
      console.log('✅ Conexión con OpenAI establecida');
      
      // Configurar sesión inicial
      const sessionConfig = {
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
      
      openaiWs.send(JSON.stringify(sessionConfig));
      console.log('📤 Perfil de Alex enviado a OpenAI');
    });

    openaiWs.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        
        // Filtrar solo respuestas de texto
        if (event.type === 'response.text.delta') {
          console.log('💬 Alex (parcial):', event.delta);
        }
        
        if (event.type === 'response.text.done') {
          console.log('✅ Alex (completo):', event.text);
        }

        if (event.type === 'response.done') {
          const response = event.response;
          if (response.output && response.output.length > 0) {
            const content = response.output[0].content;
            if (content && content.length > 0) {
              const text = content[0].text;
              console.log('\n🎯 RESPUESTA FINAL DE ALEX:', text);
            }
          }
        }

        // Log de errores
        if (event.type === 'error') {
          console.error('❌ Error de OpenAI:', event.error);
        }

      } catch (e) {
        console.error('❌ Error procesando mensaje de OpenAI:', e.message);
      }
    });

    openaiWs.on('error', (error) => {
      console.error('❌ Error en WebSocket de OpenAI:', error.message);
    });

    openaiWs.on('close', () => {
      console.log('🔌 Conexión con OpenAI cerrada');
    });
  }

  // Inicializar OpenAI al conectar
  initOpenAI();

  // Función para detectar si mencionan a Alex
  function detectAlexMention(text) {
    const lowerText = text.toLowerCase();
    return lowerText.includes('alex');
  }

  // Función para enviar mensaje a OpenAI
  function sendToOpenAI(text) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
      console.log('⚠️ OpenAI no está conectado. Reintentando...');
      initOpenAI();
      return;
    }

    console.log('\n📤 Enviando a Alex:', text);

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
    
    // Solicitar respuesta
    const responseCreate = {
      type: 'response.create'
    };
    
    openaiWs.send(JSON.stringify(responseCreate));
  }

  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;

    try {
      const fullText = currentUtterance.map(word => word.text).join(' ');
      const speaker = currentUtterance[0].speakerId;
      const speakerName = currentUtterance[0].speakerName;
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log('\n💾 PROCESANDO TRANSCRIPT COMPLETO:');
      console.log(`   👤 Speaker: ${speakerName} (${speaker})`);
      console.log(`   📝 Texto: "${fullText}"`);
      console.log(`   ⏱️  Duración: ${startTime}s - ${endTime}s`);
      console.log(`   📊 Palabras: ${currentUtterance.length}`);

      // Detectar mención de Alex
      if (detectAlexMention(fullText)) {
        console.log('🔔 ¡Alex fue mencionado! Enviando a OpenAI...');
        sendToOpenAI(fullText);
      }

      const { data, error } = await supabase
        .from('transcripts')
        .insert([
          {
            speaker_id: speaker,
            speaker_name: speakerName,
            text: fullText,
            start_time: startTime,
            end_time: endTime,
            word_count: currentUtterance.length,
            words: currentUtterance
          }
        ]);

      if (error) {
        console.error('❌ Error guardando en Supabase:', error.message);
      } else {
        console.log('✅ Transcript guardado en Supabase exitosamente');
      }

      currentUtterance = [];

    } catch (error) {
      console.error('❌ Error en processCompleteUtterance:', error.message);
    }
  }

  ws_client.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'transcript') {
        const words = data.data?.data?.words;
        const eventType = data.data?.type;

        if (words && words.length > 0 && eventType === 'transcript.data') {
          console.log(`\n📥 Recibido transcript.data con ${words.length} palabras`);

          const speakerId = words[0].speaker_id || 0;
          const speakerName = words[0].speaker_name || `Speaker ${speakerId}`;

          if (lastSpeaker !== null && lastSpeaker !== speakerId) {
            console.log(`🔄 Cambio de speaker detectado: ${lastSpeaker} → ${speakerId}`);
            console.log('   💾 Procesando transcript del speaker anterior...');
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
