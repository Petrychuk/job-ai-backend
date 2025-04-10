// server.mjs
import dotenv from 'dotenv';
dotenv.config();
import google from 'googlethis';

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
    return fallback;
  }
}

// 🔍 Google Search
async function searchWithGoogle(keywords, roles) {
  const query = `${keywords.slice(0, 5).join(' ')} ${roles.join(' OR ')} site:.au jobs`;
  const options = { page: 0, safe: false, parse_ads: false };
  const response = await google.search(query, options);
  return response.results.map(r => ({
    title: r.title,
    description: r.description,
    link: r.url
  }));
}

// 🔍 AI фильтрация ссылок
async function filterJobLinksWithAI(resume, googleResults) {
  const prompt = `You are a job relevance assistant. You will receive a resume and a list of web search results (title, snippet, url). Your task is to identify and extract job postings relevant to the resume. Return a JSON array of objects with the following format:

[
  {
    "title": "Job Title",
    "company": "Company Name (if found)",
    "link": "URL",
    "date": "if found",
    "reason": "why it's relevant"
  }
]

Resume:
${resume.trim()}

Results:
${JSON.stringify(googleResults, null, 2)}`;

  const messages = [{ role: 'user', content: prompt }];
  const reply = await getCompletion(messages);
  return JSON.parse(reply);
}

// 📍 Расширенная проверка локации
function isInAustralia(location = '') {
  const loc = location.toLowerCase();
  return ['australia', 'sydney', 'remote au', 'remote australia', 'austr.', 'syd'].some(k => loc.includes(k));
}

// 🔍 Smart job search powered by AI keyword extraction + Google fallback
app.post('/api/search', async (req, res) => {
  const { cleanResume } = req.body;
  const resume = cleanResume;

  if (!resume) return res.status(400).json({ error: 'Missing resume' });

  try {
    const { keywords, roles } = await extractKeywords(resume);
    console.log('✅ Extracted keywords:', keywords);

    const sources = [
      fetch('https://remotive.io/api/remote-jobs?limit=100').then(r => r.json()),
      fetch('https://remoteok.com/api').then(r => r.json()),
      fetch(`https://api.adzuna.com/v1/api/jobs/au/search/1?app_id=${process.env.ADZUNA_APP_ID}&app_key=${process.env.ADZUNA_APP_KEY}&results_per_page=50`).then(r => r.json())
    ];

    const results = await Promise.allSettled(sources);
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

    const filtered = allJobs.filter(job => {
      const date = new Date(job.publication_date || job.date || job.created_at);
      const location = `${job.candidate_required_location || job.location?.display_name || job.location || ''}`.toLowerCase();
      const text = `${job.title || ''} ${job.description || job.snippet || job.summary || ''}`.toLowerCase();
      const hasKeyword = keywords.some(kw => text.includes(kw));
      return date >= twoMonthsAgo && isInAustralia(location) && hasKeyword;
    });

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

    const apiJobs = [...unique.values()];
    console.log('✅ API Matched jobs:', apiJobs.length);

    // 🔍 Google fallback
        const googleQuery = `site:jobsearch.gov.au ${roles.join(' OR ')} ${keywords.join(' OR ')} australia`;
    const googleResults = await google.search(googleQuery, { page: 0, safe: false });
    const googleJobs = googleResults.results.filter(r =>
      r.url.includes('jobsearch.gov.au') &&
      (keywords.some(kw => r.title.toLowerCase().includes(kw)) ||
       roles.some(role => r.title.toLowerCase().includes(role)))
    ).map(job => ({
      title: job.title,
      link: job.url,
      company: job.description || '',
      date: new Date().toISOString(),
      score: Math.floor(Math.random() * 3) + 8
    }));

    console.log('🔎 Google results:', googleResults.results.length);
    console.log('✅ Filtered Google jobs:', googleJobs.length);

    const combined = [...apiJobs, ...googleJobs];
    const final = combined.filter((job, index, self) => index === self.findIndex(j => j.link === job.link));

    res.json({ jobs: final });
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
