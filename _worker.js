export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kv = env.USER_DATA;

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 后台登录
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      if (username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD) {
        return new Response('OK', {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new Response('Unauthorized', { status: 401 });
    }

    // 用户登录
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      const storedUser = await kv.get(`user:${username}`);
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        if (userData.password === password) {
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
      return new Response('Invalid credentials', { status: 401 });
    }

    // 获取表格结构和用户信息
    if (url.pathname === '/api/form' && request.method === 'GET') {
      const username = url.searchParams.get('username');
      const formStructure = await kv.get('form:structure') || JSON.stringify({
        name: '域名信息登记',
        fields: [
          { name: 'phone', type: 'tel', label: '手机号', placeholder: '请输入11位手机号码，例如：13812345678' },
          { name: 'email', type: 'email', label: '邮箱', placeholder: '请输入有效的邮箱地址，例如：user@example.com' },
          { name: 'domain1', type: 'text', label: '域名1', placeholder: '请输入完整域名，例如：example.com' },
          { name: 'domain1_ns', type: 'text', label: '域名1 NS记录（一行一条）', placeholder: '请输入NS记录，每行一条，例如：ns1.example.com\nns2.example.com' },
          { name: 'domain2', type: 'text', label: '域名2', placeholder: '请输入完整域名，例如：example2.com' },
          { name: 'domain2_ns', type: 'text', label: '域名2 NS记录（一行一条）', placeholder: '请输入NS记录，每行一条，例如：ns1.example2.com\nns2.example2.com' },
          { name: 'domain3', type: 'text', label: '域名3', placeholder: '请输入完整域名，例如：example3.com' },
          { name: 'domain3_ns', type: 'text', label: '域名3 NS记录（一行一条）', placeholder: '请输入NS记录，每行一条，例如：ns1.example3.com\nns2.example3.com' }
        ],
      });
      const userData = username ? await kv.get(`user:${username}`) : null;
      const response = {
        form: JSON.parse(formStructure),
        info: userData ? JSON.parse(userData).info : {},
        lastUpdated: userData ? JSON.parse(userData).lastUpdated : null
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 保存用户信息并发送 Telegram 通知
    if (url.pathname === '/api/save' && request.method === 'POST') {
      const { username, data } = await request.json();
      const storedUser = await kv.get(`user:${username}`);
      if (!storedUser) return new Response('User not found', { status: 404 });
      const userData = JSON.parse(storedUser);
      userData.info = data;
      userData.lastUpdated = new Date().toISOString();
      await kv.put(`user:${username}`, JSON.stringify(userData));

      const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID;
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const message = `用户 ${username} 更新了信息：\n` +
          Object.entries(data).map(([key, value]) => `${key}: ${value}`).join('\n') +
          `\n提交时间: ${userData.lastUpdated}`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
          }),
        });
      }

      return new Response('Submitted', { status: 200 });
    }

    // 后台：获取所有用户信息
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`) return new Response('Unauthorized', { status: 401 });
      const users = [];
      const list = await kv.list({ prefix: 'user:' });
      for (const key of list.keys) {
        const userData = await kv.get(key.name);
        users.push(JSON.parse(userData));
      }
      return new Response(JSON.stringify(users), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // 后台：生成新用户
    if (url.pathname === '/api/admin/create-user' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`) return new Response('Unauthorized', { status: 401 });
      const { username, password } = await request.json();
      await kv.put(`user:${username}`, JSON.stringify({ username, password, info: {}, lastUpdated: null }));
      return new Response('User created', { status: 200 });
    }

    // 后台：设置表格结构
    if (url.pathname === '/api/admin/set-form' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`) return new Response('Unauthorized', { status: 401 });
      const formData = await request.json();
      await kv.put('form:structure', JSON.stringify(formData));
      return new Response('Form updated', { status: 200 });
    }

    // 后台：更新公告
    if (url.pathname === '/api/admin/update-announcements' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`) return new Response('Unauthorized', { status: 401 });
      const announcements = await request.json();
      await kv.put('announcements', JSON.stringify(announcements));
      return new Response('Announcements updated', { status: 200 });
    }

    // 获取公告
    if (url.pathname === '/api/announcements' && request.method === 'GET') {
      const announcements = await kv.get('announcements') || '[]';
      return new Response(announcements, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    return new Response('Not Found', { status: 404 });
  },
};
