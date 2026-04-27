require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));


// Helper: escape special regex characters in a word
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper: find which content words appear in a summary (handles basic inflections)
function findWordsInSummary(contentWords, summary) {
  const summaryLower = summary.toLowerCase();
  return contentWords.filter(w => {
    const root = escapeRegex(w.toLowerCase());
    const regex = new RegExp(`\\b${root}(s|es|ed|ing|er|est|ly)?\\b`, 'i');
    return regex.test(summaryLower);
  });
}

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── POST /api/generate-passage ───────────────────────────────────────────────
app.post('/api/generate-passage', async (req, res) => {
  const { level, paragraphCount, topic } = req.body;

  if (![1, 2, 3].includes(Number(level))) {
    return res.status(400).json({ error: 'level must be 1, 2, or 3' });
  }
  if (![1, 2, 3].includes(Number(paragraphCount))) {
    return res.status(400).json({ error: 'paragraphCount must be 1, 2, or 3' });
  }

  const levelMap = {
    1: 'Level 1 Easy — short, simple sentences; common everyday words; concrete, relatable topics. Write EXACTLY 3 sentences per paragraph.',
    2: 'Level 2 Moderate — varied sentence structure; broader vocabulary; some abstract ideas allowed. Write EXACTLY 4 sentences per paragraph.',
    3: 'Level 3 Advanced — complex sentences; sophisticated vocabulary; nuanced or abstract ideas. Write EXACTLY 5 sentences per paragraph.',
  };

  // Per-level word counts (change 4)
  const wordConfig = {
    1: { contentCount: 6, distractorCount: 2 },
    2: { contentCount: 10, distractorCount: 5 },
    3: { contentCount: 10, distractorCount: 5 },
  };
  const { contentCount, distractorCount } = wordConfig[Number(level)];

  const randomSeed = Math.floor(Math.random() * 1000) + 1;
  const topicLine = topic && topic.trim()
    ? `The passage must be about: ${topic.trim()}`
    : `Randomization seed for this session: ${randomSeed}. Use this to guide your topic selection toward something unexpected and different.

Select a unique and interesting non-fiction topic for this passage. You have complete creative freedom to choose from any area of human knowledge including but not limited to: the natural world, science, history, geography, culture, food, art, music, architecture, exploration, crafts, technology, health, animals, plants, oceans, weather, astronomy, archaeology, anthropology, philosophy, language, sports, transportation, agriculture, medicine, economics, literature, film, theater, dance, fashion, design, engineering, mathematics, psychology, sociology, mythology, religion, folklore, and everyday life around the world. Be creative and unexpected in your topic selection — choose topics that are interesting, educational, and engaging for adult readers. Avoid obvious or overused topics. Surprise the reader with something they may not have thought about before.

This passage must be completely unique. Do not repeat topics, themes, or subject matter from previous passages. Each session should feel like opening a different page of an encyclopedia — always something new.`;

  const prompt = `You are creating a non-fiction reading therapy passage for an adult patient with aphasia. Write in a confident, informative, and engaging tone suitable for adult readers.

CONTENT SAFETY: This is a clinical therapy setting. The passage must be calm, positive, and neutral. Never include: self-harm, suicide, violence, abuse, racism, discrimination, extremism, sexual content, substance abuse, or politically divisive topics.

NON-FICTION ACCURACY RULES — follow these strictly to avoid hallucinations:
- Only include facts that are widely known and verifiable by any educated adult.
- Do NOT include specific statistics, percentages, exact dates, or precise measurements unless they are extremely well-established (e.g. "water boils at 100 degrees Celsius" is acceptable; "studies show 73% of people..." is not).
- Do NOT name specific people, organizations, brands, or places unless they are universally well-known (e.g. the Great Wall of China, the Amazon River).
- If you are uncertain about a specific fact, describe the concept in general terms rather than stating a specific claim.
- Every sentence must be factually accurate. Do not invent details to fill space.

READING LEVEL: ${levelMap[Number(level)]}
NUMBER OF PARAGRAPHS: ${Number(paragraphCount)}
TOPIC: ${topicLine}

ALSO PROVIDE:
1. Exactly ${contentCount} key CONTENT WORDS from the passage — meaningful nouns, verbs, or adjectives representing the main ideas. NOT function words like "the", "a", "is", "are", "was", "and", "but", "or", "in", "on", "to", "of", "for", "with", "that", "this", "it", "he", "she", "they", "we", "you", "I". Spread them across the passage.
2. Exactly ${distractorCount} DISTRACTOR words completely unrelated to the passage topic — from a totally different domain so they are obviously out of place (e.g., if the passage is about bees: "glacier", "parliament", "cavalry", "telescope", "invoice").

Return ONLY a single valid JSON object — no markdown, no explanation, no code block:
{
  "passage": "Paragraph one text.\\n\\nParagraph two text.",
  "contentWords": ${JSON.stringify(Array.from({ length: contentCount }, (_, i) => `word${i + 1}`))},
  "distractorWords": ${JSON.stringify(Array.from({ length: distractorCount }, (_, i) => `word${i + 1}`))}
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in Claude response');

    const data = JSON.parse(jsonMatch[0]);

    if (
      typeof data.passage !== 'string' ||
      !Array.isArray(data.contentWords)  || data.contentWords.length  !== contentCount ||
      !Array.isArray(data.distractorWords) || data.distractorWords.length !== distractorCount
    ) {
      throw new Error(`Claude response schema mismatch (expected ${contentCount} content, ${distractorCount} distractor words)`);
    }

    res.json(data);
  } catch (err) {
    console.error('[generate-passage] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate passage. Please try again.' });
  }
});

// ── POST /api/get-feedback ───────────────────────────────────────────────────
app.post('/api/get-feedback', async (req, res) => {
  const { passage, summary, contentWords, vocabCorrect, vocabMissed } = req.body;

  if (!passage || !summary) {
    return res.status(400).json({ error: 'passage and summary are required' });
  }
  if (!Array.isArray(contentWords) || contentWords.length === 0) {
    return res.status(400).json({ error: 'contentWords array is required' });
  }

  // Server-side objective scoring (changes 7 & 8)
  const scoreDenominator = contentWords.length;
  const wordsUsedInSummary = findWordsInSummary(contentWords, summary);
  const scoreNumerator = wordsUsedInSummary.length;

  const correctList = Array.isArray(vocabCorrect) && vocabCorrect.length > 0
    ? vocabCorrect.join(', ') : 'none';
  const missedList  = Array.isArray(vocabMissed)  && vocabMissed.length  > 0
    ? vocabMissed.join(', ')  : 'none';

  const prompt = `You are a speech-language pathology assistant helping an adult patient with aphasia. Provide feedback in two clearly separated sections. Be warm but genuinely constructive — specific and honest, never generic or empty.

THE PASSAGE:
---
${passage}
---

KEY WORDS from this passage (${scoreDenominator} total): ${contentWords.join(', ')}

THE PATIENT'S SUMMARY:
"${summary}"

OBJECTIVE DATA:
- Key words the patient used in their summary: ${wordsUsedInSummary.length > 0 ? wordsUsedInSummary.join(', ') : 'none'}
- Vocabulary score: ${scoreNumerator}/${scoreDenominator} key words used in summary
- Words correctly identified in the word exercise: ${correctList}
- Words missed in the word exercise: ${missedList}

SECTION A — MAIN IDEA (1-2 sentences):
Evaluate whether the patient communicated the main idea of the passage. This must be assessed independently from vocabulary use — a patient may convey the main idea accurately using their own words without using the key vocabulary, and this should be recognized and praised. Be specific: name which elements of the main idea they captured, and gently name any important elements they missed. Do not comment on vocabulary here.

SECTION B — VOCABULARY (1 sentence only):
State the fraction score (${scoreNumerator}/${scoreDenominator}) and give one sentence of specific feedback about their vocabulary use. If they used passage words, acknowledge them by name. If they used vague or general language instead, gently encourage them to use precise words from the passage next time. Do not comment on main idea here.

Tone for both sections: warm, supportive, clinically professional. Every sentence must directly reference the patient's actual summary or specific passage content. Never use empty phrases like "great job!" without substance.

Return ONLY valid JSON (no markdown, no code block):
{
  "mainIdeaFeedback": "1-2 sentences on main idea only.",
  "vocabularyFeedback": "Exactly 1 sentence on vocabulary, starting with the fraction score."
}`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in Claude response');

    const data = JSON.parse(jsonMatch[0]);
    if (typeof data.mainIdeaFeedback !== 'string' || typeof data.vocabularyFeedback !== 'string') {
      throw new Error('Claude response did not match expected schema');
    }

    res.json({
      mainIdeaFeedback: data.mainIdeaFeedback,
      vocabularyFeedback: data.vocabularyFeedback,
      wordsUsed: wordsUsedInSummary,
      scoreNumerator,
      scoreDenominator,
    });
  } catch (err) {
    console.error('[get-feedback] Error:', err.message);
    res.status(500).json({ error: 'Failed to get feedback. Please try again.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ReadWell backend running on http://localhost:${PORT}`);
});
