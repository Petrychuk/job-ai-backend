// server.mjs
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import OpenAI from 'openai';

const app = express();
const PORT = 4001;

app.use(cors());
app.use(express.json());

// ✅ INIT OpenAI (official)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔁 Универсальный флаг переключения
const USE_OPENAI = process.env.USE_OPENAI === 'true';

// 🔍 Keywords + Roles fallback
const fallback = {
  keywords: [
    'javascript', 'html', 'css', 'react', 'node.js', 'ci/cd', 'git',
    'sql', 'mysql', 'rest api', 'postman', 'playwright', 'agile', 'jira',
    'jenkins', 'swagger', 'mongodb', 'postgresql', 'nosql', 'java'
  ],
  roles: [
    'frontend developer', 'web developer', 'full-stack developer', 'qa engineer',
    'automation tester', 'ui engineer', 'software developer', 'junior developer',
    'quality assurance engineer', 'devops engineer'
  ]
};
// ✨ Extract relevant keywords from resume
async function extractKeywords(resume) {
  const prompt = `You are a job-matching assistant.
Based on the resume below, extract two things:

1. "keywords": the 15 most relevant skills, technologies, frameworks, or tools from the resume (in lowercase).
2. "roles": the most likely job titles this person would apply for (in lowercase). Include junior and mid-level options if relevant.

Return only valid JSON in this format:
{
  "keywords": [...],
  "roles": [...]
}

Resume:
${resume.trim()}`;

  const messages = [{ role: 'user', content: prompt }];

  try {
    if (USE_OPENAI) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.4
      });
      const raw = completion.choices[0].message.content;
      return JSON.parse(raw);
    } else {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://job-ai-agent.netlify.app/',
          'X-Title': 'Job AI Agent'
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
          messages,
          temperature: 0.4
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    }
  } catch (err) {
    console.error('❌ Failed to extract keywords:', err);
    return [];
  }
}

// 🔍 Match relevance
function isRelevant(job, keywords) {
  const text = `${job.title || ''} ${job.description || job.snippet || job.summary || ''}`.toLowerCase();
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

// 📍 Расширенная проверка локации
function isInAustralia(location = '') {
  const loc = location.toLowerCase();
  return ['australia', 'sydney', 'remote au', 'remote australia', 'austr.', 'syd'].some(k => loc.includes(k));
}

// 🔍 Smart job search powered by AI keyword extraction
app.post('/api/search', async (req, res) => {
  const { cleanResume } = req.body;
  const resume = cleanResume;

  if (!resume) return res.status(400).json({ error: 'Missing resume' });

  try {
    // 1️⃣ Извлекаем ключевые слова из резюме
    const { keywords, roles } = await extractKeywords(resume);
    console.log('✅ Extracted keywords:', keywords);
    if (!keywords.length) throw new Error('No keywords extracted');

    // 2️⃣ Получаем вакансии с разных источников
    const sources = [
      fetch('https://remotive.io/api/remote-jobs?limit=100').then(r => r.json()),
      fetch('https://remoteok.com/api').then(r => r.json()),
      fetch(`https://api.adzuna.com/v1/api/jobs/au/search/1?app_id=${process.env.ADZUNA_APP_ID}&app_key=${process.env.ADZUNA_APP_KEY}&results_per_page=50`).then(r => r.json())
    ];

    const results = await Promise.allSettled(sources);

    // 3️⃣ Сбор всех вакансий
    let allJobs = [];
    results.forEach(res => {
      if (res.status === 'fulfilled') {
        const jobs = Array.isArray(res.value.jobs) ? res.value.jobs : res.value.slice?.(1);
        if (jobs) allJobs.push(...jobs);
      }
    });

    console.log('📦 Total jobs fetched:', allJobs.length);

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    // 4️⃣ Фильтрация вакансий
    const filtered = allJobs.filter(job => {
  const date = new Date(job.publication_date || job.date || job.created_at);
  const location = `${job.candidate_required_location || job.location?.display_name || job.location || ''}`.toLowerCase();
  const description = `${job.description || job.snippet || job.summary || ''}`.toLowerCase();
  const title = `${job.title || ''}`.toLowerCase();
  const text = `${title} ${description}`;

  const hasKeyword = keywords.some(kw => text.includes(kw.toLowerCase()));
  const isRecent = date >= twoMonthsAgo;
  const inAustralia = isInAustralia(location);

  return hasKeyword && isRecent && inAustralia;
});


    // 5️⃣ Удаление дубликатов
    const unique = new Map();
    filtered.forEach(job => {
      const link = job.url || job.link;
      if (!unique.has(link)) {
        unique.set(link, {
          title: job.title,
          company: job.company || job.company_name || job.company?.display_name,
          date: job.publication_date || job.date || job.created_at,
          link,
          score: Math.floor(Math.random() * 3) + 8
        });
      }
    });

    const sorted = [...unique.values()].sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log('✅ Matched jobs:', sorted.length);
    res.json({ jobs: sorted });
  } catch (error) {
    console.error('🔴 Job search failed:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 🧠 UNIVERSAL AI request helper
async function getCompletion(messages) {
  if (USE_OPENAI) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7
    });
    return completion.choices[0].message.content;
  } else {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://job-ai-agent.netlify.app/',
        'X-Title': 'Job AI Agent'
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages,
        temperature: 0.7
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content;
  }
}

// ✨ Optimize Resume
app.post('/api/optimize-resume', async (req, res) => {
  const { resume, jobDescription } = req.body;
  const prompt = `Act as an ATS resume optimization assistant.\n\nYou will receive a candidate's resume and a job description.\n\nUpdate the resume by injecting missing relevant keywords, aligning with the job requirements, and enhancing it to pass Applicant Tracking Systems (ATS) without changing the original experience too much.\n\nReturn ONLY the optimized resume.\n\nResume:\n${resume}\n\nJob Description:\n${jobDescription}`;

  try {
    const optimized = await getCompletion([{ role: 'user', content: prompt }]);
    res.json({ optimizedResume: optimized });
  } catch (err) {
    console.error('Error optimizing resume:', err);
    res.status(500).json({ error: 'Failed to optimize resume' });
  }
});

// ✉️ Cover Letter
app.post('/api/cover-letter', async (req, res) => {
  const { resume, jobTitle, jobDescription } = req.body;
  const prompt = `Generate a professional and concise cover letter tailored to the job description below. Use the information from the resume to highlight relevant experience.\n\nResume:\n${resume}\n\nJob Title:\n${jobTitle}\n\nJob Description:\n${jobDescription}\n\nReturn only the cover letter in plain text.`;

  try {
    const letter = await getCompletion([{ role: 'user', content: prompt }]);
    res.json({ coverLetter: letter });
  } catch (err) {
    console.error('Error generating cover letter:', err);
    res.status(500).json({ error: 'Failed to generate cover letter' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
