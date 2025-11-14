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
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;

      console.log('\n' + '='.repeat(80));
      console.log(`💾 GUARDANDO EN SUPABASE:`);
      console.log(`   Speaker: ${speaker}`);
      console.log(`   Texto: ${fullText}`);
      console.log(`   Duración: ${startTime}s - ${endTime}s`);
      console.log('='.repeat(80));

      const { data, error } = await supabase
        .from('transcripts')
        .insert([
          {
            speaker: speaker,
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
        console.log('✅ Guardado exitosamente');
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

      // 🔍 DEBUG: MOSTRAR TODO EL MENSAJE
      console.log('\n' + '🔍'.repeat(40));
      console.log('📨 MENSAJE COMPLETO RECIBIDO:');
      console.log(JSON.stringify(data, null, 2));
      console.log('🔍'.repeat(40) + '\n');

      // Verificar diferentes estructuras posibles
      const messageType = data.type || data.event || data.message_type || 'desconocido';
      console.log(`📝 Tipo detectado: ${messageType}`);

      // Intentar encontrar las palabras en diferentes ubicaciones
      const words = data.words || data.transcript?.words || data.data?.words || [];
      const speaker = data.speaker || data.transcript?.speaker || data.data?.speaker || 'unknown';

      if (words && words.length > 0) {
        console.log(`\n✅ PALABRAS ENCONTRADAS!`);
        console.log(`   Speaker: ${speaker}`);
        console.log(`   Cantidad: ${words.length}`);
        console.log(`   Palabras:`, words.map(w => w.text || w.word || '').join(' '));

        // Si cambió el speaker, procesar
        if (lastSpeaker !== null && lastSpeaker !== speaker) {
          console.log(`🔄 Cambio de speaker: ${lastSpeaker} → ${speaker}`);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          await processCompleteUtterance();
        }

        // Agregar palabras
        words.forEach(word => {
          const text = word.text || word.word || '';
          if (text.trim()) {
            currentUtterance.push({
              text: text,
              speaker: speaker,
              start_time: word.start_time || word.start || 0,
              end_time: word.end_time || word.end || 0
            });
          }
        });

        lastSpeaker = speaker;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
          processCompleteUtterance();
        }, SILENCE_TIMEOUT);

        console.log(`   Total acumulado: ${currentUtterance.length} palabras`);
      } else {
        console.log(`⚠️  No se encontraron palabras en este mensaje`);
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
      console.log('🏓 Ping enviado');
    }
  }, 30000);

  ws.on('pong', () => {
    console.log('🏓 Pong recibido');
  });

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
