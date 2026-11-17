/**
 * Vercel 서버리스 함수: 스미싱 대응 훈련 시나리오 생성 API (/api/train)
 * - 사기 유형(기관사칭·택배·지원금·지인사칭·대출)과 난이도(쉬움·보통·어려움)에 맞는 교육용 가상 문자를 생성합니다.
 * - Supabase에 축적된 최신 비식별 사례 패턴을 안전 규칙으로 정화해 참고 컨텍스트로 반영합니다.
 * - PRD 5.4 안전 규칙을 프롬프트와 후처리 양쪽에서 모두 검증·적용합니다.
 */

import {
  TRAIN_DIFFICULTIES,
  TRAIN_SCAM_TYPES,
  callOpenRouterJson,
  parseJsonBody,
  validateAndNormalizeTrainResult
} from './_openrouter.js';
import {
  fetchRecentCasesByType,
  formatTrainReferencePatterns,
  isSupabaseConfigured
} from './_supabase.js';

// 훈련 시나리오 생성 시스템 프롬프트 (PRD 5.4, 5.5 반영)
const TRAIN_SYSTEM_PROMPT = `당신은 한국어 스미싱 예방 교육 시나리오 출제자입니다.
사용자가 안전하게 대응법을 연습할 수 있도록 교육용 가상 스미싱 문자를 1건 생성하고, 반드시 순수 JSON 객체만 출력하세요.

[절대 준수 안전 규칙]
1. 실제 작동하는 URL이나 단축 주소를 절대 넣지 마세요. 링크가 필요하면 반드시 "https://example.com/check" 또는 "example.com" 같은 예약 도메인만 사용하세요.
2. 실제 전화번호나 계좌번호를 쓰지 말고, "000-0000-0000" 또는 "02-000-0000" 같은 가상 번호만 사용하세요.
3. 실제 정부기관·기업·은행·택배사 이름을 쓰지 말고, 반드시 "○○기관", "○○택배", "○○은행", "○○지원센터" 같은 가상 명칭만 사용하세요.
4. 이미 알려진 스미싱 수법을 교육용으로 재현하는 수준으로만 작성하고, 보안 우회나 악용 요령은 절대 포함하지 마세요.

[난이도 기준]
- 쉬움: 오탈자, 노골적인 긴급성, 낯선 링크 등 위험 신호가 명확히 보임
- 보통: 공공기관·택배·금융 안내 문체를 흉내 내지만 확인 시 허점이 드러남
- 어려움: 일상적인 알림이나 지인 대화처럼 자연스러워 한 번 더 의심해야 구별 가능

[출력 JSON 스키마]
{
  "scam_type": "기관사칭 | 택배 | 지원금 | 지인사칭 | 대출",
  "difficulty": "쉬움 | 보통 | 어려움",
  "message": "교육용 가상 문자 본문 (반드시 가상 명칭과 example.com, 000-0000-0000만 사용)",
  "choices": ["신고하기", "삭제하기", "링크 누르기", "적힌 번호로 전화하기", "가족에게 확인하기"],
  "best_choices": ["가장 적절한 대응 선택지 1~3개 (반드시 신고하기, 삭제하기, 가족에게 확인하기 중에서만 선택)"],
  "signals": [
    {
      "text": "message 안에 그대로 포함된 위험 표현 문자열",
      "category": "긴급성 | 기관사칭 | URL | 앱설치 | 개인정보요구 | 금전요구",
      "reason": "왜 위험 신호인지 해설"
    }
  ],
  "explanation": "정답 선택 이유와 핵심 예방법 해설 (2~3문장)",
  "easy_explanation": "고령층과 초보자도 쉽게 이해할 수 있는 쉬운 말 해설 (1~2문장)"
}`;

/**
 * Vercel 서버리스 핸들러 함수 (/api/train)
 * @param {object} req HTTP 요청
 * @param {object} res HTTP 응답
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      errorCode: 'METHOD_NOT_ALLOWED',
      message: 'POST 요청만 지원합니다.'
    });
  }

  try {
    const body = await parseJsonBody(req);
    const scamType =
      typeof body?.scamType === 'string' && TRAIN_SCAM_TYPES.includes(body.scamType)
        ? body.scamType
        : '기관사칭';
    const difficulty =
      typeof body?.difficulty === 'string' && TRAIN_DIFFICULTIES.includes(body.difficulty)
        ? body.difficulty
        : '보통';

    // Supabase에 축적된 해당 유형 비식별 수법 사례를 최대 2건 조회해 안전하게 프롬프트에 반영
    const recentCases = isSupabaseConfigured() ? await fetchRecentCasesByType(scamType, 2) : [];
    const referenceBlock = formatTrainReferencePatterns(recentCases);

    const userPrompt = [
      `사기 유형: "${scamType}"`,
      `난이도: "${difficulty}"`,
      `요청 번호: ${Date.now() % 10000}`,
      referenceBlock,
      '위 조건에 맞는 새로운 교육용 가상 스미싱 문자 1건을 위 JSON 스키마로 생성해 주세요.\n다시 한 번 확인: 실제 기관명·은행명·택배사명, 실제 전화번호, 실제 도메인(example.com 제외)을 절대 넣지 마세요.'
    ]
      .filter(Boolean)
      .join('\n\n');

    // 훈련 시나리오는 다양성을 위해 temperature를 약간 높게(0.65) 설정 (PRD 5.5)
    const result = await callOpenRouterJson({
      messages: [
        { role: 'system', content: TRAIN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.65,
      maxTokens: 1300
    });

    const normalized = validateAndNormalizeTrainResult(result.data, scamType, difficulty);

    return res.status(200).json({
      ok: true,
      source: 'openrouter',
      model: result.model,
      latencyMs: result.latencyMs,
      ragUsedCount: recentCases.length,
      scenario: normalized
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      ok: false,
      errorCode: error?.errorCode || 'TRAIN_FAILED',
      message: error?.message || '훈련 시나리오 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
    });
  }
}

