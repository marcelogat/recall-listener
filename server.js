// ════════════════════════════════════════════════════════════════
// server.js - FASE 2: STREAMING SINCRONIZADO Y LIMPIO
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ TIEMPOS
const SILENCE_THRESHOLD_MS = 500; 

console.log('🚀 Servidor WebSocket: STREAMING SINCRONIZADO ONLINE');

// ════════════════════════════════════════════════════════════════
// 1. SUPABASE
// ════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ FATAL: Faltan variables de entorno SUPABASE.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════════════════════════════
// 2. GESTOR DE STREAMING (Con Buffer Inteligente y Cola)
// ════════════════════════════════════════════════════════════════

class StreamManager {
  constructor(agentConfig, botId, voiceConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.botId = botId;
    this.voiceId = voiceConfig.id;
    this.conversationHistory = [];
    
    // Estado del Stream
    this.isInterrupted = false; // Bandera de interrupción
    this.audioQueue = [];       // Cola de audios para no pisarse
    this.isProcessingQueue = false;
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

  // --- FUNCIÓN DE INTERRUPCIÓN (Barge-In) ---
  stop() {
    this.isInterrupted = true;
    this.audioQueue = []; // Vaciar cola pendiente
    console.log('🛑 Stream detenido por el usuario.');
  }

  async processUserMessage(userText) {
    if (!userText.trim()) return;
    
    console.log(`📝 Usuario: "${userText}"`);
    this.addToHistory('user', userText);
    this.isInterrupted = false; // Reiniciamos bandera

    const systemPrompt = `
    Eres ${this.agentName}, ${this.agentRole}.
    
    INSTRUCCIONES DE VOZ:
    1. Responde en frases cortas.
    2. Usa puntuación clara (.,?) para que tu voz respire.
    3. Sé natural, como una charla de café.
    4. NO uses listas ni formatos complejos. Solo texto plano.
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
      let sentenceBuffer = ""; // Acumula texto hasta tener sentido
      let fullResponse = "";

      for await (const chunk of reader) {
        if (this.isInterrupted) break; // 🛑 Cortar si el usuario habló

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

                // 🧠 BUFFER INTELIGENTE:
                // Solo cortamos si hay un signo de puntuación Y un espacio después (o fin de línea)
                // Esto evita cortar "Sra." o "1.5" o palabras a medias.
                // Buscamos: (Puntuación) + (Espacio o fin)
                
                // Regex: Busca [.?!;] seguido de un espacio o el final
                // Pero para simplificar y ser rápidos:
                // Si encontramos un signo de cierre fuerte, intentamos enviar.
                
                if (sentenceBuffer.match(/[.?!;]\s/) || (sentenceBuffer.match(/[.?!;]/) && sentenceBuffer.length > 20)) {
                   // Cortamos en el último signo de puntuación encontrado
                   const lastPunctuationIndex = Math.max(
                     sentenceBuffer.lastIndexOf('.'),
                     sentenceBuffer.lastIndexOf('?'),
                     sentenceBuffer.lastIndexOf('!'),
                     sentenceBuffer.lastIndexOf(';')
                   );

                   if (lastPunctuationIndex !== -1) {
                     const completeSentence = sentenceBuffer.substring(0, lastPunctuationIndex + 1);
                     const remainder = sentenceBuffer.substring(lastPunctuationIndex + 1);
                     
                     if (completeSentence.trim().length > 2) { // Evitar enviar solo "."
                        console.log(`⚡ Frase a Audio: "${completeSentence.trim()}"`);
                        this.queueAudio(completeSentence.trim());
                        sentenceBuffer = remainder;
                     }
                   }
                }
              }
            } catch (e) {}
          }
        }
      }

      // Enviar remanente si quedó algo en el tintero
      if (sentenceBuffer.trim().length > 0 && !this.isInterrupted) {
        this.queueAudio(sentenceBuffer.trim());
      }

      if (!this.isInterrupted) {
          this.addToHistory(this.agentName, fullResponse);
      }

    } catch (error) {
      console.error('❌ Error Stream:', error.message);
    }
  }

  // --- COLA SECUENCIAL DE AUDIO ---
  async queueAudio(text) {
    this.audioQueue.push(text);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.audioQueue.length > 0) {
      if (this.isInterrupted) {
          this.audioQueue = [];
          break;
      }

      const text = this.audioQueue.shift();
      try {
        await this.generateAndSendAudio(text);
      } catch (e) {
        console.error('Audio Gen Error:', e.message);
      }
    }

    this.isProcessingQueue = false;
  }

  async generateAndSendAudio(text) {
    const audioResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_turbo_v2_5',
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

      // 1. Inicialización
      if (!botId && msg.data?.bot?.id) {
        botId = msg.data.bot.id;
        console.log(`🤖 Bot ID: ${botId}`);
        streamManager = new StreamManager(config.agent, botId, config.voice);
      }

      // 2. Audio
      if ((msg.event || msg.type) === 'transcript.data') {
        const words = msg.data.data?.words || [];
        
        if (words.length > 0) {
          // 🛑 INTERRUPCIÓN: Si el usuario habla, CORTAMOS al bot
          if (streamManager) streamManager.stop();

          if (silenceTimer) clearTimeout(silenceTimer);

          words.forEach(w => currentUtterance.push(w.text));

          silenceTimer = setTimeout(() => {
            if (currentUtterance.length > 0 && streamManager) {
              const fullText = currentUtterance.join(' ');
              currentUtterance = []; 
              // Disparar respuesta
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
// 4. HTTP
// ════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('Recall Sync Core v2.0'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
