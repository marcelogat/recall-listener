const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en el puerto 8080');

// ✅ FUNCIÓN PARA CARGAR AGENTE ACTIVO DESDE LA BASE DE DATOS
async function loadActiveAgent(agentName = null) {
  try {
    console.log('📥 Cargando configuración del agente desde la base de datos...');

    let query = supabase
      .from('agents')
      .select(`
        *,
        agent_voice_config (*)
      `)
      .eq('is_active', true);

    // Si se especifica un nombre, buscar ese agente
    // Si no, buscar el agente por defecto
    if (agentName) {
      query = query.eq('name', agentName.toLowerCase());
      console.log(`   🔍 Buscando agente: ${agentName}`);
    } else {
      query = query.eq('is_default', true);
      console.log('   🔍 Buscando agente por defecto');
    }

    const { data: agent, error } = await query.single();

    if (error || !agent) {
      console.error('❌ Error cargando agente:', error);
      throw new Error(`No se pudo cargar el agente${agentName ? ` "${agentName}"` : ' por defecto'}`);
    }

    // Validar que tenga configuración de voz
    if (!agent.agent_voice_config || agent.agent_voice_config.length === 0) {
      throw new Error(`El agente ${agent.name} no tiene configuración de voz`);
    }

    const voiceConfig = agent.agent_voice_config.find(v => v.is_active);

    if (!voiceConfig) {
      throw new Error(`El agente ${agent.name} no tiene una voz activa`);
    }

    console.log(`✅ Agente cargado exitosamente:`);
    console.log(`   👤 Nombre: ${agent.display_name}`);
    console.log(`   🎭 Tipo: ${agent.agent_type}`);
    console.log(`   🗣️  Voz: ${voiceConfig.voice_name}`);
    console.log(`   🌍 Idioma: ${agent.language}`);
    console.log(`   📍 Ubicación: ${agent.city}, ${agent.country}`);
    console.log(`   🤖 Modelo LLM: ${agent.llm_model}`);
    console.log(`   ⏱️  Timeouts: silence=${agent.silence_timeout_ms}ms, conversation=${agent.conversation_timeout_ms}ms`);

    return {
      agent,
      voiceConfig
    };

  } catch (error) {
    console.error('❌ Error en loadActiveAgent:', error.message);
    throw error;
  }
}

wss.on('connection', async function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n✅ Nueva conexión WebSocket desde: ${clientIp}`);

  // ✅ CARGAR AGENTE DESDE LA BASE DE DATOS
  let agentConfig;
  try {
    // Puedes pasar el nombre del agente como query param: ws://localhost:8080?agent=sofia
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentName = url.searchParams.get('agent');
    
    agentConfig = await loadActiveAgent(agentName);
  } catch (error) {
    console.error('❌ No se pudo cargar el agente, cerrando conexión');
    ws.close(1011, 'No se pudo cargar configuración del agente');
    return;
  }

  const { agent, voiceConfig } = agentConfig;

  // ✅ USAR CONFIGURACIÓN DEL AGENTE DESDE LA DB
  const AGENT_PROFILE = agent.profile_text;
  const SILENCE_TIMEOUT = agent.silence_timeout_ms;
  const CONVERSATION_TIMEOUT = agent.conversation_timeout_ms;
  const AUDIO_COOLDOWN = agent.audio_cooldown_ms;
  const FIRST_MESSAGE_SILENCE = agent.first_message_silence_seconds;
  const CONTEXT_HISTORY_LENGTH = agent.llm_context_history_length;
  
  const VOICE_ID = voiceConfig.voice_id;
  const VOICE_MODEL = voiceConfig.voice_model;
  const VOICE_SETTINGS = voiceConfig.voice_settings;

  let currentUtterance = [];
  let silenceTimeoutId = null;
  let conversationTimeoutId = null;
  let lastSpeaker = null;
  let botId = null;
  let conversationHistory = [];
  
  let uniqueSpeakers = new Set();
  let isAgentSpeaking = false;
  let isAgentActive = false;
  let lastAgentResponseTime = 0;
  let isProcessing = false;
  let lastWordTime = 0;
  let isFirstMessage = true;
  let conversationTimeoutStartTime = 0;
  let userIsCurrentlySpeaking = false;

  console.log(`\n🎙️ ${agent.display_name} está listo y escuchando...\n`);

  // ✅ FUNCIÓN: Generar audio con ElevenLabs usando config de DB
  async function generateElevenLabsAudio(text, addInitialSilence = false) {
    try {
      console.log(`🎙️ Generando audio con ${voiceConfig.voice_name}...`);
      
      let finalText = text;
      if (addInitialSilence) {
        finalText = `<break time="${FIRST_MESSAGE_SILENCE}s"/> ${text}`;
        console.log(`🔇 Agregando ${FIRST_MESSAGE_SILENCE}s de silencio inicial (primer mensaje)`);
      }
      
      console.log(`📝 Texto: "${finalText}"`);

      const startTime = Date.now();

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: finalText,
          model_id: VOICE_MODEL,
          voice_settings: VOICE_SETTINGS
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

  // ✅ FUNCIÓN: Obtener respuesta de GPT usando config de DB
  async function getGPT4Response(userMessage, speakerName) {
    try {
      console.log(`🤖 Obteniendo respuesta de ${agent.llm_model}...`);
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
          model: agent.llm_model,
          messages: [
            {
              role: 'system',
              content: AGENT_PROFILE
            },
            ...conversationHistory
          ],
          temperature: agent.llm_temperature,
          max_tokens: agent.llm_max_tokens,
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

      if (conversationHistory.length > CONTEXT_HISTORY_LENGTH) {
        conversationHistory = conversationHistory.slice(-CONTEXT_HISTORY_LENGTH);
      }

      const duration = Date.now() - startTime;
      console.log(`🎯 Respuesta de ${agent.llm_model} en ${duration}ms:`, assistantMessage);
      
      return assistantMessage;

    } catch (error) {
      console.error('❌ Error obteniendo respuesta de GPT:', error.message);
      throw error;
    }
  }

  function activateConversation() {
    isAgentActive = true;
    console.log('🟢 MODO ACTIVO: Agente en conversación');
    
    if (conversationTimeoutId) {
      clearTimeout(conversationTimeoutId);
      console.log('   ⏱️  Timeout anterior cancelado');
    }
    
    conversationTimeoutStartTime = Date.now();
    
    conversationTimeoutId = setTimeout(() => {
      const elapsed = Date.now() - conversationTimeoutStartTime;
      console.log(`🔴 MODO PASIVO: Conversación terminada por inactividad (${elapsed}ms transcurridos)`);
      isAgentActive = false;
      conversationTimeoutId = null;
    }, CONVERSATION_TIMEOUT);
    
    console.log(`   ⏰ Nuevo timeout de conversación: ${CONVERSATION_TIMEOUT/1000}s`);
  }

  function cancelConversationTimeout() {
    if (conversationTimeoutId) {
      const elapsed = Date.now() - conversationTimeoutStartTime;
      clearTimeout(conversationTimeoutId);
      conversationTimeoutId = null;
      console.log(`⏸️  Timeout CANCELADO (había transcurrido ${elapsed}ms de ${CONVERSATION_TIMEOUT}ms)`);
    }
  }

  function canAgentRespond() {
    const now = Date.now();
    const timeSinceLastResponse = now - lastAgentResponseTime;
    
    if (isAgentSpeaking) {
      console.log('⏸️  El agente está hablando actualmente');
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

  function shouldAgentRespond(text) {
    if (isAgentActive) {
      console.log('💬 MODO ACTIVO: Agente responde (está en conversación)');
      return true;
    }
    
    console.log('👂 MODO PASIVO: Verificando triggers...');
    
    const hasTrigger = detectAgentMentionOrQuestion(text);
    
    if (hasTrigger) {
      console.log('🔔 Trigger detectado en modo pasivo');
      return true;
    }
    
    console.log('⏭️  Sin trigger en modo pasivo, ignorando');
    return false;
  }

  function detectAgentMentionOrQuestion(text) {
    const lowerText = text.toLowerCase();
    
    // Detectar mención del nombre del agente
    const agentNameVariations = [
      agent.name.toLowerCase(),
      agent.display_name.toLowerCase()
    ];
    
    const mentionedByName = agentNameVariations.some(name => lowerText.includes(name));
    
    if (mentionedByName) {
      console.log(`   → Mención de "${agent.name}"`);
      return true;
    }
    
    // Detectar preguntas según el idioma
    let questionWords = [];
    
    if (agent.language.startsWith('es')) {
      // Palabras interrogativas en español
      questionWords = [
        'qué', 'que', 'quién', 'quien', 'cómo', 'como', 
        'cuándo', 'cuando', 'dónde', 'donde', 'por qué', 
        'porque', 'cuál', 'cual', 'cuáles', 'cuales'
      ];
    } else if (agent.language.startsWith('en')) {
      // Palabras interrogativas en inglés
      questionWords = [
        'what', 'who', 'how', 'when', 'where', 'why', 'which'
      ];
    }
    
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
    
    // Finales conversacionales según idioma
    let conversationalEndings = [];
    
    if (agent.language.startsWith('es')) {
      conversationalEndings = [
        /\bdale$/i, /\bbueno$/i, /\bok$/i, /\bjoya$/i,
        /\bperfecto$/i, /\bbárbaro$/i, /\bgenial$/i,
        /\bclaro$/i, /\bexacto$/i, /\bsí$/i, /\bno$/i,
        /\bgracias$/i, /\bchau$/i, /\bhola$/i
      ];
    } else if (agent.language.startsWith('en')) {
      conversationalEndings = [
        /\bokay$/i, /\bok$/i, /\balright$/i, /\bgreat$/i,
        /\bperfect$/i, /\bsure$/i, /\byes$/i, /\bno$/i,
        /\bthanks$/i, /\bbye$/i, /\bhello$/i, /\bhi$/i
      ];
    }
    
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

  async function sendToAgent(text, speakerName) {
    if (!canAgentRespond()) {
      return;
    }

    try {
      isProcessing = true;
      isAgentSpeaking = true;
      
      console.log(`\n📤 Procesando mensaje para ${agent.name}`);
      console.log(`   👤 De: ${speakerName}`);
      console.log(`   💬 Mensaje: ${text}`);
      console.log(`   🎬 Primer mensaje: ${isFirstMessage ? 'SÍ' : 'NO'}`);
      const totalStartTime = Date.now();

      const responseText = await getGPT4Response(text, speakerName);
      const audioBase64 = await generateElevenLabsAudio(responseText, isFirstMessage);
      await sendAudioToBot(audioBase64);

      if (isFirstMessage) {
        isFirstMessage = false;
        console.log('✅ Primer mensaje procesado - Próximos mensajes sin silencio inicial');
      }

      lastAgentResponseTime = Date.now();

      const totalDuration = Date.now() - totalStartTime;
      console.log(`✅ Proceso completo en ${totalDuration}ms (${(totalDuration/1000).toFixed(2)}s)`);
      console.log(`⏰ Cooldown activado por ${AUDIO_COOLDOWN/1000}s`);

    } catch (error) {
      console.error('❌ Error en sendToAgent:', error.message);
    } finally {
      isProcessing = false;
      
      setTimeout(() => {
        isAgentSpeaking = false;
        console.log(`✅ ${agent.name} terminó de hablar - Sistema listo`);
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
      console.log(`   🎯 Estado: ${isAgentActive ? 'ACTIVO' : 'PASIVO'}`);
      
      const isComplete = isEndOfSentence(fullText);
      console.log(`   ✅ Frase completa: ${isComplete ? 'Sí' : 'No'}`);

      const hasMinimumWords = wordCount >= 2;
      const shouldProcess = isComplete || hasMinimumWords;

      if (!shouldProcess) {
        console.log('⏭️  Esperando más contenido (muy corto)');
        return;
      }

      userIsCurrentlySpeaking = false;

      if (shouldAgentRespond(fullText)) {
        console.log('🎯 ¡Respuesta activada! Procesando...');
        await sendToAgent(fullText, speakerName);
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
          
          if (!userIsCurrentlySpeaking) {
            userIsCurrentlySpeaking = true;
            console.log('🗣️  Usuario comenzó a hablar');
          }
          
          if (isAgentActive && conversationTimeoutId && !userIsCurrentlySpeaking) {
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

console.log('\n📡 Servidor WebSocket listo - Esperando conexiones...\n');
