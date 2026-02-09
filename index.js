const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

console.log('坦克大战服务器启动在 :8080');

// 简易的游戏状态
let gameState = {
  players: {}, // 存储玩家: '1': {x,y,dir...}, '2': {x,y...}
  bullets: [],
  enemies: [],
  gameOver: false
};

// 简单的地图数据 (1=砖块, 0=空)
// 这里为了演示，硬编码几个墙壁
const mapWalls = [
  { x: 200, y: 100, w: 20, h: 100 },
  { x: 400, y: 200, w: 100, h: 20 },
  { x: 300, y: 300, w: 20, h: 20 },
  { x: 150, y: 250, w: 60, h: 20 }
];

let connections = {}; // id -> ws
let playerCount = 0;

// 广播状态
function broadcast() {
  const data = JSON.stringify({ type: 'update', state: gameState });
  Object.values(connections).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// 游戏循环 (30 FPS)
setInterval(() => {
  if (playerCount < 1) return; // 没人就不跑逻辑
  updateGame();
  broadcast();
}, 33);

// 生成敌人
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
  const pid = playerCount <= 1 ? '1' : '2'; // 简单分配 ID 1 和 2
  connections[pid] = ws;

  console.log(`玩家 ${pid} 加入`);

  // 初始化玩家位置
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

  // 发送初始信息
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

    // 简单的边界和墙壁检测
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
  // 更新子弹
  gameState.bullets.forEach(b => {
    const speed = 6;
    if (b.dir === 'up') b.y -= speed;
    if (b.dir === 'down') b.y += speed;
    if (b.dir === 'left') b.x -= speed;
    if (b.dir === 'right') b.x += speed;

    // 出界
    if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 400) b.active = false;
    
    // 撞墙
    if (checkCollision(b.x, b.y, b.w, b.h)) b.active = false;
  });

  // 更新敌人
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

    // 随机开火
    if (Math.random() < 0.02) {
      gameState.bullets.push({
        x: e.x+15, y: e.y+15, dir: e.dir, owner: 'enemy', w: 4, h: 4, active: true
      });
    }
  });

  // 碰撞判定 (子弹打坦克)
  gameState.bullets.forEach(b => {
    if (!b.active) return;
    
    // 打敌人
    if (b.owner !== 'enemy') {
      gameState.enemies.forEach(e => {
        if (e.active && rectIntersect(b, e)) {
          e.active = false;
          b.active = false;
        }
      });
    }

    // 打玩家
    Object.values(gameState.players).forEach(p => {
      if (p.active && b.owner !== p.id && rectIntersect(b, p)) {
        p.active = false;
        b.active = false;
      }
    });
  });

  // 清理
  gameState.bullets = gameState.bullets.filter(b => b.active);
  gameState.enemies = gameState.enemies.filter(e => e.active);
}

function checkCollision(x, y, w, h) {
  // 检查墙壁
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
}
