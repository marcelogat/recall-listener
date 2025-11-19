const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

class ThinkingAgent {
  constructor(meetingId, agentConfig) {
    this.meetingId = meetingId;
    this.agent = agentConfig.agent;
    this.language = agentConfig.agent.language || 'es'; 
    
    // 🧠 MEMORIA DUAL
    this.conversationBuffer = []; // Memoria de trabajo (últimos 20-30 msgs)
    this.fullTranscript = [];     // Memoria a largo plazo (toda la reunión)
    
    this.thinkingHistory = [];
    this.lastThinkingTime = 0;
    this.speakerStats = new Map();
    this.meetingStartTime = Date.now();
    
    // Palabras clave dinámicas según idioma
    this.keywords = this.getKeywordsByLanguage(this.language);

    console.log(`🧠 AGENTE PENSANTE (${this.language}) ACTIVADO`);
  }

  getKeywordsByLanguage(lang) {
    if (lang && lang.startsWith('en')) {
      return {
        confusion: ['don\'t understand', 'unclear', 'confused', 'not sure', 'what do you mean'],
        objection: ['but', 'however', 'disagree', 'issue is', 'concern', 'not sure about'],
        enthusiasm: ['great', 'awesome', 'perfect', 'love it', 'brilliant', 'amazing'],
        decision: ['let\'s do', 'agreed', 'decided', 'action item', 'moving forward']
      };
    }
    // Default Español
    return {
      confusion: ['no entiendo', 'no me queda claro', 'confuso', 'no sé', 'no comprendo', 'perdón'],
      objection: ['pero', 'sin embargo', 'no estoy de acuerdo', 'el problema es', 'me preocupa'],
      enthusiasm: ['excelente', 'perfecto', 'genial', 'me encanta', 'buenísimo', 'brillante'],
      decision: ['entonces vamos', 'decidido', 'hagamos', 'acordamos', 'quedamos en']
    };
  }

  /**
   * Entry point principal (Wrapper síncrono para no bloquear audio)
   */
  async processUtterance(fullText, metadata) {
    this._processAsync(fullText, metadata).catch(err => console.error('❌ Error background thinking:', err));
  }

  /**
   * Lógica asíncrona de procesamiento
   */
  async _processAsync(fullText, metadata) {
    const { speakerName, speakerId, isAgentSpeaking } = metadata;
    const utteranceObj = {
      speaker: speakerName,
      text: fullText,
      timestamp: Date.now(),
      isAgent: isAgentSpeaking
    };

    // 1. Guardar en ambas memorias
    this.conversationBuffer.push(utteranceObj);
    this.fullTranscript.push(utteranceObj);

    // 2. Actualizar estadísticas (Aquí estaba el error antes)
    this.updateStats(speakerId, speakerName, fullText);
    
    // 3. Pensamiento rápido (Keywords)
    this.quickThink(fullText, speakerName, isAgentSpeaking);

    // Mantener buffer corto para el contexto inmediato de GPT
    if (this.conversationBuffer.length > 20) {
      this.conversationBuffer.shift();
    }

    // 4. Pensamiento profundo (LLM) si corresponde
    if (this.shouldThinkNow()) {
      await this.deepThink();
    }
  }

  /**
   * Actualiza estadísticas de participación
   */
  updateStats(speakerId, speakerName, text) {
    if (!this.speakerStats.has(speakerId)) {
      this.speakerStats.set(speakerId, {
        name: speakerName,
        interventions: 0,
        totalWords: 0,
        questions: 0,
        lastSpoke: 0
      });
    }

    const stats = this.speakerStats.get(speakerId);
    stats.interventions++;
    stats.totalWords += text.split(' ').length;
    stats.lastSpoke = Date.now();
    
    // Detección básica de preguntas para estadísticas
    if (text.includes('?') || this.hasQuestionPattern(text)) {
      stats.questions++;
    }
  }

  /**
   * Detecta patrones de pregunta (Helper para updateStats)
   */
  hasQuestionPattern(text) {
    const questionWords = [
      'qué', 'quién', 'cómo', 'cuándo', 'dónde', 'por qué', 'cuál',
      'que', 'quien', 'como', 'cuando', 'donde', 'porque', 'cual',
      'podés', 'podes', 'podría', 'podrias', 'what', 'who', 'how', 'when'
    ];
    
    const lowerText = text.toLowerCase();
    return questionWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`);
      return regex.test(lowerText);
    });
  }

  quickThink(text, speaker, isAgent) {
    if (isAgent) return; 
    
    const lowerText = text.toLowerCase();
    
    if (this.keywords.confusion.some(w => lowerText.includes(w))) {
      console.log(`🧠 🤔 [CONFUSIÓN DETECTADA] ${speaker}`);
    }
    if (this.keywords.objection.some(w => lowerText.includes(w))) {
      console.log(`🧠 ⚠️  [OBJECIÓN DETECTADA] ${speaker}`);
    }
    if (this.keywords.enthusiasm.some(w => lowerText.includes(w))) {
      console.log(`🧠 ✨ [ENTUSIASMO DETECTADO] ${speaker}`);
    }
  }

  shouldThinkNow() {
    const now = Date.now();
    
    // No pensar tan seguido (ahorro de costos)
    if (now - this.lastThinkingTime < 45000) return false; 
    
    // Solo pensar si alguien habló recientemente
    const lastMsgTime = this.conversationBuffer[this.conversationBuffer.length - 1]?.timestamp || 0;
    if (now - lastMsgTime > 10000) return false; 

    // Solo pensar si hubo al menos 3 intervenciones nuevas
    return this.conversationBuffer.filter(m => m.timestamp > this.lastThinkingTime).length >= 3;
  }

  async deepThink() {
    try {
      const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 60000);
      this.lastThinkingTime = Date.now();

      const conversationText = this.conversationBuffer
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const evaluationPrompt = `Analiza el estado actual de esta reunión.
CONTEXTO: ${elapsed} mins transcurridos.
CHAT RECIENTE:
${conversationText}

Responde en JSON:
{
  "situation": "breve resumen de lo que pasa ahora",
  "energy": "alta/media/baja/tensa",
  "insight": "observación clave del coach",
  "action_needed": "que debería hacer el bot si interviene ahora"
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Eres un analista de reuniones. Responde JSON.' },
            { role: 'user', content: evaluationPrompt }
          ],
          temperature: 0.6,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const evaluation = JSON.parse(data.choices[0].message.content);
      
      this.thinkingHistory.push({ timestamp: Date.now(), ...evaluation });
      this.displayEvaluation(evaluation);

    } catch (error) {
      console.error('🧠 ❌ Error thinking:', error.message);
    }
  }

  displayEvaluation(evaluation) {
    console.log('🧠 💭 PENSAMIENTO AUTOMÁTICO:');
    console.log(`🧠 Sit: ${evaluation.situation}`);
    console.log(`🧠 Insight: ${evaluation.insight}`);
  }

  async getFinalThoughts() {
    try {
      console.log('🧠 🏁 Generando reporte final...');
      
      const allConversation = this.fullTranscript
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const finalPrompt = `Analiza esta reunión completa y genera un reporte ejecutivo.
      
      HISTORIAL DE INSIGHTS:
      ${this.thinkingHistory.map(t => `- ${t.insight}`).join('\n')}
      
      TRANSCRIPCION COMPLETA:
      ${allConversation}
      
      Genera un JSON detallado con feedback, puntos clave y rating.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: finalPrompt }],
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);

    } catch (e) {
      console.error(e);
    }
  }
}

module.exports = { ThinkingAgent };
