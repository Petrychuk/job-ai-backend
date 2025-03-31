const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 4001;

app.use(cors());
app.use(express.json());

app.post('/api/search', (req, res) => {
  const { resume } = req.body;

  const jobs = [
    {
      title: 'Frontend Developer',
      company: 'Tech Corp',
      link: 'https://remoteok.com/frontend',
      score: 9
    },
    {
      title: 'Java Developer',
      company: 'Code Inc',
      link: 'https://remoteok.com/java',
      score: 4
    }
  ];

  const relevant = jobs.filter(job => job.score >= 5);

  res.json({ jobs: relevant });
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
