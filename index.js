const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const wss = new WebSocket.Server({ port: 8080 });

console.log('坦克大战服务器启动在 :8080');

// --- GitHub 存储配置 ---
// 请设置环境变量或在此处填入 Token (不推荐硬编码)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE';
const REPO_OWNER = 'jklovelove';
const REPO_NAME = 'tank-battle-backend';
const DATA_PATH = 'data/users.json';

// 本地内存数据库
let persistentData = { users: [] };
let dataSha = null; // 用于 GitHub API 更新

// 初始化：拉取 GitHub 数据
async function loadDataFromGitHub() {
  if (GITHUB_TOKEN === 'YOUR_GITHUB_TOKEN_HERE') {
    console.warn('警告: 未设置 GITHUB_TOKEN，数据将不会保存到 GitHub');
    return;
  }
  
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
    const res = await axios.get(url, {
      headers: { 
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    dataSha = res.data.sha;
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    persistentData = JSON.parse(content);
    console.log('成功从 GitHub 加载数据:', persistentData);
  } catch (error) {
    console.error('从 GitHub 加载数据失败:', error.message);
  }
}

// 保存：推送到 GitHub
async function saveDataToGitHub() {
  if (GITHUB_TOKEN === 'YOUR_GITHUB_TOKEN_HERE') return;
  
  try {
    const content = JSON.stringify(persistentData, null, 2);
    const contentBase64 = Buffer.from(content).toString('base64');
    
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
    const body = {
      message: 'Update game data via Server',
      content: contentBase64,
      sha: dataSha
    };
    
    const res = await axios.put(url, body, {
      headers: { 
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    dataSha = res.data.content.sha;
    console.log('数据已保存到 GitHub');
  } catch (error) {
    console.error('保存到 GitHub 失败:', error.response ? error.response.data : error.message);
    // 如果发生 SHA 冲突，应该重新拉取再尝试，这里简化处理
    if (error.response && error.response.status === 409) {
      console.log('检测到冲突，重新拉取数据...');
      await loadDataFromGitHub();
    }
  }
}

// 启动时加载
loadDataFromGitHub();

// --- 游戏逻辑 ---

let gameState = {
  players: {}, 
  bullets: [],
  enemies: [],
  gameOver: false
};

const mapWalls = [
  { x: 200, y: 100, w: 20, h: 100 },
  { x: 400, y: 200, w: 100, h: 20 },
  { x: 300, y: 300, w: 20, h: 20 },
  { x: 150, y: 250, w: 60, h: 20 }
];

let connections = {}; 
let playerCount = 0;

function broadcast() {
  const data = JSON.stringify({ type: 'update', state: gameState });
  Object.values(connections).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

setInterval(() => {
  if (playerCount < 1) return; 
  updateGame();
  broadcast();
}, 33);

setInterval(() => {
  if (gameState.enemies.length < 4 && !gameState.gameOver) {
    gameState.enemies.push({
      id: Math.random().toString(36).substr(2, 9),
      x: Math.random() * 600,
      y: 0,
      w: 30, h: 30,
      dir: 'down',
      active: true,
      moveTimer: 0
    });
  }
}, 3000);

wss.on('connection', (ws) => {
  playerCount++;
  const pid = playerCount <= 1 ? '1' : '2'; 
  connections[pid] = ws;

  console.log(`玩家 ${pid} 加入`);
  
  // 记录用户登录（简单模拟）
  if (!persistentData.users.find(u => u.id === pid)) {
    persistentData.users.push({ id: pid, joinTime: new Date().toISOString(), score: 0 });
    saveDataToGitHub(); // 保存新用户
  }

  gameState.players[pid] = {
    id: pid,
    x: pid === '1' ? 50 : 600,
    y: 300,
    w: 30, h: 30,
    dir: 'up',
    color: pid === '1' ? '#FFFF00' : '#00FF00',
    active: true,
    score: 0
  };

  ws.send(JSON.stringify({ type: 'init', pid: pid, map: mapWalls }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'input') {
        handleInput(pid, msg.payload);
      }
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    console.log(`玩家 ${pid} 离开`);
    delete connections[pid];
    delete gameState.players[pid];
    playerCount--;
    if (playerCount === 0) resetGame();
  });
});

function handleInput(pid, input) {
  const p = gameState.players[pid];
  if (!p || !p.active) return;

  const speed = 4;
  if (input.cmd === 'move') {
    p.dir = input.dir;
    let newX = p.x;
    let newY = p.y;

    if (p.dir === 'up') newY -= speed;
    if (p.dir === 'down') newY += speed;
    if (p.dir === 'left') newX -= speed;
    if (p.dir === 'right') newX += speed;

    if (!checkCollision(newX, newY, p.w, p.h)) {
      p.x = newX;
      p.y = newY;
    }
  } else if (input.cmd === 'fire') {
    gameState.bullets.push({
      x: p.x + 15, y: p.y + 15,
      dir: p.dir,
      owner: pid,
      w: 4, h: 4,
      active: true
    });
  }
}

function updateGame() {
  gameState.bullets.forEach(b => {
    const speed = 6;
    if (b.dir === 'up') b.y -= speed;
    if (b.dir === 'down') b.y += speed;
    if (b.dir === 'left') b.x -= speed;
    if (b.dir === 'right') b.x += speed;

    if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 400) b.active = false;
    if (checkCollision(b.x, b.y, b.w, b.h)) b.active = false;
  });

  gameState.enemies.forEach(e => {
    if (!e.active) return;
    e.moveTimer++;
    if (e.moveTimer > 50) {
      e.moveTimer = 0;
      e.dir = ['up','down','left','right'][Math.floor(Math.random()*4)];
    }
    let nx = e.x, ny = e.y;
    if (e.dir === 'up') ny -= 2;
    if (e.dir === 'down') ny += 2;
    if (e.dir === 'left') nx -= 2;
    if (e.dir === 'right') nx += 2;

    if (!checkCollision(nx, ny, e.w, e.h) && nx > 0 && nx < 700 && ny > 0 && ny < 380) {
      e.x = nx; e.y = ny;
    }

    if (Math.random() < 0.02) {
      gameState.bullets.push({
        x: e.x+15, y: e.y+15, dir: e.dir, owner: 'enemy', w: 4, h: 4, active: true
      });
    }
  });

  gameState.bullets.forEach(b => {
    if (!b.active) return;
    
    if (b.owner !== 'enemy') {
      gameState.enemies.forEach(e => {
        if (e.active && rectIntersect(b, e)) {
          e.active = false;
          b.active = false;
          
          // 增加击杀记录并保存
          const user = persistentData.users.find(u => u.id === b.owner);
          if (user) {
             user.score = (user.score || 0) + 10;
             // 优化：不要每次击杀都保存，可以定时保存或游戏结束保存
             // 这里为了演示“实时”，每100分保存一次
             if (user.score % 100 === 0) saveDataToGitHub();
          }
        }
      });
    }

    Object.values(gameState.players).forEach(p => {
      if (p.active && b.owner !== p.id && rectIntersect(b, p)) {
        p.active = false;
        b.active = false;
        saveDataToGitHub(); // 玩家死亡保存一次数据
      }
    });
  });

  gameState.bullets = gameState.bullets.filter(b => b.active);
  gameState.enemies = gameState.enemies.filter(e => e.active);
}

function checkCollision(x, y, w, h) {
  for (let wall of mapWalls) {
    if (rectIntersect({x, y, w, h}, wall)) return true;
  }
  return false;
}

function rectIntersect(r1, r2) {
  return !(r2.x > r1.x + r1.w || 
           r2.x + r2.w < r1.x || 
           r2.y > r1.y + r1.h || 
           r2.y + r2.h < r1.y);
}

function resetGame() {
  gameState.bullets = [];
  gameState.enemies = [];
  saveDataToGitHub(); // 游戏重置时确保数据保存
}
