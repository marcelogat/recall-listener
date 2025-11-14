const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

// Constantes
const SILENCE_TIMEOUT = 3000;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  // Variables de estado
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
        console.log('✅ Guardado exitosamente:', data);
      }

      currentUtterance = [];
      
    } catch (error) {
      console.error('❌ Error en processCompleteUtterance:', error);
    }
  }

  ws.on('message', async function incoming(message) {
    try {
      // Intentar parsear como JSON
      let data;
      try {
        data = JSON.parse(message);
      } catch (parseError) {
        // Si no es JSON válido, solo log y continuar
        console.log('⚠️  Mensaje no-JSON recibido (ignorando)');
        return;
      }

      // Log para debug
      console.log('📨 Tipo de mensaje:', data.type || 'desconocido');

      // Ignorar mensajes de configuración
      if (data.type === 'bot_ready' || 
          data.type === 'bot_started' || 
          data.type === 'transcript_end' ||
          data.type === 'bot_status') {
        console.log(`ℹ️  Mensaje de sistema: ${data.type}`);
        return;
      }

      // Procesar solo mensajes de transcript
      if (data.type === 'transcript') {
        
        // Validar que tenga words
        if (!data.words || !Array.isArray(data.words) || data.words.length === 0) {
          console.log('⚠️  Mensaje de transcript sin palabras (ignorando)');
          return;
        }

        const currentSpeaker = data.speaker || 'unknown';

        console.log(`\n📝 [${currentSpeaker}] Recibidas ${data.words.length} palabras`);

        // Si cambió el speaker, procesar lo anterior
        if (lastSpeaker !== null && lastSpeaker !== currentSpeaker) {
          console.log(`🔄 Cambio de speaker: ${lastSpeaker} → ${currentSpeaker}`);
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          await processCompleteUtterance();
        }

        // Agregar nuevas palabras
        data.words.forEach(word => {
          const text = word.text || word.word || '';
          if (text.trim()) { // Solo agregar palabras no vacías
            currentUtterance.push({
              text: text,
              speaker: currentSpeaker,
              start_time: word.start_time || word.start || 0,
              end_time: word.end_time || word.end || 0
            });
          }
        });

        lastSpeaker = currentSpeaker;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
          processCompleteUtterance();
        }, SILENCE_TIMEOUT);

        const previewText = currentUtterance.slice(-10).map(w => w.text).join(' ');
        console.log(`   Preview: ...${previewText}`);
        console.log(`   Total palabras: ${currentUtterance.length}`);
      }
      
    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message);
      // NO cerrar la conexión, solo continuar
    }
  });

  ws.on('close', async function close(code, reason) {
    console.log(`\n❌ Conexión cerrada desde: ${clientIp}`);
    console.log(`   Código: ${code}`);
    console.log(`   Razón: ${reason || 'No especificada'}`);
    
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
    // NO cerrar la conexión automáticamente
  });

  // Enviar un ping cada 30 segundos para mantener la conexión viva
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
