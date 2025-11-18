// ════════════════════════════════════════════════════════════════
// server.js - FASE 5: PROD READY (Fluidez + Fix Primer Audio)
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// ⚡ CALIBRACIÓN DE FLUIDEZ
const SILENCE_THRESHOLD_MS = 600; 
const CHARS_PER_SECOND = 15; 
const MIN_CHUNK_LENGTH = 50; 
const FIRST_MESSAGE_DELAY_MS = 1200; // 🟢 TIEMPO EXTRA PARA EL PRIMER DESMUTEO

console.log('🚀 Servidor WebSocket: PRODUCTION READY');

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
// 2. GESTOR DE STREAMING
// ════════════════════════════════════════════════════════════════

class StreamManager {
  constructor(agentConfig, botId, voiceConfig) {
    this.agentName = agentConfig.name;
    this.agentRole = agentConfig.role;
    this.botId = botId;
    this.voiceId = voiceConfig.id;
    this.conversationHistory = [];
    
    this.audioQueue = []; 
    this.isProcessingQueue = false;
    this.currentWaitTimer = null;
    this.isInterrupted = false;
    
    // 🟢 ESTADO PARA EL FIX DEL PRIMER AUDIO
    this.isFirstInteraction = true; 
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

  stop() {
    this.isInterrupted = true;
    this.audioQueue = []; 
    if (this.currentWaitTimer) {
      clearTimeout(this.currentWaitTimer);
      this.currentWaitTimer = null;
    }
    this.isProcessingQueue = false;
    console.log('🛑 Interrupción.');
  }

  async processUserMessage(userText) {
    if (!userText.trim()) return;
    
    console.log(`📝 Usuario: "${userText}"`);
    this.addToHistory('user', userText);
    this.isInterrupted = false; 

    const systemPrompt = `
    Eres ${this.agentName}, ${this.agentRole}.
    INSTRUCCIONES DE VOZ:
    1. Habla fluido y natural.
    2. Evita frases robóticas muy cortas.
    3. Sé cálida, empática y profesional.
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
          max_tokens: 300
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

                if (sentenceBuffer.match(/[.?!;]/)) {
                   const isLongEnough = sentenceBuffer.length > MIN_CHUNK_LENGTH;
                   const isQuestion = sentenceBuffer.includes('?');
                   
                   if (isLongEnough || isQuestion) {
                       const match = sentenceBuffer.match(/[.?!;]/g); 
                       const lastPunctuationChar = match[match.length - 1];
                       const lastIndex = sentenceBuffer.lastIndexOf(lastPunctuationChar);

                       const completeChunk = sentenceBuffer.substring(0, lastIndex + 1);
                       const remainder = sentenceBuffer.substring(lastIndex + 1);
                       
                       if (completeChunk.trim().length > 0) {
                          this.queueAudio(completeChunk.trim());
                          sentenceBuffer = remainder;
                       }
                   }
                }
              }
            } catch (e) {}
          }
        }
      }

      if (sentenceBuffer.trim().length > 0 && !this.isInterrupted) {
        this.queueAudio(sentenceBuffer.trim());
      }

      if (!this.isInterrupted) this.addToHistory(this.agentName, fullResponse);

    } catch (error) {
      console.error('❌ Error Stream:', error.message);
    }
  }

  // --- COLA DE AUDIO CON FIX DE ARRANQUE ---
  queueAudio(text) {
    if (this.isInterrupted) return;
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

      // 🟢 FIX DE ARRANQUE: SI ES LA PRIMERA VEZ, ESPERAMOS
      if (this.isFirstInteraction) {
        console.log(`🔌 Primer mensaje: Esperando ${FIRST_MESSAGE_DELAY_MS}ms para desmuteo...`);
        await new Promise(resolve => setTimeout(resolve, FIRST_MESSAGE_DELAY_MS));
        this.isFirstInteraction = false; // Ya no esperamos más en las siguientes
      }

      const text = this.audioQueue.shift();
      
      try {
        await this.generateAndSendAudio(text);
        
        // Calculamos espera normal para sincronizar
        const durationMs = (text.length / CHARS_PER_SECOND) * 1000;
        const waitTime = Math.max(500, durationMs - 200); 
        
        console.log(`🔊 Reproduciendo: "${text}" (${Math.round(waitTime)}ms)`);
        
        await new Promise(resolve => {
          this.currentWaitTimer = setTimeout(resolve, waitTime);
        });

      } catch (e) {
        console.error('Audio Error:', e.message);
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
        model: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.7 },
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

app.get('/', (req, res) => res.send('Recall Engine v5.0 (Stable)'));
const server = app.listen(port, () => console.log(`📡 Puerto ${port}`));

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
