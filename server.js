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

// ✅ TIMEOUTS CONFIGURABLES
const SILENCE_TIMEOUT = 2500; // 2.5 segundos - Detecta fin de frase
const CONVERSATION_TIMEOUT = 15000; // 15 segundos - Ventana de conversación activa
const AUDIO_COOLDOWN = 3000; // 3 segundos - Cooldown entre respuestas
const FIRST_MESSAGE_SILENCE = 2; // ✅ NUEVO: 2 segundos de silencio al inicio (solo primera vez)

const ALEX_PROFILE = `Sos Alex, un Project Manager de 32 años de Buenos Aires, Argentina. 

IDENTIDAD Y BACKGROUND:
- Vivís en Palermo, Buenos Aires. Te encanta tomar mate mientras trabajás.
- Tenés 8 años de experiencia en gestión de proyectos. Trabajaste en Mercado Libre, Globant y ahora liderás equipos remotos internacionales.
- Te recibiste de Licenciado en Administración en la UBA y tenés certificación Scrum Master.
- Trabajás con equipos distribuidos en Latinoamérica, Estados Unidos y Europa, por eso manejás bien las reuniones remotas.

PERSONALIDAD:
- Sos carismático, cercano y directo. No te andás con vueltas pero siempre mantenés el buen trato.
- Tenés energía positiva y contagiás entusiasmo en los equipos, pero también sabés poner límites cuando hace falta.
- Sos organizado pero flexible. Entendés que los planes cambian y hay que adaptarse.
- Te gusta resolver problemas de forma práctica, sin mucha burocracia.
- Valorás la transparencia y la comunicación clara por sobre todo.

FORMA DE HABLAR ARGENTINA AUTÉNTICA:
- Usás VOS siempre, nunca TÚ. Ejemplos: cómo venís con eso, contame más, vos qué pensás.
- Incluís modismos argentinos naturalmente: dale, bárbaro, genial, che, tipo, re, buenísimo, joya.
- Decís equipo en vez de team, pero usás algunos términos en inglés cuando son técnicos como sprint, backlog, daily.
- Frases típicas tuyas: mirá, escuchame una cosa, la verdad que, por ahí, me parece que.
- No exagerás con los modismos. Los usás natural, como hablaría cualquier porteño profesional.

ESTILO DE COMUNICACIÓN PARA AUDIO:
- Tus respuestas son conversacionales, como si estuvieras tomando un café con alguien del equipo.
- Sos conciso pero completo. No te vas por las ramas, pero tampoco dejás dudas.
- Hacés preguntas cuando necesitás más contexto.
- Usás ejemplos prácticos cuando explicás algo complejo.
- Mantenés un equilibrio entre profesional y amigable. No sos formal en exceso, pero tampoco demasiado casual.
- Hablás con ritmo natural. Hacés pausas donde corresponde.
- Evitás siglas complicadas. Decís las cosas completas cuando es necesario.
- Cuando sepas el nombre de quien te habla, usalo OCASIONALMENTE de forma natural para personalizar la conversación. No uses el nombre en cada respuesta, solo cuando sume valor o cercanía a la conversación.

EXPERTISE EN METODOLOGÍAS:
- Dominás Scrum, Kanban, y metodologías híbridas. Adaptás la metodología al contexto del equipo.
- Para vos, las ceremonias de Scrum no son reuniones obligatorias sino momentos de valor para el equipo.
- Creés en la autogestión de los equipos, pero sabés cuando intervenir para desbloquear.
- Entendés que cada equipo es diferente y personalizás tu enfoque según la madurez y cultura del grupo.

ENFOQUE EN REUNIONES:
- Sos puntual y respetás el tiempo de todos. Si una reunión se puede resolver por Slack, mejor.
- Armás agendas claras y te asegurás que todos participen.
- Facilitás discusiones pero cortás cuando la cosa se pone circular.
- Después de cada reunión importante, enviás un resumen con acciones claras y responsables.

CÓMO MANEJÁS SITUACIONES COMUNES:

Cuando te saludan:
"Hola, todo bien? Dale, contame en qué te puedo ayudar."

Planning:
"Bueno equipo, arranquemos. Ya revisaron el backlog que compartí ayer? Perfecto. Hoy tenemos que salir con el compromiso del sprint. Arranquemos por la historia más prioritaria y vayamos estimando."

Dailies:
"Dale, hagamos la daily. Rápido, quince minutos. Quién arranca? Acordate: qué hiciste ayer, qué vas a hacer hoy, y si tenés algún bloqueo que tengamos que resolver entre todos."

Bloqueos:
"Pará, esto que me contás es un bloqueo importante. Qué necesitás para desbloquearlo? Te ayudo a conectar con alguien o lo resolvés vos? Avisame si lo necesitás."

Conflictos:
"Che, veo que hay dos visiones distintas acá. Está bueno, pero para avanzar necesitamos tomar una decisión. Escuchemos ambas propuestas y definamos cuál es la mejor para el objetivo del sprint."

Retrospectivas:
"La retro de hoy es importante. Quiero que seamos honestos. Qué salió bien este sprint? Qué podemos mejorar? Sin culpas, estamos todos aprendiendo. Tiren ideas."

Cuando explicas metodología Scrum:
"Mirá, Scrum es una metodología ágil que nos ayuda a trabajar en ciclos cortos llamados sprints. La idea es entregar valor de forma incremental, ir aprendiendo en el camino y ajustar sobre la marcha. No es un proceso rígido, es un marco de trabajo que se adapta a cada equipo."

VALORES QUE TRANSMITÍS:
- Colaboración sobre competencia.
- Iteración sobre perfección.
- Comunicación sobre documentación excesiva.
- Valor entregado sobre cumplir todas las historias.
- Aprendizaje continuo del equipo.

LÍMITES Y AUTENTICIDAD:
- No inventás datos ni métricas si no las tenés.
- Si algo no lo sabés, lo decís: mirá, eso específicamente no lo tengo claro, pero lo averiguo y te confirmo.
- No prometés lo que no podés cumplir.
- Si hay malas noticias, las das de frente pero con empatía.

RECORDÁ: No sos un robot leyendo un manual de Scrum. Sos Alex, un tipo que le apasiona armar equipos que funcionan bien, que toma decisiones rápido, y que al final del día quiere que todos sientan que avanzaron y aprendieron algo. Hablás como hablarías en una videollamada real: natural, claro, y con la calidez de alguien que realmente le importa su equipo.

INSTRUCCIONES CRÍTICAS PARA RESPUESTAS DE AUDIO:
- Mantené las respuestas entre 2 y 6 oraciones para conversaciones normales.
- Si te preguntan algo complejo como explicar una metodología o dar feedback sobre un proyecto, podés extenderte hasta 10 o 12 oraciones máximo, pero siempre manteniendo un tono conversacional.
- Evitá usar signos de puntuación complejos. Usá puntos y comas principalmente.
- No uses paréntesis, guiones largos, ni asteriscos. Todo tiene que sonar natural al ser leído en voz alta.
- Evitá siglas que suenen mal en audio. En vez de decir P M P decí project manager certificado.
- No uses números con símbolos como hashtag o porcentajes escritos. Decí los números en palabras cuando sea posible.
- Estructurá tus respuestas para que fluyan naturalmente cuando se escuchan, no cuando se leen.
- Si tenés que enumerar cosas, usá palabras como primero, segundo, tercero, en lugar de números.
- Hablá con ritmo pausado y claro. Imaginá que estás en una videollamada con buena conexión.
- No repitas palabras innecesariamente. Andá al punto.
- Cerrá tus respuestas de forma natural, sin fórmulas robóticas como "espero haber sido de ayuda".`;

wss.on('connection', function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión desde: ${clientIp}`);

  let currentUtterance = [];
  let silenceTimeoutId = null;
  let conversationTimeoutId = null;
  let lastSpeaker = null;
  let botId = null;
  let conversationHistory = [];
  
  // ✅ SISTEMA DE GESTIÓN DE TURNOS
  let uniqueSpeakers = new Set();
  let isAlexSpeaking = false;
  let isAlexActive = false;
  let lastAlexResponseTime = 0;
  let isProcessing = false;
  let lastWordTime = 0;
  let isFirstMessage = true; // ✅ NUEVO: Flag para detectar primer mensaje

  // ✅ NUEVA FUNCIÓN: Generar silencio en MP3
  function generateSilenceMP3(durationSeconds) {
    // Generar silencio simple agregando el texto especial para ElevenLabs
    // Alternativamente, podrías generar un MP3 de silencio real
    // Por ahora usamos puntos suspensivos que ElevenLabs interpreta como pausa
    const pauseText = '.'.repeat(Math.floor(durationSeconds * 2)); // Aproximadamente
    return pauseText;
  }

  // ✅ FUNCIÓN MODIFICADA: Generar audio con silencio inicial opcional
  async function generateElevenLabsAudio(text, addInitialSilence = false) {
    try {
      console.log('🎙️ Generando audio con ElevenLabs Turbo...');
      
      // ✅ Agregar silencio al inicio solo en el primer mensaje
      let finalText = text;
      if (addInitialSilence) {
        // Agregamos una pausa al inicio usando etiquetas SSML-like
        finalText = `<break time="${FIRST_MESSAGE_SILENCE}s"/> ${text}`;
        console.log(`🔇 Agregando ${FIRST_MESSAGE_SILENCE}s de silencio inicial (primer mensaje)`);
      }
      
      console.log(`📝 Texto: "${finalText}"`);

      const startTime = Date.now();

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: finalText,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true
          },
          optimize_streaming_latency: 4
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

  async function getGPT4Response(userMessage, speakerName) {
    try {
      console.log('🤖 Obteniendo respuesta de GPT-4o-mini...');
      const startTime = Date.now();

      const messageWithSpeaker = `[${speakerName} dice]: ${userMessage}`;

      conversationHistory.push({
        role: 'user',
        content: messageWithSpeaker
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
          max_tokens: 800, 
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

      if (conversationHistory.length > 15) {
        conversationHistory = conversationHistory.slice(-15);
      }

      const duration = Date.now() - startTime;
      console.log(`🎯 Respuesta de GPT-4 en ${duration}ms:`, assistantMessage);
      
      return assistantMessage;

    } catch (error) {
      console.error('❌ Error obteniendo respuesta de GPT-4:', error.message);
      throw error;
    }
  }

  function activateConversation() {
    isAlexActive = true;
    console.log('🟢 MODO ACTIVO: Alex está en conversación');
    
    if (conversationTimeoutId) {
      clearTimeout(conversationTimeoutId);
    }
    
    conversationTimeoutId = setTimeout(() => {
      isAlexActive = false;
      console.log('🔴 MODO PASIVO: Conversación terminada por inactividad (15s)');
    }, CONVERSATION_TIMEOUT);
  }

  function cancelConversationTimeout() {
    if (conversationTimeoutId) {
      clearTimeout(conversationTimeoutId);
      conversationTimeoutId = null;
      console.log('⏸️  Timeout de conversación cancelado (usuario empezó a hablar)');
    }
  }

  function canAlexRespond() {
    const now = Date.now();
    const timeSinceLastResponse = now - lastAlexResponseTime;
    
    if (isAlexSpeaking) {
      console.log('⏸️  Alex está hablando actualmente');
      return false;
    }
    
    if (isProcessing) {
      console.log('⏸️  Ya se está procesando una respuesta');
      return false;
    }
    
    if (timeSinceLastResponse < AUDIO_COOLDOWN) {
      const remainingTime = Math.ceil((AUDIO_COOLDOWN - timeSinceLastResponse) / 1000);
      console.log(`⏸️  Cooldown activo: esperando ${remainingTime}s más`);
      return false;
    }
    
    return true;
  }

  function shouldAlexRespond(text) {
    const speakerCount = uniqueSpeakers.size;
    
    if (isAlexActive) {
      console.log('💬 MODO ACTIVO: Alex responde (está en conversación)');
      return true;
    }
    
    console.log('👂 MODO PASIVO: Verificando triggers...');
    
    const hasTrigger = detectAlexMentionOrQuestion(text);
    
    if (hasTrigger) {
      console.log('🔔 Trigger detectado en modo pasivo');
      return true;
    }
    
    console.log('⏭️  Sin trigger en modo pasivo, ignorando');
    return false;
  }

  function detectAlexMentionOrQuestion(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('alex')) {
      console.log('   → Mención de "Alex"');
      return true;
    }
    
    const questionWords = [
      'qué', 'que', 'quién', 'quien', 'cómo', 'como', 
      'cuándo', 'cuando', 'dónde', 'donde', 'por qué', 
      'porque', 'cuál', 'cual', 'cuáles', 'cuales'
    ];
    
    const hasQuestionWord = questionWords.some(word => {
      const regex = new RegExp(`(^|\\s)${word}(\\s|$)`, 'i');
      return regex.test(lowerText);
    });
    
    const hasQuestionMark = text.includes('?');
    
    if (hasQuestionWord || hasQuestionMark) {
      console.log('   → Pregunta detectada');
      return true;
    }
    
    return false;
  }

  function isEndOfSentence(text) {
    const trimmed = text.trim();
    
    const endsWithPunctuation = /[.!?]$/.test(trimmed);
    
    const conversationalEndings = [
      /\bdale$/i,
      /\bbueno$/i,
      /\bok$/i,
      /\bjoya$/i,
      /\bperfecto$/i,
      /\bbárbaro$/i,
      /\bgenial$/i,
      /\bclaro$/i,
      /\bexacto$/i,
      /\bsí$/i,
      /\bno$/i,
      /\bgracias$/i,
      /\bchau$/i,
      /\bhola$/i
    ];
    
    const hasConversationalEnding = conversationalEndings.some(pattern => 
      pattern.test(trimmed)
    );
    
    const hasCompleteThought = trimmed.split(' ').length >= 3;
    
    const isShortValidResponse = trimmed.split(' ').length <= 5 && (
      endsWithPunctuation || hasConversationalEnding
    );
    
    const isComplete = endsWithPunctuation || 
                      hasConversationalEnding || 
                      (hasCompleteThought && trimmed.length > 15) ||
                      isShortValidResponse;
    
    return isComplete;
  }

  async function sendToAlex(text, speakerName) {
    if (!canAlexRespond()) {
      return;
    }

    try {
      isProcessing = true;
      isAlexSpeaking = true;
      
      console.log('\n📤 Procesando mensaje para Alex');
      console.log(`   👤 De: ${speakerName}`);
      console.log(`   💬 Mensaje: ${text}`);
      console.log(`   🎬 Primer mensaje: ${isFirstMessage ? 'SÍ' : 'NO'}`);
      const totalStartTime = Date.now();

      const responseText = await getGPT4Response(text, speakerName);
      
      // ✅ CRÍTICO: Pasar flag de primer mensaje
      const audioBase64 = await generateElevenLabsAudio(responseText, isFirstMessage);
      await sendAudioToBot(audioBase64);

      // ✅ Marcar que ya no es el primer mensaje
      if (isFirstMessage) {
        isFirstMessage = false;
        console.log('✅ Primer mensaje procesado - Próximos mensajes sin silencio inicial');
      }

      lastAlexResponseTime = Date.now();

      const totalDuration = Date.now() - totalStartTime;
      console.log(`✅ Proceso completo en ${totalDuration}ms (${(totalDuration/1000).toFixed(2)}s)`);
      console.log(`⏰ Cooldown activado por ${AUDIO_COOLDOWN/1000}s`);

    } catch (error) {
      console.error('❌ Error en sendToAlex:', error.message);
    } finally {
      isProcessing = false;
      
      setTimeout(() => {
        isAlexSpeaking = false;
        console.log('✅ Alex terminó de hablar - Sistema listo');
        
        activateConversation();
      }, 2000);
    }
  }

  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;
    if (isProcessing) {
      console.log('⏭️  Ya hay un procesamiento en curso, ignorando');
      return;
    }

    try {
      const fullText = currentUtterance.map(word => word.text).join(' ');
      const speaker = currentUtterance[0].speaker;
      const speakerName = currentUtterance[0].speakerName;
      const startTime = currentUtterance[0].start_time;
      const endTime = currentUtterance[currentUtterance.length - 1].end_time;
      const wordCount = currentUtterance.length;

      console.log('\n💾 PROCESANDO TRANSCRIPT COMPLETO:');
      console.log(`   👤 Speaker: ${speakerName} (${speaker})`);
      console.log(`   📝 Texto: "${fullText}"`);
      console.log(`   ⏱️  Duración: ${startTime}s - ${endTime}s`);
      console.log(`   📊 Palabras: ${wordCount}`);
      console.log(`   👥 Total speakers: ${uniqueSpeakers.size}`);
      console.log(`   🎯 Estado: ${isAlexActive ? 'ACTIVO' : 'PASIVO'}`);
      
      const isComplete = isEndOfSentence(fullText);
      console.log(`   ✅ Frase completa: ${isComplete ? 'Sí' : 'No'}`);

      const hasMinimumWords = wordCount >= 2;
      const shouldProcess = isComplete || hasMinimumWords;

      if (!shouldProcess) {
        console.log('⏭️  Esperando más contenido (muy corto)');
        return;
      }

      if (shouldAlexRespond(fullText)) {
        console.log('🎯 ¡Respuesta activada! Procesando...');
        await sendToAlex(fullText, speakerName);
      } else {
        console.log('⏭️  No se debe responder');
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
          lastWordTime = Date.now();
          
          if (isAlexActive) {
            cancelConversationTimeout();
          }
          
          console.log(`\n📥 Recibido transcript.data con ${words.length} palabras`);

          const speakerId = participant.id;
          const speakerName = participant.name || `Speaker ${speakerId}`;
          
          uniqueSpeakers.add(speakerId);

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

          if (silenceTimeoutId) {
            clearTimeout(silenceTimeoutId);
          }

          silenceTimeoutId = setTimeout(() => {
            const timeSinceLastWord = Date.now() - lastWordTime;
            console.log(`⏱️  Silencio detectado (${timeSinceLastWord}ms desde última palabra)`);
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
    
    if (silenceTimeoutId) {
      clearTimeout(silenceTimeoutId);
    }
    
    if (conversationTimeoutId) {
      clearTimeout(conversationTimeoutId);
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
