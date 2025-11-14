const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

// Constantes
const SILENCE_TIMEOUT = 3000; // 3 segundos de silencio

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  // Variables de estado para ESTA conexión
  let currentUtterance = [];
  let timeoutId = null;
  let lastSpeaker = null;

  // ✅ FUNCIÓN DENTRO DEL SCOPE CORRECTO
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

      // Insertar en Supabase
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
      const data = JSON.parse(message);
      
      if (data.type === 'bot_config' || data.type === 'config') {
        console.log('⚙️  Configuración del bot recibida');
        return;
      }

      if (data.type === 'transcript' && data.words && Array.isArray(data.words)) {
        const currentSpeaker = data.speaker || data.words[0]?.speaker || 'unknown';

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
          currentUtterance.push({
            text: word.text || word.word || '',
            speaker: currentSpeaker,
            start_time: word.start_time || word.start || 0,
            end_time: word.end_time || word.end || 0
          });
        });

        lastSpeaker = currentSpeaker;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // ✅ TIMEOUT CORREGIDO
        timeoutId = setTimeout(() => {
          processCompleteUtterance();
        }, SILENCE_TIMEOUT);

        const previewText = currentUtterance.slice(-10).map(w => w.text).join(' ');
        console.log(`   Preview: ...${previewText}`);
        console.log(`   Total palabras: ${currentUtterance.length}`);
      }
      
    } catch (e) {
      if (message.toString().includes('error')) {
        console.error('❌ Error recibido:', message.toString());
      }
    }
  });

  ws.on('close', async function close() {
    console.log(`\n❌ Conexión cerrada desde: ${clientIp}`);
    
    if (currentUtterance.length > 0) {
      console.log('💾 Procesando transcript pendiente...');
      await processCompleteUtterance();
    }
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  ws.on('error', function error(err) {
    console.error('❌ Error en WebSocket:', err);
  });
});

process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promesa rechazada:', reason);
});

console.log('\n📡 Esperando conexiones de Recall.ai...\n');
