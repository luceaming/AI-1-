/**
 * 로컬 개발 및 프리뷰 실행용 순수 Node.js HTTP 서버입니다.
 * - 프레임워크나 빌드 도구 없이 정적 파일(index.html, style.css, script.js)과
 *   Vercel 서버리스 함수(api/*.js)를 포트 3000에서 함께 서빙합니다.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import analyzeHandler from './api/analyze.js';
import trainHandler from './api/train.js';
import healthHandler from './api/health.js';

// 현재 파일 기준 프로젝트 루트 경로 계산
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * .env.local 및 .env 파일을 읽어 process.env에 주입합니다.
 * 이미 운영 환경에 주입된 변수는 덮어쓰지 않습니다.
 */
function loadLocalEnvFiles() {
  const envFiles = ['.env.local', '.env'];
  for (const filename of envFiles) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env) || !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

loadLocalEnvFiles();

// 확장자별 MIME 타입 매핑
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

/**
 * Vercel 스타일의 res.status(code).json(payload) 헬퍼를 Node ServerResponse에 연결합니다.
 * @param {http.ServerResponse} res Node 응답 객체
 * @returns {http.ServerResponse} 확장된 응답 객체
 */
function adaptVercelResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

/**
 * HTTP 요청을 라우팅하는 메인 서버 생성
 */
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // 1. Vercel API 라우트 처리 (/api/*)
  if (pathname === '/api/analyze') {
    return analyzeHandler(req, adaptVercelResponse(res));
  }
  if (pathname === '/api/train') {
    return trainHandler(req, adaptVercelResponse(res));
  }
  if (pathname === '/api/health') {
    return healthHandler(req, adaptVercelResponse(res));
  }

  // 2. 정적 파일 서빙 (보안상 .env, api/, server.js, scripts/ 직접 접근 차단)
  const blockedPrefixes = ['/api/', '/scripts/', '/tests/', '/.env', '/server.js', '/package.json'];
  if (blockedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('접근이 제한된 경로입니다.');
  }

  const targetRelPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(__dirname, targetRelPath);

  // 디렉터리 탈출 공격(Path Traversal) 방지
  if (!resolvedPath.startsWith(__dirname + path.sep) && resolvedPath !== path.join(__dirname, 'index.html')) {
    res.statusCode = 403;
    return res.end('잘못된 경로입니다.');
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('요청한 파일을 찾을 수 없습니다.');
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  fs.createReadStream(resolvedPath).pipe(res);
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SafeText Trainer 로컬 서버 실행 중: http://0.0.0.0:${PORT}`);
});
