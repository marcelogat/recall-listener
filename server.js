const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

const SILENCE_TIMEOUT = 3000;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;

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

      // Verificar si mencionan a "Alex"
      if (fullText.toLowerCase().includes('alex')) {
        console.log('\n🔔 ¡ALEX FUE MENCIONADO!');
        console.log(`📝 Texto completo: "${fullText}"`);
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

      // Solo procesar mensajes de transcript
      if (eventType === 'transcript.data' || eventType === 'transcript.partial_data') {
        
        // ✅ LA ESTRUCTURA CORRECTA ES: data.data.words
        const words = data.data?.data?.words || [];
        const participant = data.data?.data?.participant;
        
        if (!words || words.length === 0) {
          return;
        }

        const speakerId = participant?.id || 'unknown';
        const speakerName = participant?.name || `Speaker ${speakerId}`;

        console.log(`\n📝 [${speakerName}] Recibidas ${words.length} palabras`);
        console.log(`   Texto: ${words.map(w => w.text).join(' ')}`);

        // Si cambió el speaker, procesar lo anterior
        if (lastSpeaker !== null && lastSpeaker !== speakerId) {
          console.log(`🔄 Cambio de speaker detectado`);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          await processCompleteUtterance();
        }

        // Agregar palabras - SOLO si es transcript.data (completo)
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
