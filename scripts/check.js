/**
 * 빌드 도구 없이 순수 JS 문법 및 필수 파일 존재 여부를 검증하는 스크립트입니다.
 * npm run build 및 npm run lint 실행 시 호출됩니다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 프로젝트 루트 경로
const rootDir = process.cwd();

// 배포 환경에서도 반드시 존재해야 하는 핵심 프로덕션 파일 목록
const requiredFiles = [
  'index.html',
  'style.css',
  'script.js',
  'api/_openrouter.js',
  'api/analyze.js',
  'api/train.js',
  'api/health.js'
];

// 문법 검사를 수행할 JS 파일 목록 (로컬 전용 파일은 존재할 때만 검사)
const jsFiles = [
  'script.js',
  'api/_openrouter.js',
  'api/analyze.js',
  'api/train.js',
  'api/health.js',
  'scripts/local-server.js',
  'tests/safetext.test.js'
];

// 1. 필수 파일 존재 여부 확인
for (const relPath of requiredFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`[검증 실패] 필수 파일이 없습니다: ${relPath}`);
    process.exit(1);
  }
}

// 2. Node.js 내장 문법 검사(--check) 실행
for (const relPath of jsFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    execFileSync(process.execPath, ['--check', fullPath], { stdio: 'inherit' });
  }
}

// 3. 클라이언트 코드(script.js)에 OpenRouter 키/직접 호출이 섞이지 않았는지 점검
const clientCode = fs.readFileSync(path.join(rootDir, 'script.js'), 'utf8');
if (clientCode.includes('openrouter.ai') || clientCode.includes('process.env.OPENROUTER_API_KEY')) {
  console.error('[보안 검증 실패] 브라우저 코드(script.js)에서 OpenRouter를 직접 참조할 수 없습니다.');
  process.exit(1);
}

console.log('[검증 통과] 순수 HTML/CSS/JS 및 Vercel 서버리스 API 구문 검사를 완료했습니다.');
