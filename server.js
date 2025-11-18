// ════════════════════════════════════════════════════════════════
// server.js - FUSIÓN: Mecánica Robusta + Cerebro Pensante
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

console.log('🚀 Servidor WebSocket: FUSIÓN (Body V1 + Brain V2)');

// ════════════════════════════════════════════════════════════════
// 1. CONFIGURACIÓN SUPABASE (Corregida)
// ════════════════════════════════════════════════════════════════

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Clave correcta de Render

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Faltan variables SUPABASE_URL o SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. CLASE THINKING BRAIN (El Cerebro)
// ════════════════════════════════════════════════════════════════

class ThinkingBrain {
  constructor(agentConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.conversationHistory = []; // Historial corto para contexto
  }

  addToHistory(speaker, text) {
    this.conversationHistory.push({ speaker, text, time: Date.now() });
    // Mantenemos solo los últimos 10 mensajes para no saturar el prompt
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
Tu personalidad es natural, argentina, cálida.

HISTORIAL RECIENTE:
${context}

INSTRUCCIÓN:
Analiza el último mensaje. Decide si debes responder.
- RESPONDE SI: Te preguntan algo, te mencionan, o es un silencio donde tu aporte suma valor crítico.
- ESPERA SI: El usuario está pensando, completando una idea, o hablando con otro humano.

FORMATO DE RESPUESTA (JSON puro):
{
  "decision": "SPEAK" o "WAIT",
  "reason": "Breve motivo",
  "message": "Tu respuesta (solo si decision es SPEAK)"
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
          model: 'gpt-4o-mini', // Rápido y eficiente
          messages: [
            { role: 'system', content: 'Eres un cerebro IA que decide cuándo hablar en una reunión.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 150,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const content = JSON.parse(data.choices[0].message.content);

      console.log(`🧠 Decisión: ${content.decision} (${content.reason})`);
      return content; // Retorna { decision, reason, message }

    } catch (error) {
      console.error('❌ Error en el cerebro:', error);
      return { decision: 'WAIT' }; // Ante la duda, silencio
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. LÓGICA DEL SERVIDOR (El Cuerpo Robusto del V1)
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

// Función de carga de datos (Versión corregida)
async function loadActiveAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('No se encontró agente');

    const voiceConfig = agent.agent_voice_config?.find(v => v.is_active) || agent.agent_voice_config?.[0];

    return {
      agent: {
        name: agent.name,
        role: agent.agent_type || 'Asistente',
        language: agent.language,
        silence_timeout: agent.silence_timeout_ms || 1000
      },
      voice: {
        id: voiceConfig?.voice_id || 'eleven_turbo_v2_5',
        model: 'eleven_turbo_v2_5'
      }
    };
  } catch (e) {
    console.error('❌ Error DB:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Conexión establecida');
  
  // 1. Cargar Configuración
  const config = await loadActiveAgent();
  if (!config) {
    console.log('❌ Cerrando por falta de configuración');
    ws.close();
    return;
  }

  const { agent, voice } = config;
  const brain = new ThinkingBrain(agent); // Instanciar el cerebro
  
  console.log(`🤖 Agente listo: ${agent.name} (${agent.role})`);

  // Variables de Estado (Mecánica del V1)
  let currentUtterance = [];
  let silenceTimeoutId = null;
  let isProcessing = false;
  let botId = null;

  // --- FUNCIÓN DE HABLAR (Output) ---
  async function speak(text) {
    if (!botId) return;
    try {
      console.log(`🗣️  Generando audio: "${text}"`);
      
      // ElevenLabs
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: voice.model
        })
      });
      
      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      // Recall.ai
      await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.RECALL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });
      
      console.log('✅ Audio enviado a la reunión');
      // Agregamos nuestra propia respuesta al historial del cerebro
      brain.addToHistory(agent.name, text);

    } catch (e) {
      console.error('❌ Error generando/enviando audio:', e.message);
    }
  }

  // --- PROCESAR FRASE COMPLETA (El puente entre V1 y Brain) ---
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0 || isProcessing) return;

    isProcessing = true;
    
    // 1. Reconstruir la frase dicha por el humano
    const fullText = currentUtterance.map(w => w.text).join(' ');
    const speaker = currentUtterance[0].speakerName || 'Humano';
    
    console.log(`📝 Escuchado [${speaker}]: "${fullText}"`);
    
    // 2. Alimentar al cerebro
    brain.addToHistory(speaker, fullText);
    
    // 3. PREGUNTAR AL CEREBRO (Aquí está la magia)
    // Ya no usamos Regex simple, usamos GPT para evaluar si responder
    const decision = await brain.decideAndRespond(fullText);
    
    if (decision.decision === 'SPEAK') {
      await speak(decision.message);
    } else {
      console.log('⏸️  Decisión: Esperar');
    }

    currentUtterance = []; // Limpiar buffer
    isProcessing = false;
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // Capturar ID del Bot
      if (msg.type === 'bot.data') {
        botId = msg.data.bot?.id || msg.data.bot_id;
      }

      // Procesar Transcript (Mecánica V1)
      if (msg.type === 'transcript.data') {
        const words = msg.data.data?.words || [];
        const participant = msg.data.data?.participant;
        
        if (words.length > 0) {
          // Resetear timeout de silencio
          if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
          
          // Acumular palabras
          words.forEach(w => {
            currentUtterance.push({
              text: w.text,
              speakerName: participant?.name || 'Desconocido'
            });
          });

          // Configurar nuevo timeout (Esperar a que termine la frase)
          // Usamos el timeout configurado en la BD o 1 segundo por defecto
          silenceTimeoutId = setTimeout(processCompleteUtterance, agent.silence_timeout);
        }
      }
    } catch (e) {
      console.error('Error socket:', e);
    }
  });

  ws.on('close', () => {
    console.log('❌ Desconectado');
    if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
  });
});

// Servidor HTTP Básico
app.get('/', (req, res) => res.send('Recall Brain Active 🧠'));
const server = app.listen(port, () => console.log(`📡 Escuchando en puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
