// ════════════════════════════════════════════════════════════════
// server.js - FUSIÓN FINAL (Corrección de "Evento undefined")
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

console.log('🚀 Servidor WebSocket: INICIANDO SISTEMA COMPLETO');

// ════════════════════════════════════════════════════════════════
// 1. CONFIGURACIÓN SUPABASE
// ════════════════════════════════════════════════════════════════

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR CRÍTICO: Faltan variables SUPABASE_URL o SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. CLASE CEREBRO (THINKING BRAIN)
// ════════════════════════════════════════════════════════════════

class ThinkingBrain {
  constructor(agentConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.conversationHistory = []; 
  }

  addToHistory(speaker, text) {
    this.conversationHistory.push({ speaker, text, time: Date.now() });
    if (this.conversationHistory.length > 10) {
      this.conversationHistory.shift();
    }
  }

  getContext() {
    return this.conversationHistory
      .map(m => `[${m.speaker}]: ${m.text}`)
      .join('\n');
  }

  async decideAndRespond(lastUserMessage) {
    console.log('\n🧠 Cerebro analizando situación...');
    
    const context = this.getContext();
    
    const prompt = `
Eres ${this.agentName}, un ${this.agentRole}.
Tu personalidad es natural, argentina y cálida.

CONTEXTO RECIENTE:
${context}

TU TAREA:
Analiza el último mensaje del usuario.
1. Si es una pregunta directa para ti -> SPEAK.
2. Si te saludan -> SPEAK.
3. Si piden tu opinión -> SPEAK.
4. Si están hablando entre ellos, dudando o hay silencios cortos -> WAIT.

Responde SIEMPRE en formato JSON:
{
  "decision": "SPEAK" o "WAIT",
  "reason": "motivo breve",
  "message": "tu respuesta (solo si decision es SPEAK)"
}
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
            { role: 'system', content: 'Eres una IA participando en una videollamada.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 200,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      
      if (!data.choices || !data.choices[0]) {
        throw new Error('Respuesta vacía de OpenAI');
      }

      const content = JSON.parse(data.choices[0].message.content);
      console.log(`🧠 Decisión: ${content.decision} (${content.reason})`);
      return content;

    } catch (error) {
      console.error('❌ Error en el cerebro:', error.message);
      return { decision: 'WAIT', reason: 'Error interno' };
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR Y LOGICA DE CONEXIÓN
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

async function loadActiveAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('No se encontró agente default');

    const voiceConfig = agent.agent_voice_config?.find(v => v.is_active) || agent.agent_voice_config?.[0];

    return {
      agent: {
        name: agent.name || 'Agente',
        role: agent.agent_type || 'Asistente',
        language: agent.language || 'es-AR',
        silence_timeout: agent.silence_timeout_ms || 1500
      },
      voice: {
        id: voiceConfig?.voice_id || 'eleven_turbo_v2_5',
        model: 'eleven_turbo_v2_5'
      }
    };
  } catch (e) {
    console.error('❌ Error cargando agente:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Conexión establecida');
  
  const config = await loadActiveAgent();
  if (!config) {
    console.log('⚠️ Cerrando conexión: No se pudo cargar configuración.');
    ws.close();
    return;
  }

  const { agent, voice } = config;
  const brain = new ThinkingBrain(agent);
  
  console.log(`🤖 Agente Activo: ${agent.name} (${agent.role})`);
  console.log(`⏱️  Timeout de silencio: ${agent.silence_timeout}ms`);

  let currentUtterance = [];
  let silenceTimeoutId = null;
  let isProcessing = false;
  let botId = null;

  // --- Output Audio ---
  async function speak(text) {
    if (!botId) {
      console.error('⚠️ No puedo hablar: Falta Bot ID');
      return;
    }
    try {
      console.log(`🗣️  Generando audio...`);
      
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: voice.model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });
      
      if (!audioResp.ok) throw new Error(`ElevenLabs Error: ${audioResp.status}`);

      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      const recallResp = await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.RECALL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });

      if (!recallResp.ok) throw new Error(`Recall Error: ${recallResp.status}`);
      
      console.log('✅ Audio enviado a la sala');
      brain.addToHistory(agent.name, text);

    } catch (e) {
      console.error('❌ Error hablando:', e.message);
    }
  }

  // --- Procesar Frase Completa ---
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0 || isProcessing) return;
    isProcessing = true;
    
    const fullText = currentUtterance.map(w => w.text).join(' ');
    const speaker = currentUtterance[0].speakerName || 'Usuario';
    
    console.log(`📝 FRASE COMPLETA [${speaker}]: "${fullText}"`);
    
    brain.addToHistory(speaker, fullText);
    
    const decision = await brain.decideAndRespond(fullText);
    
    if (decision.decision === 'SPEAK') {
      console.log(`🎯 RESPODIENDO: "${decision.message}"`);
      await speak(decision.message);
    } else {
      console.log('⏸️  Silencio estratégico');
    }

    currentUtterance = [];
    isProcessing = false;
  }

  // --- Manejo de Mensajes ---
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      
      // ✅ LA CORRECCIÓN CLAVE: Detectar 'event' o 'type'
      const eventType = msg.event || msg.type;

      if (eventType !== 'transcript.partial_data') {
         console.log(`📨 Evento recibido: ${eventType}`);
      }

      // 1. Capturar ID (Bot Data)
      if (eventType === 'bot.data') {
        botId = msg.data.bot?.id || msg.data.bot_id;
        console.log(`🤖 Bot ID vinculado: ${botId}`);
      }

      // 2. Procesar Transcript (Datos de audio)
      if (eventType === 'transcript.data') {
        const words = msg.data.data?.words || [];
        const participant = msg.data.data?.participant;
        
        console.log(`📊 Transcript: ${words.length} palabras`);

        if (words.length > 0) {
          console.log(`   🗣️ "${words.map(w => w.text).join(' ')}"`);

          if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
          
          words.forEach(w => {
            currentUtterance.push({
              text: w.text,
              speakerName: participant?.name || 'Desconocido'
            });
          });

          silenceTimeoutId = setTimeout(processCompleteUtterance, agent.silence_timeout);
        }
      }

    } catch (e) {
      console.error('❌ Error socket:', e.message);
      console.log('⚠️ Data corrupta:', data.toString()); // Para ver si llega basura
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket cerrado');
    if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
  });
});

// ════════════════════════════════════════════════════════════════
// SERVIDOR HTTP
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('Recall Brain Active 🧠'));
const server = app.listen(port, () => console.log(`📡 Servidor escuchando en puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
