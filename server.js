const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { ThinkingAgent } = require('./thinking-agent');

// --- CONFIGURACIÓN ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

const wss = new WebSocket.Server({ port: 8080 });

console.log('🚀 Servidor WebSocket iniciado en puerto 8080');

// --- FUNCIONES DE CARGA ---
async function loadActiveAgent(agentName = null) {
  // (Misma lógica que tenías antes, funciona bien)
  let query = supabase.from('agents').select(`*, agent_voice_config (*)`).eq('is_active', true);
  
  if (agentName) {
    query = query.eq('name', agentName.toLowerCase());
  } else {
    query = query.eq('is_default', true);
  }

  const { data: agent, error } = await query.single();
  if (error || !agent) throw new Error(`Error cargando agente: ${error?.message}`);

  const voiceConfig = agent.agent_voice_config.find(v => v.is_active);
  if (!voiceConfig) throw new Error(`Agente sin configuración de voz activa`);

  console.log(`✅ Agente cargado: ${agent.display_name} (${agent.llm_model})`);
  return { agent, voiceConfig };
}

// --- WEBSOCKET HANDLER ---
wss.on('connection', async function connection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  console.log(`\n🔌 Nueva conexión desde: ${clientIp}`);

  let agentConfig;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentName = url.searchParams.get('agent');
    agentConfig = await loadActiveAgent(agentName);
  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    ws.close(1011, error.message);
    return;
  }

  const { agent, voiceConfig } = agentConfig;
  const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  
  // 🧠 INICIALIZAR CEREBRO
  // Usamos la versión mejorada de ThinkingAgent (asegúrate de actualizar ese archivo también)
  const thinkingAgent = new ThinkingAgent(meetingId, agentConfig);

  // CONFIGURACIÓN DE TIEMPOS
  const SILENCE_TIMEOUT = agent.silence_timeout_ms || 1500; // Tiempo de espera tras dejar de hablar
  const MAX_CONTEXT_HISTORY = 15; 

  // ESTADO DE LA CONVERSACIÓN
  let conversationHistory = [];
  let currentUtterance = [];
  let silenceTimeoutId = null;
  let lastWordTime = Date.now();
  let botId = null;
  
  // ESTADO DE INTERACCIÓN
  let isAgentSpeaking = false;
  let isProcessingResponse = false;
  let shouldCancelResponse = false; // Flag para interrupciones

  // --- FUNCIONES CORE ---

  async function generateElevenLabsAudio(text) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.voice_id}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: voiceConfig.voice_model,
          voice_settings: voiceConfig.voice_settings
        })
      });

      if (!response.ok) throw new Error(`ElevenLabs: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    } catch (e) {
      console.error('❌ Error TTS:', e.message);
      return null;
    }
  }

  async function sendAudioToRecall(audioBase64) {
    if (!botId) return;
    try {
      await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${RECALL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ kind: 'mp3', b64_data: audioBase64 })
      });
    } catch (e) {
      console.error('❌ Error enviando audio a Recall:', e.message);
    }
  }

  /**
   * ⚡ CORE LOGIC: Unifica decisión y generación para latencia mínima.
   * El Prompt instruye al modelo a devolver "[SILENCE]" si no debe hablar.
   */
  async function processAndRespond(userText, speakerName) {
    if (isProcessingResponse) return;
    
    isProcessingResponse = true;
    shouldCancelResponse = false; // Nuevo ciclo

    try {
      // 1. Disparar "Pensamiento" en background (Fire & Forget)
      // No usamos 'await' para no bloquear la voz
      thinkingAgent.processUtterance(userText, {
        speakerName,
        speakerId: speakerName, // Idealmente usar ID real si existe
        isAgentSpeaking: false
      }).catch(err => console.error('Error en thinkingAgent:', err));

      console.log(`\n📨 Procesando: "${userText}"`);

      // 2. Construir historial para contexto
      const recentHistory = conversationHistory.map(m => 
        `${m.role === 'user' ? `(${m.speaker})` : '(Assistant)'}: ${m.content}`
      ).join('\n');

      const systemPrompt = `${agent.profile_text}
      
      INSTRUCCIONES DE COMPORTAMIENTO EN TIEMPO REAL:
      1. Eres un participante más en la reunión.
      2. Si el usuario NO te está hablando a ti, o están hablando entre ellos, o solo dijo algo corto como "ok" o "gracias", TU RESPUESTA DEBE SER: [SILENCE]
      3. Si debes responder, sé conciso, natural y directo.
      4. No saludes todo el tiempo.
      
      IMPORTANTE: Responde SOLAMENTE con el texto que vas a decir, o "[SILENCE]" si decides callar.`;

      // 3. Llamada optimizada a OpenAI
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: agent.llm_model || 'gpt-4o', // Usar modelo rápido
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `CONTEXTO PREVIO:\n${recentHistory}\n\nAHORA:\n[${speakerName}]: ${userText}` }
          ],
          temperature: 0.6,
          max_tokens: 150 // Limitar longitud para velocidad
        })
      });

      const data = await completion.json();
      let aiResponse = data.choices?.[0]?.message?.content || '[SILENCE]';

      // 4. Verificar cancelación por interrupción (Barge-in)
      if (shouldCancelResponse) {
        console.log('🛑 Procesamiento cancelado: Usuario interrumpió.');
        return;
      }

      // 5. Evaluar decisión del modelo
      if (aiResponse.includes('[SILENCE]')) {
        console.log('🤫 El bot decidió callar.');
        // Guardamos en historial que escuchamos, pero no respondimos
        conversationHistory.push({ role: 'user', content: userText, speaker: speakerName });
        return;
      }

      console.log(`🗣️ Bot va a decir: "${aiResponse}"`);

      // 6. Generar Audio (TTS)
      const audioBase64 = await generateElevenLabsAudio(aiResponse);
      
      if (audioBase64 && !shouldCancelResponse) {
        isAgentSpeaking = true;
        await sendAudioToRecall(audioBase64);
        
        // Actualizar historial
        conversationHistory.push({ role: 'user', content: userText, speaker: speakerName });
        conversationHistory.push({ role: 'assistant', content: aiResponse });
        
        // Limitar historial
        if (conversationHistory.length > MAX_CONTEXT_HISTORY) {
          conversationHistory = conversationHistory.slice(-MAX_CONTEXT_HISTORY);
        }

        // Notificar al agente pensante que hablamos
        thinkingAgent.processUtterance(aiResponse, {
          speakerName: agent.display_name,
          speakerId: 'agent',
          isAgentSpeaking: true
        });

        // Timer para "soltar" el flag de speaking (estimado)
        setTimeout(() => { isAgentSpeaking = false; }, (aiResponse.length * 80)); 
      }

    } catch (error) {
      console.error('❌ Error procesando respuesta:', error);
    } finally {
      isProcessingResponse = false;
    }
  }

  // --- MANEJO DE WEBSOCKET ---

  ws.on('message', async function incoming(message) {
    try {
      const data = JSON.parse(message);

      // Capturar Bot ID
      if (!botId && data.data?.bot?.id) {
        botId = data.data.bot.id;
        console.log(`🤖 Bot ID vinculado: ${botId}`);
      }

      // A. DATOS PARCIALES (Usuario está hablando ahora mismo)
      if (data.event === 'transcript.partial_data') {
        const words = data.data?.data?.words;
        if (words && words.length > 0) {
          lastWordTime = Date.now();
          
          // LÓGICA DE INTERRUPCIÓN (BARGE-IN)
          if (isAgentSpeaking || isProcessingResponse) {
            console.log('❗ Interrupción detectada!');
            shouldCancelResponse = true; // Cancela proceso LLM/TTS
            isAgentSpeaking = false;
            // Opcional: Enviar señal de stop a Recall si soportan endpoint de "Clear Buffer"
          }
          
          // Reiniciar timer de silencio (Keep-alive del turno del usuario)
          if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
          
          // Re-crear el timer
          silenceTimeoutId = setTimeout(processAccumulatedAudio, SILENCE_TIMEOUT);
        }
      }

      // B. DATOS CONFIRMADOS (Bloque de texto finalizado)
      if (data.event === 'transcript.data') {
        const words = data.data?.data?.words;
        const participant = data.data?.data?.participant;
        
        if (words && words.length > 0) {
          lastWordTime = Date.now();
          if (silenceTimeoutId) clearTimeout(silenceTimeoutId);

          const speakerName = participant?.name || 'Usuario';
          
          // Acumular palabras en el buffer actual
          words.forEach(w => {
            currentUtterance.push({ 
              text: w.text, 
              speakerName: speakerName 
            });
          });

          // Reiniciar timer para procesar el bloque completo
          silenceTimeoutId = setTimeout(processAccumulatedAudio, SILENCE_TIMEOUT);
        }
      }

    } catch (e) {
      console.error('Error WS parsing:', e);
    }
  });

  // Función que se ejecuta cuando hay SILENCIO tras hablar
  async function processAccumulatedAudio() {
    if (currentUtterance.length === 0) return;

    // Reconstruir frase
    const fullText = currentUtterance.map(w => w.text).join(' ').trim();
    const speakerName = currentUtterance[0].speakerName;
    
    // Limpiar buffer para la próxima
    currentUtterance = [];

    // Validaciones básicas
    if (fullText.length < 3) return; // Ignorar ruidos muy cortos
    
    console.log(`\n📝 Transcript Final (${speakerName}): "${fullText}"`);

    // Enviar al núcleo de IA
    await processAndRespond(fullText, speakerName);
  }

  ws.on('close', async () => {
    console.log('🔌 Conexión cerrada');
    if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
    
    // Generar reporte final del ThinkingAgent
    await thinkingAgent.getFinalThoughts();
  });
});
