/**
 * Vercel 서버리스 함수: Supabase 누적 판별 사례 조회 API (/api/cases)
 * - 저장된 비식별 텍스트(이미지 변환 텍스트 포함) 목록과 누적 건수를 반환합니다.
 * - Supabase 환경 변수가 아직 설정되지 않았더라도 오류 대신 configured: false 상태를 반환합니다.
 */

import { listStoredCases } from './_supabase.js';

/**
 * Vercel 서버리스 핸들러 (/api/cases)
 * @param {object} req HTTP 요청
 * @param {object} res HTTP 응답
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      errorCode: 'METHOD_NOT_ALLOWED',
      message: 'GET 요청만 지원합니다.'
    });
  }

  try {
    const urlObj = new URL(req.url || '/api/cases', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit') || 8);
    const scamType = (urlObj.searchParams.get('scamType') || '').trim();

    const result = await listStoredCases({ limit, scamType });

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      errorCode: 'CASES_FETCH_FAILED',
      message: error?.message || '누적 사례를 불러오는 중 오류가 발생했습니다.'
    });
  }
}
