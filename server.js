// ════════════════════════════════════════════════════════════════
// server.js - FASE 3: STREAMING SINCRONIZADO (Anti-Superposición)
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ CALIBRACIÓN DE TIEMPOS
const SILENCE_THRESHOLD_MS = 600; 
const CHARS_PER_SECOND = 16; // Velocidad promedio de habla (ajustar para más/menos velocidad)

console.log('🚀 Servidor WebSocket: AUDIO SYNC ENGINE ONLINE');

// ════════════════════════════════════════════════════════════════
// 1. SUPABASE
// ════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ FATAL: Faltan variables SUPABASE.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. GESTOR DE STREAMING (Con Cola de Tiempo Real)
// ════════════════════════════════════════════════════════════════

class StreamManager {
  constructor(agentConfig, botId, voiceConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.botId = botId;
    this.voiceId = voiceConfig.id;
    this.conversationHistory = [];
    
    // Cola de Reproducción
    this.audioQueue = []; 
    this.isProcessingQueue = false;
    this.currentWaitTimer = null; // Para poder cancelar la espera si interrumpen
    this.isInterrupted = false;
  }

  addToHistory(role, text) {
    this.conversationHistory.push({ role, content: text });
    if (this.conversationHistory.length > 12) this.conversationHistory.shift();
  }

  getFormattedHistory() {
    return this.conversationHistory.map(msg => ({
      role: msg.role === this.agentName ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  // 🛑 BOTÓN DE PÁNICO (Interrupción)
  stop() {
    this.isInterrupted = true;
    this.audioQueue = []; // Borrar frases pendientes
    if (this.currentWaitTimer) {
      clearTimeout(this.currentWaitTimer); // Cancelar espera actual
      this.currentWaitTimer = null;
    }
    this.isProcessingQueue = false;
    console.log('🛑 Stream interrumpido. Silencio total.');
  }

  async processUserMessage(userText) {
    if (!userText.trim()) return;
    
    console.log(`📝 Usuario: "${userText}"`);
    this.addToHistory('user', userText);
    this.isInterrupted = false; 

    const systemPrompt = `
    Eres ${this.agentName}, ${this.agentRole}.
    INSTRUCCIONES:
    1. Responde como un humano, usando frases cortas.
    2. Separa tus ideas con puntos seguidos.
    3. Sé natural y empática.
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
          stream: true,
          temperature: 0.6,
          max_tokens: 250
        })
      });

      const reader = response.body;
      let sentenceBuffer = "";
      let fullResponse = "";

      for await (const chunk of reader) {
        if (this.isInterrupted) break;

        const chunkString = chunk.toString();
        const lines = chunkString.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.includes('[DONE]')) continue;
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices[0].delta.content;
              
              if (content) {
                fullResponse += content;
                sentenceBuffer += content;

                // DETECTOR DE FRASES COMPLETAS
                // Buscamos puntuación fuerte (. ? !)
                if (sentenceBuffer.match(/[.?!;]/)) {
                   // Encontramos el índice del último signo de puntuación
                   const match = sentenceBuffer.match(/[.?!;]/);
                   const index = match.index;

                   const completeSentence = sentenceBuffer.substring(0, index + 1);
                   const remainder = sentenceBuffer.substring(index + 1);
                   
                   if (completeSentence.trim().length > 2) {
                      this.queueAudio(completeSentence.trim());
                      sentenceBuffer = remainder;
                   }
                }
              }
            } catch (e) {}
          }
        }
      }

      // Remanente
      if (sentenceBuffer.trim().length > 0 && !this.isInterrupted) {
        this.queueAudio(sentenceBuffer.trim());
      }

      if (!this.isInterrupted) this.addToHistory(this.agentName, fullResponse);

    } catch (error) {
      console.error('❌ Error Stream:', error.message);
    }
  }

  // --- COLA DE AUDIO INTELIGENTE (CRONOMETRADA) ---
  queueAudio(text) {
    if (this.isInterrupted) return;
    console.log(`📥 Encolando: "${text}"`);
    this.audioQueue.push(text);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return; // Si ya está procesando, no hacer nada
    this.isProcessingQueue = true;

    while (this.audioQueue.length > 0) {
      if (this.isInterrupted) {
        this.audioQueue = [];
        break;
      }

      const text = this.audioQueue.shift();
      
      // 1. Generar y Enviar Audio
      try {
        await this.generateAndSendAudio(text);
        
        // 2. CALCULAR DURACIÓN ESTIMADA (La clave anti-superposición)
        // Estimamos: Caracteres / Velocidad * 1000ms + Buffer pequeño
        const estimatedDurationMs = Math.max(1000, (text.length / CHARS_PER_SECOND) * 1000);
        
        console.log(`⏳ Esperando ${Math.round(estimatedDurationMs)}ms (reproduciendo)...`);
        
        // 3. ESPERAR A QUE TERMINE DE SONAR ANTES DE SEGUIR
        await new Promise(resolve => {
          this.currentWaitTimer = setTimeout(resolve, estimatedDurationMs);
        });

      } catch (e) {
        console.error('Audio Error:', e.message);
      }
    }

    this.isProcessingQueue = false;
    console.log('✅ Cola de audio finalizada.');
  }

  async generateAndSendAudio(text) {
    console.log(`🔊 Enviando a Recall: "${text}"`);
    const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
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

    if (!audioResp.ok) throw new Error(`ElevenLabs: ${audioResp.status}`);
    const arrayBuffer = await audioResp.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    await fetch(`https://us-west-2.recall.ai/api/v1/bot/${this.botId}/output_audio/`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'mp3', b64_data: base64Audio })
    });
  }
}

// ════════════════════════════════════════════════════════════════
// 3. SERVIDOR WEBSOCKET
// ════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ noServer: true });

async function loadAgent() {
  try {
    const { data: agent, error } = await supabase
      .from('agents')
      .select(`*, agent_voice_config (*)`)
      .eq('is_default', true)
      .single();

    if (error || !agent) throw new Error('Agent not found');
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

      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`🤖 Bot ID: ${botId}`);
        streamManager = new StreamManager(config.agent, botId, config.voice);
      }

      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        
        if (words.length > 0) {
          // 🛑 INTERRUPCIÓN REAL
          if (streamManager) streamManager.stop();

          if (silenceTimer) clearTimeout(silenceTimer);
          words.forEach(w => currentUtterance.push(w.text));

          silenceTimer = setTimeout(() => {
            if (currentUtterance.length > 0 && streamManager) {
              const fullText = currentUtterance.join(' ');
              currentUtterance = []; 
              streamManager.processUserMessage(fullText);
            }
          }, SILENCE_THRESHOLD_MS);
        }
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (streamManager) streamManager.stop();
    console.log('❌ Cliente desconectado');
  });
});

// ════════════════════════════════════════════════════════════════
// 4. HTTP
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('Recall Audio Sync v3.0'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
