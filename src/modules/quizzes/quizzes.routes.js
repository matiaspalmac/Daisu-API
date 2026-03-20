// routes/quizzes.js
import express from 'express';
import { db } from '../../config/database.js';
import { auth, adminOnly } from '../../../middleware/auth.js';
import { addXP } from '../achievements/achievements.service.js';
import { updateStreak } from '../../services/streaks.js';

const router = express.Router();

// ────────────────────────────────────────────
// HARDCODED QUESTION TEMPLATES PER LANGUAGE
// ────────────────────────────────────────────

const DAILY_QUESTIONS = {
  es: [
    { type: 'translate', prompt: "How do you say 'hello' in Spanish?", options: ['Hola', 'Adiós', 'Gracias', 'Por favor'], correct: 'Hola' },
    { type: 'fill_blank', prompt: 'Yo ___ estudiante. (ser)', options: ['soy', 'es', 'eres', 'somos'], correct: 'soy' },
    { type: 'translate', prompt: "What does 'gato' mean?", options: ['Dog', 'Cat', 'Bird', 'Fish'], correct: 'Cat' },
    { type: 'grammar', prompt: 'Which is correct?', options: ['Yo tengo hambre', 'Yo tiene hambre', 'Yo tienes hambre', 'Yo tenemos hambre'], correct: 'Yo tengo hambre' },
    { type: 'vocabulary', prompt: "The opposite of 'grande' is:", options: ['pequeño', 'alto', 'rápido', 'bonito'], correct: 'pequeño' },
  ],
  en: [
    { type: 'translate', prompt: "¿Cómo se dice 'gracias' en inglés?", options: ['Thank you', 'Please', 'Sorry', 'Hello'], correct: 'Thank you' },
    { type: 'fill_blank', prompt: 'She ___ a teacher. (be)', options: ['is', 'are', 'am', 'be'], correct: 'is' },
    { type: 'grammar', prompt: 'Which is correct?', options: ['I have been there', 'I has been there', 'I have be there', 'I having been there'], correct: 'I have been there' },
    { type: 'vocabulary', prompt: "A synonym for 'happy' is:", options: ['glad', 'sad', 'angry', 'tired'], correct: 'glad' },
    { type: 'translate', prompt: "¿Qué significa 'weather'?", options: ['Clima', 'Agua', 'Viento', 'Nube'], correct: 'Clima' },
  ],
  pt: [
    { type: 'translate', prompt: "Como se diz 'obrigado' em português?", options: ['Obrigado', 'Desculpa', 'Por favor', 'Olá'], correct: 'Obrigado' },
    { type: 'fill_blank', prompt: 'Eu ___ brasileiro. (ser)', options: ['sou', 'é', 'és', 'somos'], correct: 'sou' },
    { type: 'vocabulary', prompt: "O que significa 'casa'?", options: ['House', 'Car', 'Dog', 'Tree'], correct: 'House' },
    { type: 'grammar', prompt: 'Qual está correto?', options: ['Eu gosto de música', 'Eu gosta de música', 'Eu gostas de música', 'Eu gostamos de música'], correct: 'Eu gosto de música' },
    { type: 'translate', prompt: "How do you say 'book' in Portuguese?", options: ['Livro', 'Mesa', 'Cadeira', 'Porta'], correct: 'Livro' },
  ],
};

// ────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Deterministic-ish shuffle based on a seed (day of year). */
function seededShuffle(arr, seed) {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function generateDailyQuestions(language) {
  const templates = DAILY_QUESTIONS[language];
  if (!templates) return null;

  const seed = dayOfYear();
  // Shuffle question order
  const shuffledQuestions = seededShuffle(templates, seed);
  // Shuffle options within each question
  return shuffledQuestions.map((q, idx) => ({
    ...q,
    options: seededShuffle(q.options, seed + idx + 1),
  }));
}

function stripCorrectAnswers(questions) {
  return questions.map(({ correct, ...rest }) => rest);
}

// ────────────────────────────────────────────
// GET /api/quizzes/daily?language=es
// ────────────────────────────────────────────
router.get('/quizzes/daily', auth, async (req, res) => {
  const language = req.query.language || 'es';
  const today = todayDateStr();
  const userId = req.user.id;

  try {
    // Look for existing daily quiz
    let result = await db.execute({
      sql: 'SELECT * FROM quizzes WHERE is_daily = 1 AND daily_date = ? AND language = ?',
      args: [today, language],
    });

    let quiz = result.rows[0];

    // Auto-generate if none exists
    if (!quiz) {
      const questions = generateDailyQuestions(language);
      if (!questions) {
        return res.status(400).json({ error: `No quiz templates available for language: ${language}` });
      }

      const title = `Daily Quiz - ${language.toUpperCase()} - ${today}`;
      const insertResult = await db.execute({
        sql: `INSERT INTO quizzes (title, language, type, questions, is_daily, daily_date)
              VALUES (?, ?, 'vocabulary', ?, 1, ?)`,
        args: [title, language, JSON.stringify(questions), today],
      });

      const newId = Number(insertResult.lastInsertRowid);
      const fetchResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [newId] });
      quiz = fetchResult.rows[0];
    }

    // Check if user already attempted today
    const attemptResult = await db.execute({
      sql: 'SELECT id, score, total_questions FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?',
      args: [quiz.id, userId],
    });

    const questions = JSON.parse(quiz.questions);

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        language: quiz.language,
        level: quiz.level,
        type: quiz.type,
        daily_date: quiz.daily_date,
        questions: stripCorrectAnswers(questions),
        total_questions: questions.length,
      },
      already_attempted: attemptResult.rows.length > 0,
      previous_attempt: attemptResult.rows[0] || null,
    });
  } catch (e) {
    console.error('[quizzes/daily]', e);
    res.status(500).json({ error: 'Failed to load daily quiz' });
  }
});

// ────────────────────────────────────────────
// POST /api/quizzes/:id/attempt
// ────────────────────────────────────────────
router.post('/quizzes/:id/attempt', auth, async (req, res) => {
  const quizId = Number(req.params.id);
  const userId = req.user.id;
  const { answers } = req.body;

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'answers object is required' });
  }

  try {
    // Check if already attempted
    const existing = await db.execute({
      sql: 'SELECT id FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?',
      args: [quizId, userId],
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You have already attempted this quiz' });
    }

    // Load quiz
    const quizResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [quizId] });
    const quiz = quizResult.rows[0];
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const questions = JSON.parse(quiz.questions);
    const total = questions.length;
    let score = 0;
    const corrections = [];

    for (let i = 0; i < total; i++) {
      const q = questions[i];
      const userAnswer = answers[String(i)] || '';
      const isCorrect = userAnswer === q.correct;
      if (isCorrect) score++;
      corrections.push({
        index: i,
        prompt: q.prompt,
        your_answer: userAnswer,
        correct_answer: q.correct,
        is_correct: isCorrect,
      });
    }

    // Save attempt
    await db.execute({
      sql: `INSERT INTO quiz_attempts (quiz_id, user_id, score, total_questions, answers)
            VALUES (?, ?, ?, ?, ?)`,
      args: [quizId, userId, score, total, JSON.stringify(answers)],
    });

    // Award XP: score * 5
    const xpEarned = score * 5;
    if (xpEarned > 0) {
      await addXP(userId, xpEarned, 'quiz_completed', String(quizId));
    }

    // Update streak
    await updateStreak(userId);

    res.json({ score, total, xpEarned, corrections });
  } catch (e) {
    console.error('[quizzes/attempt]', e);
    res.status(500).json({ error: 'Failed to submit quiz attempt' });
  }
});

// ────────────────────────────────────────────
// GET /api/quizzes/:id/results
// ────────────────────────────────────────────
router.get('/quizzes/:id/results', auth, async (req, res) => {
  const quizId = Number(req.params.id);
  const userId = req.user.id;

  try {
    const attemptResult = await db.execute({
      sql: 'SELECT * FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?',
      args: [quizId, userId],
    });
    const attempt = attemptResult.rows[0];
    if (!attempt) {
      return res.status(404).json({ error: 'No attempt found for this quiz' });
    }

    const quizResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [quizId] });
    const quiz = quizResult.rows[0];
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const questions = JSON.parse(quiz.questions);
    const userAnswers = JSON.parse(attempt.answers);

    const results = questions.map((q, i) => ({
      index: i,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      correct_answer: q.correct,
      your_answer: userAnswers[String(i)] || '',
      is_correct: (userAnswers[String(i)] || '') === q.correct,
    }));

    res.json({
      quiz_id: quiz.id,
      title: quiz.title,
      language: quiz.language,
      score: attempt.score,
      total_questions: attempt.total_questions,
      completed_at: attempt.completed_at,
      results,
    });
  } catch (e) {
    console.error('[quizzes/results]', e);
    res.status(500).json({ error: 'Failed to load quiz results' });
  }
});

// ────────────────────────────────────────────
// GET /api/quizzes/history
// ────────────────────────────────────────────
router.get('/quizzes/history', auth, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.execute({
      sql: `SELECT qa.id, qa.quiz_id, qa.score, qa.total_questions, qa.completed_at,
                   q.title, q.language, q.type, q.is_daily, q.daily_date
            FROM quiz_attempts qa
            JOIN quizzes q ON q.id = qa.quiz_id
            WHERE qa.user_id = ?
            ORDER BY qa.completed_at DESC
            LIMIT 20`,
      args: [userId],
    });

    res.json({ history: result.rows });
  } catch (e) {
    console.error('[quizzes/history]', e);
    res.status(500).json({ error: 'Failed to load quiz history' });
  }
});

// ────────────────────────────────────────────
// GET /api/quizzes — list available (non-daily) quizzes
// ────────────────────────────────────────────
router.get('/quizzes', auth, async (req, res) => {
  const { language, type } = req.query;

  try {
    let sql = 'SELECT id, title, language, level, type, created_at FROM quizzes WHERE is_daily = 0';
    const args = [];

    if (language) {
      sql += ' AND language = ?';
      args.push(language);
    }
    if (type) {
      sql += ' AND type = ?';
      args.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await db.execute({ sql, args });
    res.json({ quizzes: result.rows });
  } catch (e) {
    console.error('[quizzes/list]', e);
    res.status(500).json({ error: 'Failed to list quizzes' });
  }
});

// ────────────────────────────────────────────
// POST /api/quizzes — create custom quiz (admin only)
// ────────────────────────────────────────────
router.post('/quizzes', auth, adminOnly, async (req, res) => {
  const { title, language, level, type, questions, is_daily, daily_date } = req.body;

  if (!title || !language || !questions) {
    return res.status(400).json({ error: 'title, language, and questions are required' });
  }

  // Validate questions is an array
  let parsedQuestions;
  try {
    parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
    if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
      return res.status(400).json({ error: 'questions must be a non-empty array' });
    }
  } catch {
    return res.status(400).json({ error: 'questions must be valid JSON array' });
  }

  try {
    const result = await db.execute({
      sql: `INSERT INTO quizzes (title, language, level, type, questions, created_by, is_daily, daily_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        title,
        language,
        level || '',
        type || 'vocabulary',
        JSON.stringify(parsedQuestions),
        req.user.id,
        is_daily ? 1 : 0,
        daily_date || '',
      ],
    });

    const newId = Number(result.lastInsertRowid);
    const fetchResult = await db.execute({ sql: 'SELECT * FROM quizzes WHERE id = ?', args: [newId] });

    res.status(201).json({ quiz: fetchResult.rows[0] });
  } catch (e) {
    console.error('[quizzes/create]', e);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

export default router;
