// ════════════════════════════════════════════════════════════════
// server.js - MODO INSTANTÁNEO (Cero Lag)
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ CONFIGURACIÓN DE VELOCIDAD
// 400ms es lo que tardas en tomar aire. Si paras 0.4s, la IA asume que terminaste.
const AGGRESSIVE_SILENCE_MS = 400; 

console.log('🚀 Servidor WebSocket: MODO INSTANTÁNEO ACTIVADO');

// ════════════════════════════════════════════════════════════════
// 1. CONFIGURACIÓN SUPABASE
// ════════════════════════════════════════════════════════════════

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Faltan variables SUPABASE.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. CEREBRO ULTRARÁPIDO
// ════════════════════════════════════════════════════════════════

class ThinkingBrain {
  constructor(agentConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.conversationHistory = []; 
  }

  addToHistory(speaker, text) {
    this.conversationHistory.push({ speaker, text, time: Date.now() });
    if (this.conversationHistory.length > 6) this.conversationHistory.shift();
  }

  getContext() {
    return this.conversationHistory
      .map(m => `[${m.speaker}]: ${m.text}`)
      .join('\n');
  }

  async decideAndRespond(lastUserMessage) {
    // console.log('⚡ Analizando...'); // Comentado para limpiar log
    const startTime = Date.now();
    
    const context = this.getContext();
    
    // Prompt diseñado para que GPT-4o-mini lea lo menos posible y responda YA.
    const prompt = `
Eres ${this.agentName}, ${this.agentRole}.
CHAT:
${context}

Si te hablan, te saludan o piden opinión: RESPONDÉ CORTO Y NATURAL.
Si no: ESPERÁ.

JSON: {"decision": "SPEAK"|"WAIT", "message": "respuesta"}
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
            { role: 'system', content: 'Eres rápido.' }, 
            { role: 'user', content: prompt }
          ],
          temperature: 0.6,
          max_tokens: 100, // Respuesta ultra corta para velocidad
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const content = JSON.parse(data.choices[0].message.content);
      
      const time = Date.now() - startTime;
      console.log(`⚡ Decisión en ${time}ms: ${content.decision}`);
      return content;

    } catch (error) {
      console.error('❌ Err cerebro:', error.message);
      return { decision: 'WAIT' };
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR
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
      agent: {
        name: agent.name,
        role: agent.agent_type,
        language: agent.language
      },
      voice: {
        id: voiceConfig?.voice_id || 'eleven_turbo_v2_5',
        model: 'eleven_turbo_v2_5'
      }
    };
  } catch (e) {
    console.error('Error DB:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Conexión OK');
  
  const config = await loadActiveAgent();
  if (!config) { ws.close(); return; }

  const { agent, voice } = config;
  const brain = new ThinkingBrain(agent);
  
  // Ignoramos el timeout de la DB y usamos el agresivo
  console.log(`🏎️  Agente: ${agent.name} | Timeout: ${AGGRESSIVE_SILENCE_MS}ms (Hardcoded)`);

  let currentUtterance = [];
  let silenceTimeoutId = null;
  let botId = null;

  // --- Output Audio ---
  async function speak(text) {
    if (!botId) return;
    try {
      console.log(`🗣️  Generando...`);
      
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          optimize_streaming_latency: 4 // MÁXIMA PRIORIDAD LATENCIA
        })
      });
      
      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/output_audio/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });
      
      console.log('✅ Enviado');
      brain.addToHistory(agent.name, text);

    } catch (e) {
      console.error('Err Audio:', e.message);
    }
  }

  // --- Procesar ---
  async function processCompleteUtterance() {
    if (currentUtterance.length === 0) return;
    
    const fullText = currentUtterance.map(w => w.text).join(' ');
    const speaker = currentUtterance[0].speakerName || 'Usuario';
    
    console.log(`📝 Escuchado: "${fullText}"`);
    
    // Limpiamos buffer INMEDIATAMENTE para evitar procesar doble
    currentUtterance = [];
    
    brain.addToHistory(speaker, fullText);
    const decision = await brain.decideAndRespond(fullText);
    
    if (decision.decision === 'SPEAK') {
      await speak(decision.message);
    } 
  }

  // --- Mensajes ---
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Captura ID agresiva
      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`✅ ID: ${botId}`);
      }

      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        const participant = msg.data.data?.participant;
        
        if (words.length > 0) {
          // Si llegan palabras nuevas, cancelamos el timeout anterior (el usuario sigue hablando)
          if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
          
          words.forEach(w => {
            currentUtterance.push({
              text: w.text,
              speakerName: participant?.name || 'Desconocido'
            });
          });

          // Aquí está la magia: Esperamos solo 400ms. 
          // Si no llegan más palabras en 0.4s, asumimos que terminó y procesamos YA.
          silenceTimeoutId = setTimeout(processCompleteUtterance, AGGRESSIVE_SILENCE_MS);
        }
      }

    } catch (e) {
      console.error('Err:', e.message);
    }
  });

  ws.on('close', () => {
    if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
  });
});

app.get('/', (req, res) => res.send('Instant Brain 🧠'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
