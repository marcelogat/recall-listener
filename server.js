// ════════════════════════════════════════════════════════════════
// server.js - MODO LÍDER PROACTIVO (Facilitador de Reuniones)
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ CONFIGURACIÓN DE LIDERAZGO
const AGGRESSIVE_SILENCE_MS = 600; // Tiempo para asumir fin de frase usuario
const SOCIAL_CHECK_MS = 4000;      // 4s de silencio = El bot toma el mando

console.log('🚀 Servidor WebSocket: MODO LÍDER ACTIVADO');

// ════════════════════════════════════════════════════════════════
// 1. SUPABASE
// ════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Faltan variables SUPABASE.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. CEREBRO LÍDER (Prompt de Conducción)
// ════════════════════════════════════════════════════════════════

class ThinkingBrain {
  constructor(agentConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.conversationHistory = []; 
  }

  addToHistory(speaker, text) {
    this.conversationHistory.push({ speaker, text, time: Date.now() });
    if (this.conversationHistory.length > 20) this.conversationHistory.shift();
  }

  getContext() {
    return this.conversationHistory.map(m => `[${m.speaker}]: ${m.text}`).join('\n');
  }

  async decideAndRespond(triggerType, textInput = "") {
    const context = this.getContext();
    console.log(`🧠 Liderando (${triggerType})...`);

    // 🧠 EL SECRETO ESTÁ AQUÍ: INSTRUCCIONES DE LIDERAZGO
    const prompt = `
Eres ${this.agentName}, actuando como ${this.agentRole}.
Tu rol NO es solo responder. Tu rol es LIDERAR y FACILITAR la conversación.

HISTORIAL:
${context}

SITUACIÓN ACTUAL: "${triggerType === 'SILENCE_CHECK' ? '[SILENCIO EN LA SALA - LA REUNIÓN SE ESTANCÓ]' : textInput}"

OBJETIVOS:
1. NUNCA termines con una respuesta cerrada ("Sí, claro."). SIEMPRE devuelve la pelota ("Sí, claro. ¿Y tú cómo ves ese punto?").
2. Si el usuario da una respuesta corta, INDAGA MÁS ("¿Podrías darme un ejemplo?", "Cuéntame más sobre eso").
3. Si hay silencio, PROPÓN un nuevo tema relacionado o haz una pregunta provocadora.
4. Mantén la energía alta. Eres proactivo/a, no pasivo/a.

FORMATO JSON:
1. "decision": "SPEAK" (Casi siempre, a menos que te interrumpan) o "WAIT".
2. "reflex": Reacción inmediata (1-3 palabras) para ganar el turno ("Excelente punto,", "Entiendo,", "A ver...", "Oye,").
3. "message": El contenido principal + LA PREGUNTA DE CIERRE (Hook).

Ejemplo: {"decision": "SPEAK", "reflex": "Qué interesante,", "message": "coincido totalmente. Ahora bien, ¿cómo crees que esto impacta en el equipo?"}
`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', 
          messages: [
            { role: 'system', content: 'Eres un líder de reunión carismático y proactivo.' }, 
            { role: 'user', content: prompt }
          ],
          temperature: 0.7, // Creatividad para sacar temas
          max_tokens: 250,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);

    } catch (error) {
      console.error('❌ Err cerebro:', error.message);
      return { decision: 'WAIT' };
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR (Lógica de Flujo)
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

async function loadActiveAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('No agent found');
    const voiceConfig = agent.agent_voice_config?.find(v => v.is_active) || agent.agent_voice_config?.[0];

    return {
      agent: { name: agent.name, role: agent.agent_type },
      voice: { id: voiceConfig?.voice_id || 'eleven_turbo_v2_5', model: 'eleven_turbo_v2_5' }
    };
  } catch (e) {
    console.error('DB Error:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Conexión OK');
  const config = await loadActiveAgent();
  if (!config) { ws.close(); return; }

  const { agent, voice } = config;
  const brain = new ThinkingBrain(agent);
  
  console.log(`👑 Agente Líder: ${agent.name} | Init: ${SOCIAL_CHECK_MS}ms`);

  let currentUtterance = [];
  let processingTimeoutId = null;
  let socialCheckTimeoutId = null;
  let botId = null;
  let audioQueue = []; 
  let isPlayingAudio = false;

  // --- COLA DE AUDIO ---
  async function processAudioQueue() {
    if (isPlayingAudio || audioQueue.length === 0) return;
    isPlayingAudio = true;

    const { text, resolve } = audioQueue.shift();
    
    try {
      console.log(`🔊 On Air: "${text}"`);
      
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          optimize_streaming_latency: 4 
        })
      });

      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });

      const duration = Math.max(1000, (text.length / 15) * 1000); 
      setTimeout(() => {
        isPlayingAudio = false;
        if (resolve) resolve();
        processAudioQueue(); 
      }, duration);

    } catch (e) {
      console.error('Audio Error:', e);
      isPlayingAudio = false;
      processAudioQueue();
    }
  }

  function queueSpeak(text) {
    return new Promise((resolve) => {
      audioQueue.push({ text, resolve });
      processAudioQueue();
    });
  }

  // --- Reiniciar Vigilancia ---
  function resetSocialTimer() {
    if (socialCheckTimeoutId) clearTimeout(socialCheckTimeoutId);
    // Solo activamos vigilancia si NO se está reproduciendo audio
    if (!isPlayingAudio && audioQueue.length === 0) {
      socialCheckTimeoutId = setTimeout(performSocialCheck, SOCIAL_CHECK_MS);
    }
  }

  // --- Chequeo de Silencio (El bot toma la iniciativa) ---
  async function performSocialCheck() {
    const decision = await brain.decideAndRespond('SILENCE_CHECK');
    if (decision.decision === 'SPEAK') {
        console.log('⚡ ROMPIENDO EL SILENCIO');
        if (decision.reflex) queueSpeak(decision.reflex);
        if (decision.message) queueSpeak(decision.message).then(resetSocialTimer);
    } else {
        resetSocialTimer();
    }
  }

  // --- Procesar Input Humano ---
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;
    
    const fullText = currentUtterance.map(w => w.text).join(' ');
    const speaker = currentUtterance[0].speakerName || 'Usuario';
    
    console.log(`📝 Escuchado: "${fullText}"`);
    currentUtterance = []; 
    if (socialCheckTimeoutId) clearTimeout(socialCheckTimeoutId);

    brain.addToHistory(speaker, fullText);
    
    const decision = await brain.decideAndRespond('USER_INPUT', fullText);
    
    if (decision.decision === 'SPEAK') {
      if (decision.reflex) {
        console.log(`⚡ Reflejo: "${decision.reflex}"`);
        queueSpeak(decision.reflex); 
      }
      if (decision.message) {
        console.log(`💬 Mensaje: "${decision.message}"`);
        queueSpeak(decision.message).then(resetSocialTimer);
      }
    } else {
      resetSocialTimer();
    }
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`✅ ID: ${botId}`);
        resetSocialTimer(); // Inicia vigilancia apenas entra
      }

      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        const participant = msg.data.data?.participant;
        
        if (words.length > 0) {
          // Interrupción: Limpiamos todo
          if (processingTimeoutId) clearTimeout(processingTimeoutId);
          if (socialCheckTimeoutId) clearTimeout(socialCheckTimeoutId);
          
          // Opcional: Si quieres que el bot se calle si lo interrumpen:
          // audioQueue = []; 
          
          words.forEach(w => {
            currentUtterance.push({
              text: w.text,
              speakerName: participant?.name || 'Desconocido'
            });
          });
          processingTimeoutId = setTimeout(processCompleteUtterance, AGGRESSIVE_SILENCE_MS);
        }
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    if (processingTimeoutId) clearTimeout(processingTimeoutId);
    if (socialCheckTimeoutId) clearTimeout(socialCheckTimeoutId);
  });
});

app.get('/', (req, res) => res.send('Leader Brain 🧠'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)));
