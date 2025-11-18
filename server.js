// ════════════════════════════════════════════════════════════════
// server.js - FASE 1: STREAMING REAL & LATENCIA CERO
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ AJUSTE FINO DE TIEMPOS
// 600ms: El equilibrio perfecto. Menos es interrumpir, más es lag.
const SILENCE_THRESHOLD_MS = 600; 

console.log('🚀 Servidor WebSocket: STREAMING ARCHITECTURE ONLINE');

// ════════════════════════════════════════════════════════════════
// 1. SUPABASE (Validación Estricta)
// ════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ FATAL: Faltan variables de entorno SUPABASE.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. GESTOR DE STREAMING (El Corazón del Sistema)
// ════════════════════════════════════════════════════════════════

class StreamManager {
  constructor(agentConfig, botId, voiceConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.botId = botId;
    this.voiceId = voiceConfig.id;
    this.conversationHistory = [];
    this.isSpeaking = false;
  }

  addToHistory(role, text) {
    this.conversationHistory.push({ role, content: text });
    if (this.conversationHistory.length > 12) this.conversationHistory.shift();
  }

  // Convierte el historial al formato exacto que pide OpenAI
  getFormattedHistory() {
    return this.conversationHistory.map(msg => ({
      role: msg.role === this.agentName ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  async processUserMessage(userText) {
    if (!userText.trim()) return;
    
    console.log(`📝 Usuario: "${userText}"`);
    this.addToHistory('user', userText);
    this.isSpeaking = true;

    // PROMPT DE PERSONALIDAD HUMANA
    const systemPrompt = `
    Eres ${this.agentName}, ${this.agentRole}.
    
    REGLAS DE ORO PARA PARECER HUMANA:
    1. RESPUESTA INSTANTÁNEA: Empieza tu frase con un conector natural ("A ver...", "Claro,", "Mmh,", "Entiendo,") para ganar tiempo.
    2. CONCISIÓN EXTREMA: Habla en oraciones cortas. Nada de párrafos largos.
    3. CERO FORMALIDAD: No uses "Estimado", "Cordialmente", ni listas con viñetas. Habla como en un café.
    4. FLUJO: Si te preguntan, responde y devuelve una pregunta corta. Si afirman, valida y agrega un dato.
    
    Tu objetivo no es ser una enciclopedia, es ser una buena conversadora.
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
            { role: 'system', content: systemPrompt },
            ...this.getFormattedHistory()
          ],
          stream: true, // <--- ACTIVAMOS STREAMING
          temperature: 0.6,
          max_tokens: 200
        })
      });

      // Procesamiento del Stream de Texto
      const reader = response.body;
      let textBuffer = "";
      let fullResponse = "";
      let sentenceBuffer = "";

      for await (const chunk of reader) {
        const chunkString = chunk.toString();
        const lines = chunkString.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.includes('[DONE]')) continue;
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices[0].delta.content;
              
              if (content) {
                textBuffer += content;
                sentenceBuffer += content;
                fullResponse += content;

                // HEURÍSTICA DE CORTE:
                // Enviamos a audio apenas tenemos un signo de puntuación fuerte
                // Esto hace que el audio empiece a sonar mientras GPT sigue escribiendo.
                if (sentenceBuffer.match(/[.,?!;]/) && sentenceBuffer.length > 5) {
                  console.log(`⚡ Chunk a Audio: "${sentenceBuffer.trim()}"`);
                  await this.streamAudioChunk(sentenceBuffer);
                  sentenceBuffer = ""; // Limpiamos buffer parcial
                }
              }
            } catch (e) {
              // Ignorar errores de parseo en chunks parciales
            }
          }
        }
      }

      // Enviar lo que haya quedado en el buffer final
      if (sentenceBuffer.trim().length > 0) {
        await this.streamAudioChunk(sentenceBuffer);
      }

      // Guardamos la respuesta completa en la memoria
      this.addToHistory(this.agentName, fullResponse);
      this.isSpeaking = false;
      console.log('✅ Respuesta completada.');

    } catch (error) {
      console.error('❌ Error en Stream:', error);
      this.isSpeaking = false;
    }
  }

  async streamAudioChunk(text) {
    try {
      const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.4, similarity_boost: 0.8 }, // Stability baja = más expresividad variable
          optimize_streaming_latency: 4 // MÁXIMA PRIORIDAD
        })
      });

      if (!audioResp.ok) throw new Error(`ElevenLabs Error: ${audioResp.status}`);

      const arrayBuffer = await audioResp.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');

      // Enviamos el chunk de audio a Recall
      // Recall gestiona su propio buffer, así que podemos enviarlos secuencialmente
      await fetch(`https://us-west-2.recall.ai/api/v1/bot/${this.botId}/output_audio/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
      });

    } catch (e) {
      console.error('⚠️ Error generando audio chunk:', e.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR WEBSOCKET (Lógica de Conexión)
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

async function loadAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('Agent not found in DB');
    
    const vConfig = agent.agent_voice_config?.find(v => v.is_active) || agent.agent_voice_config?.[0];
    
    return {
      agent: { name: agent.name, role: agent.agent_type },
      voice: { id: vConfig?.voice_id || 'eleven_turbo_v2_5' }
    };
  } catch (e) {
    console.error('DB Error:', e.message);
    return null;
  }
}

wss.on('connection', async (ws, req) => {
  console.log('✅ Cliente conectado');
  const config = await loadAgent();
  if (!config) { ws.close(); return; }

  let streamManager = null; 
  let botId = null;
  let currentUtterance = [];
  let silenceTimer = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // 1. Inicialización (Captura de ID)
      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`🤖 Bot ID: ${botId}`);
        streamManager = new StreamManager(config.agent, botId, config.voice);
      }

      // 2. Procesamiento de Audio (Transcript)
      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        
        if (words.length > 0) {
          // Si el bot está hablando, NO escuchamos (evita auto-escucha y loop)
          if (streamManager && streamManager.isSpeaking) return;

          // Cancelamos el timer de silencio porque el usuario sigue hablando
          if (silenceTimer) clearTimeout(silenceTimer);

          words.forEach(w => {
            currentUtterance.push(w.text);
          });

          // Reiniciamos el timer
          silenceTimer = setTimeout(() => {
            if (currentUtterance.length > 0 && streamManager) {
              const fullText = currentUtterance.join(' ');
              currentUtterance = []; // Limpiar buffer inmediatamente
              
              // Disparar el proceso de streaming
              streamManager.processUserMessage(fullText);
            }
          }, SILENCE_THRESHOLD_MS);
        }
      }
    } catch (e) {
      console.error('WS Error:', e.message);
    }
  });

  ws.on('close', () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    console.log('❌ Cliente desconectado');
  });
});

// ════════════════════════════════════════════════════════════════
// 4. SERVIDOR HTTP
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('Recall Streaming Core v1.0'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
