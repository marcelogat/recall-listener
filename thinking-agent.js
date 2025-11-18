const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * 🧠 AGENTE PENSANTE - Evalúa la reunión en tiempo real
 * Este agente piensa continuamente sobre lo que está pasando
 */
class ThinkingAgent {
  constructor(meetingId, agentConfig) {
    this.meetingId = meetingId;
    this.agent = agentConfig.agent;
    this.conversationBuffer = [];
    this.thinkingHistory = [];
    this.lastThinkingTime = 0;
    this.thinkingCooldown = 20000; // Pensar cada 20 segundos
    this.speakerStats = new Map();
    this.meetingStartTime = Date.now();
    
    console.log('\n🧠═══════════════════════════════════════════════════════');
    console.log('🧠 AGENTE PENSANTE ACTIVADO');
    console.log('🧠 Voy a estar pensando y evaluando la reunión en tiempo real');
    console.log('🧠═══════════════════════════════════════════════════════\n');
  }

  /**
   * Procesa cada utterance de la reunión
   */
  async processUtterance(fullText, metadata) {
    try {
      const { speakerName, speakerId, isAgentSpeaking } = metadata;

      // Agregar al buffer
      this.conversationBuffer.push({
        speaker: speakerName,
        text: fullText,
        timestamp: Date.now(),
        isAgent: isAgentSpeaking
      });

      // Actualizar estadísticas
      this.updateStats(speakerId, speakerName, fullText);

      // Análisis inmediato de lo que acaba de pasar
      this.quickThink(fullText, speakerName, isAgentSpeaking);

      // Limitar buffer
      if (this.conversationBuffer.length > 30) {
        this.conversationBuffer.shift();
      }

      // Pensar profundamente si es el momento
      if (this.shouldThinkNow()) {
        await this.deepThink();
      }

    } catch (error) {
      console.error('❌ Error en processUtterance:', error.message);
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
    
    if (text.includes('?') || this.hasQuestionPattern(text)) {
      stats.questions++;
    }
  }

  /**
   * Pensamiento rápido sobre cada intervención
   */
  quickThink(text, speaker, isAgent) {
    const lowerText = text.toLowerCase();

    // Detectar confusión
    const confusionWords = ['no entiendo', 'no me queda claro', 'confuso', 'no sé', 
                            'no comprendo', 'no capto', 'perdón', 'cómo', 'qué dijiste'];
    if (confusionWords.some(word => lowerText.includes(word))) {
      console.log(`🧠 🤔 [PENSANDO] ${speaker} parece confundido: "${text.substring(0, 60)}..."`);
      console.log(`🧠    → Puede necesitar aclaración`);
    }

    // Detectar objeciones
    const objectionWords = ['pero', 'sin embargo', 'no estoy de acuerdo', 'el problema es',
                            'no creo que', 'me preocupa', 'no estoy seguro'];
    if (objectionWords.some(word => lowerText.includes(word))) {
      console.log(`🧠 ⚠️  [PENSANDO] ${speaker} tiene una objeción: "${text.substring(0, 60)}..."`);
      console.log(`🧠    → Hay que abordar esta preocupación`);
    }

    // Detectar entusiasmo
    const enthusiasmWords = ['excelente', 'perfecto', 'genial', 'me encanta', 'buenísimo',
                             'brillante', 'increíble', 'fantástico', 'dale'];
    if (enthusiasmWords.some(word => lowerText.includes(word))) {
      console.log(`🧠 ✨ [PENSANDO] ${speaker} está entusiasmado`);
    }

    // Detectar decisiones importantes
    const decisionWords = ['entonces vamos', 'decidido', 'hagamos', 'acordamos', 'quedamos en'];
    if (decisionWords.some(word => lowerText.includes(word))) {
      console.log(`🧠 ⚡ [DECISIÓN] ${speaker}: "${text.substring(0, 70)}..."`);
    }

    // Detectar preguntas sin responder
    if (text.includes('?') && !isAgent) {
      console.log(`🧠 ❓ [PREGUNTA] ${speaker}: "${text.substring(0, 70)}..."`);
      console.log(`🧠    → Monitoreando si se responde...`);
    }
  }

  /**
   * Decide si es momento de pensar profundamente
   */
  shouldThinkNow() {
    const now = Date.now();
    const timeSinceLastThinking = now - this.lastThinkingTime;

    if (timeSinceLastThinking < this.thinkingCooldown) {
      return false;
    }

    if (this.conversationBuffer.length < 3) {
      return false;
    }

    return true;
  }

  /**
   * Pensamiento profundo - Evalúa el estado de la reunión
   */
  async deepThink() {
    try {
      const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 60000);
      
      console.log('\n🧠╔════════════════════════════════════════════════════════════╗');
      console.log('🧠║              EVALUANDO LA REUNIÓN...                       ║');
      console.log('🧠╚════════════════════════════════════════════════════════════╝');
      console.log(`🧠 ⏱️  Llevamos ${elapsed} minutos`);
      console.log(`🧠 💬 Analizando últimas ${this.conversationBuffer.length} intervenciones\n`);
      
      this.lastThinkingTime = Date.now();

      // Preparar contexto
      const conversationText = this.conversationBuffer
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      // Incluir pensamientos previos para continuidad
      const previousThoughts = this.thinkingHistory.slice(-3)
        .map(t => `- ${t.mainInsight}`)
        .join('\n');

      const evaluationPrompt = `Sos un analista experto de reuniones. Estás evaluando esta reunión EN TIEMPO REAL.

CONTEXTO:
- Duración actual: ${elapsed} minutos
- Participantes: ${this.speakerStats.size}

${previousThoughts ? `MIS PENSAMIENTOS PREVIOS:\n${previousThoughts}\n` : ''}

CONVERSACIÓN RECIENTE:
${conversationText}

Tu tarea es PENSAR y EVALUAR como un observador experto. Necesito que:

1. **¿Qué está pasando REALMENTE ahora?** (no solo el tema, sino la dinámica)
2. **¿Cómo está la energía?** (comprometida, dispersa, tensa, productiva)
3. **¿Están avanzando o dando vueltas?**
4. **¿Hay alguien que no está participando o se lo está perdiendo?**
5. **¿Hay señales de confusión, frustración o desacuerdo no expresado?**
6. **¿Qué necesita esta reunión AHORA mismo?**
7. **¿Cuál es tu lectura de la situación?** (insight principal)

Sé directo y honesto. Como si estuvieras pensando en voz alta mientras observás.

Responde en JSON:
{
  "situationAnalysis": "qué está pasando realmente (2-3 oraciones directas)",
  "energyLevel": "alta|media|baja|dispersa|tensa",
  "progressStatus": "avanzando|estancado|dando_vueltas|productivo",
  "participationIssues": "descripción de problemas de participación o null",
  "underlyingTension": "tensión o problema no expresado o null",
  "whatThisMeetingNeedsNow": "qué necesita la reunión ahora mismo",
  "mainInsight": "tu principal insight/lectura de la situación",
  "concernLevel": "bajo|medio|alto - qué tan preocupante es lo que ves"
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'Eres un analista experto que piensa en voz alta mientras observa reuniones. Eres directo, perspicaz y honesto. Respondes en JSON válido.'
            },
            {
              role: 'user',
              content: evaluationPrompt
            }
          ],
          temperature: 0.8,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI error: ${response.status}`);
      }

      const data = await response.json();
      const evaluation = JSON.parse(data.choices[0].message.content);

      // Guardar en historial
      this.thinkingHistory.push({
        timestamp: Date.now(),
        ...evaluation
      });

      // Mostrar la evaluación
      this.displayEvaluation(evaluation);

      return evaluation;

    } catch (error) {
      console.error('🧠 ❌ Error pensando:', error.message);
      return null;
    }
  }

  /**
   * Muestra la evaluación en el log de forma clara
   */
  displayEvaluation(eval) {
    console.log('🧠');
    console.log('🧠 💭 MI EVALUACIÓN:');
    console.log(`🧠 ${eval.situationAnalysis}`);
    console.log('🧠');
    
    // Emoji según energía
    const energyEmoji = {
      'alta': '⚡',
      'media': '📊',
      'baja': '😴',
      'dispersa': '💭',
      'tensa': '😰'
    };
    console.log(`🧠 ${energyEmoji[eval.energyLevel] || '📊'} ENERGÍA: ${eval.energyLevel.toUpperCase()}`);
    
    // Emoji según progreso
    const progressEmoji = {
      'avanzando': '🚀',
      'estancado': '🛑',
      'dando_vueltas': '🔄',
      'productivo': '✅'
    };
    console.log(`🧠 ${progressEmoji[eval.progressStatus] || '📊'} PROGRESO: ${eval.progressStatus.replace('_', ' ').toUpperCase()}`);
    console.log('🧠');

    if (eval.participationIssues) {
      console.log(`🧠 👥 PARTICIPACIÓN:`);
      console.log(`🧠    ${eval.participationIssues}`);
      console.log('🧠');
    }

    if (eval.underlyingTension) {
      console.log(`🧠 ⚠️  TENSIÓN DETECTADA:`);
      console.log(`🧠    ${eval.underlyingTension}`);
      console.log('🧠');
    }

    console.log(`🧠 💡 LO QUE NECESITA ESTA REUNIÓN AHORA:`);
    console.log(`🧠    ${eval.whatThisMeetingNeedsNow}`);
    console.log('🧠');

    console.log(`🧠 🎯 INSIGHT PRINCIPAL:`);
    console.log(`🧠    ${eval.mainInsight}`);
    console.log('🧠');

    // Nivel de preocupación con colores
    const concernEmoji = {
      'bajo': '🟢',
      'medio': '🟡',
      'alto': '🔴'
    };
    console.log(`🧠 ${concernEmoji[eval.concernLevel] || '🟡'} NIVEL DE PREOCUPACIÓN: ${eval.concernLevel.toUpperCase()}`);
    
    // Estadísticas de participación
    console.log('🧠');
    console.log('🧠 📊 PARTICIPACIÓN:');
    for (const [id, stats] of this.speakerStats.entries()) {
      const avgWords = Math.round(stats.totalWords / stats.interventions);
      const timeSinceSpoke = Math.floor((Date.now() - stats.lastSpoke) / 1000);
      console.log(`🧠    👤 ${stats.name}: ${stats.interventions} intervenciones, ${avgWords} palabras/promedio`);
      if (timeSinceSpoke > 120 && stats.interventions > 0) {
        console.log(`🧠       ⚠️  No habla hace ${Math.floor(timeSinceSpoke/60)} minutos`);
      }
    }
    
    console.log('🧠╚════════════════════════════════════════════════════════════╝\n');
  }

  /**
   * Detecta patrones de pregunta
   */
  hasQuestionPattern(text) {
    const questionWords = [
      'qué', 'quién', 'cómo', 'cuándo', 'dónde', 'por qué', 'cuál',
      'que', 'quien', 'como', 'cuando', 'donde', 'porque', 'cual',
      'podés', 'podes', 'podría', 'podrias'
    ];
    
    const lowerText = text.toLowerCase();
    return questionWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`);
      return regex.test(lowerText);
    });
  }

  /**
   * Obtiene un resumen del estado actual
   */
  getCurrentState() {
    const lastThought = this.thinkingHistory[this.thinkingHistory.length - 1];
    const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 60000);

    return {
      duration: elapsed,
      totalSpeakers: this.speakerStats.size,
      totalInterventions: this.conversationBuffer.length,
      lastEvaluation: lastThought ? {
        energy: lastThought.energyLevel,
        progress: lastThought.progressStatus,
        concern: lastThought.concernLevel,
        insight: lastThought.mainInsight
      } : null
    };
  }

  /**
   * Genera evaluación final (llamar al cerrar la conexión)
   */
  async getFinalThoughts() {
    try {
      const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 60000);
      
      console.log('\n🧠╔════════════════════════════════════════════════════════════╗');
      console.log('🧠║            MIS PENSAMIENTOS FINALES                        ║');
      console.log('🧠╚════════════════════════════════════════════════════════════╝');
      console.log(`🧠 📊 Reunión de ${elapsed} minutos observada\n`);

      // Resumen de mis pensamientos durante la reunión
      console.log('🧠 🧵 EVOLUCIÓN DE MIS PENSAMIENTOS:');
      this.thinkingHistory.forEach((thought, i) => {
        const minuteMark = Math.floor((thought.timestamp - this.meetingStartTime) / 60000);
        console.log(`🧠 [Min ${minuteMark}] ${thought.mainInsight}`);
      });
      console.log('🧠');

      // Evaluación final más profunda
      const allConversation = this.conversationBuffer
        .map(msg => `${msg.speaker}: ${msg.text}`)
        .join('\n');

      const finalPrompt = `Has estado observando esta reunión de ${elapsed} minutos. 

Tus pensamientos durante la reunión fueron:
${this.thinkingHistory.map((t, i) => `${i+1}. ${t.mainInsight}`).join('\n')}

CONVERSACIÓN COMPLETA:
${allConversation}

Ahora que terminó, dame tu evaluación final como analista experto:

1. ¿Fue productiva esta reunión? ¿Por qué?
2. ¿Qué funcionó bien?
3. ¿Qué no funcionó?
4. ¿Hay algo que quedó sin resolver?
5. ¿Qué recomendás para la próxima?

Sé honesto y directo. JSON:
{
  "overallAssessment": "evaluación general (3-4 oraciones)",
  "wasProductive": true/false,
  "whyProductive": "explicación",
  "whatWorked": ["punto1", "punto2"],
  "whatDidntWork": ["punto1", "punto2"],
  "unresolved": ["punto1", "punto2"],
  "recommendations": ["recomendación1", "recomendación2"],
  "rating": 1-10,
  "oneLineVerdict": "tu veredicto en una línea"
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'Eres un analista experto que da feedback honesto sobre reuniones.' },
            { role: 'user', content: finalPrompt }
          ],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      const data = await response.json();
      const final = JSON.parse(data.choices[0].message.content);

      // Mostrar evaluación final
      console.log('🧠 🎯 EVALUACIÓN FINAL:');
      console.log(`🧠 ${final.overallAssessment}`);
      console.log('🧠');
      console.log(`🧠 ${final.wasProductive ? '✅' : '❌'} ¿Productiva? ${final.wasProductive ? 'SÍ' : 'NO'}`);
      console.log(`🧠    ${final.whyProductive}`);
      console.log('🧠');

      if (final.whatWorked.length > 0) {
        console.log('🧠 ✅ QUÉ FUNCIONÓ:');
        final.whatWorked.forEach(item => console.log(`🧠    • ${item}`));
        console.log('🧠');
      }

      if (final.whatDidntWork.length > 0) {
        console.log('🧠 ❌ QUÉ NO FUNCIONÓ:');
        final.whatDidntWork.forEach(item => console.log(`🧠    • ${item}`));
        console.log('🧠');
      }

      if (final.unresolved.length > 0) {
        console.log('🧠 ⚠️  QUEDÓ SIN RESOLVER:');
        final.unresolved.forEach(item => console.log(`🧠    • ${item}`));
        console.log('🧠');
      }

      if (final.recommendations.length > 0) {
        console.log('🧠 💡 RECOMENDACIONES:');
        final.recommendations.forEach(item => console.log(`🧠    • ${item}`));
        console.log('🧠');
      }

      console.log(`🧠 ⭐ RATING: ${final.rating}/10`);
      console.log('🧠');
      console.log(`🧠 📝 VEREDICTO:`);
      console.log(`🧠    "${final.oneLineVerdict}"`);
      console.log('🧠╚════════════════════════════════════════════════════════════╝\n');

      return final;

    } catch (error) {
      console.error('🧠 ❌ Error en pensamientos finales:', error.message);
      return null;
    }
  }
}

module.exports = { ThinkingAgent };
