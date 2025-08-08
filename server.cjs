const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();

app.use(express.json());

// 静态资源托管（dist为React打包目录）
app.use(express.static(path.join(__dirname, 'dist')));

// 代理接口
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers, body } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const fetchOptions = {
      method: method || 'GET',
      headers: headers || {},
    };
    // 只有非GET才带body
    if (fetchOptions.method !== 'GET' && body) {
      fetchOptions.body = body;
    }
    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type');
    res.set('Access-Control-Allow-Origin', '*');
    res.status(response.status);
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      res.json(data);
    } else {
      const text = await response.text();
      res.send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 只处理非 /api/ 路径的前端路由
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 启动服务
app.listen(3889, () => console.log('Server running on http://localhost:3889'));