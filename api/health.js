/**
 * Vercel 서버리스 함수: 서버 상태 및 OpenRouter 설정 여부 확인 (/api/health)
 * 보안상 실제 API 키 문자열은 절대 반환하지 않고 설정 여부(boolean)만 알려줍니다.
 */

import { getOpenRouterModel } from './_openrouter.js';

/**
 * Vercel 서버리스 핸들러 함수
 * @param {object} req HTTP 요청
 * @param {object} res HTTP 응답
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, message: 'GET 요청만 지원합니다.' });
  }

  const hasApiKey = Boolean(
    (process.env.OPENROUTER_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')
  );

  return res.status(200).json({
    ok: true,
    hasApiKey,
    model: getOpenRouterModel()
  });
}
