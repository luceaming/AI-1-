/**
 * Vercel 서버리스 함수: 스미싱 의심 문자 및 캡처 이미지 판별 API (/api/analyze)
 * - 텍스트 입력(P0)과 문자 캡처 이미지 입력(P2)을 모두 지원합니다.
 * - 원문 대조 검증을 거쳐 존재하지 않는 위험 표현 하이라이트를 제거합니다.
 */

import crypto from 'node:crypto';
import {
  callOpenRouterJson,
  validateAndNormalizeAnalyzeResult
} from './_openrouter.js';

// 판별 모드 시스템 프롬프트 (PRD 5.3, 5.5 설계 원칙 반영)
const ANALYZE_SYSTEM_PROMPT = `당신은 한국어 스미싱·보이스피싱 문자 판별 전문가입니다.
반드시 아래 규칙을 지켜 순수 JSON 객체만 출력하세요. 마크다운 코드 블록이나 설명 문장을 절대 붙이지 마세요.

[판별 기준]
1. 긴급성: "즉시", "오늘까지", "미납 시 압류/정지", "출석 요구" 등 심리적 압박
2. 기관사칭: 검찰, 경찰, 법원, 국세청, 건강보험, 은행, 택배사 등을 사칭
3. URL: 단축 URL(bit.ly 등), 낯선 도메인, 출처 불명 링크 클릭 유도
   - 중요 규칙: 정부·공공기관의 공식 안내 문자는 링크(URL)를 포함하지 않습니다. 공공기관 안내에 URL이 있으면 매우 높은 확률로 사기입니다.
4. 앱설치: APK 설치, 원격제어 앱 설치, 보안업데이트 파일 다운로드 유도
5. 개인정보요구: 신분증 사진, 비밀번호, 인증번호, 계좌 비밀번호 요구
6. 금전요구: 대금 결제, 소액결제, 계좌 이체, 상품권/핀번호 구매 요구

[과탐지 방지 정상 문자 예시(Few-shot)]
예시 1 (정상 은행 입금 알림):
입력: "[Web발신] 00은행 입출금 알림 홍*동님 계좌로 150,000원이 입금되었습니다. 잔액 820,000원"
출력: {"risk_score": 8, "risk_level": "안전", "scam_type": "해당없음", "extracted_text": "[Web발신] 00은행 입출금 알림 홍*동님 계좌로 150,000원이 입금되었습니다. 잔액 820,000원", "summary": "정상적인 거래 입금 알림 형식으로 URL이나 개인정보 요구가 없습니다.", "easy_summary": "안전한 은행 입금 알림 문자예요. 이상한 주소나 돈을 보내라는 말이 없어요.", "signals": [], "advice": ["정상적인 알림 문자로 보입니다.", "다만 잔액이나 거래 내역이 의심스러우면 공식 은행 앱에서 직접 확인하세요."]}

예시 2 (기관사칭 스미싱):
입력: "[검찰청] 사건번호 2026-412호 명의도용 피해 관련 즉시 출석요구서 확인 https://example.com/doc"
출력: {"risk_score": 92, "risk_level": "위험", "scam_type": "기관사칭", "extracted_text": "[검찰청] 사건번호 2026-412호 명의도용 피해 관련 즉시 출석요구서 확인 https://example.com/doc", "summary": "검찰을 사칭해 긴급 출석을 압박하고 출처 불명의 링크 클릭을 유도하는 전형적인 스미싱입니다.", "easy_summary": "검찰을 사칭한 가짜 사기 문자예요. 주소를 누르면 위험하니 바로 지우세요.", "signals": [{"text": "[검찰청]", "category": "기관사칭", "reason": "수사기관을 사칭해 신뢰와 공포심을 유발합니다."}, {"text": "즉시 출석요구서", "category": "긴급성", "reason": "긴급한 법적 조치를 암시해 판단력을 흐립니다."}, {"text": "https://example.com/doc", "category": "URL", "reason": "정부·수사기관은 문자로 사건 확인 링크를 보내지 않습니다."}], "advice": ["문자 속 URL을 절대 누르지 마세요.", "문자 번호로 전화하지 말고 경찰청 112 또는 KISA 118에 문의하세요.", "문자를 삭제하고 발신 번호를 차단하세요."]}

[출력 JSON 스키마]
{
  "risk_score": 0~100 정수,
  "risk_level": "안전 | 주의 | 위험",
  "scam_type": "기관사칭 | 택배 | 지원금 | 지인사칭 | 대출 | 기타 | 해당없음",
  "extracted_text": "텍스트 입력이면 원문 그대로, 이미지 입력이면 이미지 속 문자 내용을 정확히 옮겨 적기",
  "summary": "판별 이유 1~2문장 요약",
  "easy_summary": "어르신도 한눈에 이해할 수 있는 아주 쉬운 말 설명 1~2문장",
  "signals": [
    {
      "text": "원문(또는 extracted_text)에 토씨 하나 틀리지 않고 실제로 존재하는 정확한 부분 문자열",
      "category": "긴급성 | 기관사칭 | URL | 앱설치 | 개인정보요구 | 금전요구",
      "reason": "이 표현이 왜 위험한지 구체적 설명"
    }
  ],
  "advice": ["행동 안내 1", "행동 안내 2", "행동 안내 3"]
}

주의: signals[].text는 반드시 입력 원문에 그대로 들어있는 정확한 문자열이어야 합니다.`;

/**
 * 요청 본문을 JSON으로 안전하게 파싱합니다.
 * @param {object} req HTTP 요청 객체
 * @returns {Promise<object>} 파싱된 본문 객체
 */
async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

/**
 * Vercel 서버리스 핸들러 함수
 * @param {object} req HTTP 요청
 * @param {object} res HTTP 응답
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      errorCode: 'METHOD_NOT_ALLOWED',
      message: 'POST 요청만 지원합니다.'
    });
  }

  try {
    const body = await parseRequestBody(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const imageDataUrl =
      typeof body?.imageDataUrl === 'string' ? body.imageDataUrl.trim() : '';

    // 텍스트와 이미지가 모두 비어 있으면 400 오류 반환
    if (!text && !imageDataUrl) {
      return res.status(400).json({
        errorCode: 'EMPTY_INPUT',
        message: '분석할 문자 내용을 입력하거나 문자 캡처 이미지를 첨부해 주세요.'
      });
    }

    // 과도한 입력 길이 방지
    if (text.length > 3000) {
      return res.status(400).json({
        errorCode: 'TEXT_TOO_LONG',
        message: '문자 내용은 3,000자 이하로 입력해 주세요.'
      });
    }

    // 이미지 형식 간단 검증 (data:image/* 형식만 허용)
    if (imageDataUrl && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({
        errorCode: 'INVALID_IMAGE',
        message: 'PNG, JPG, WEBP 형식의 이미지 파일만 분석할 수 있습니다.'
      });
    }

    // 멀티모달 또는 텍스트 사용자 메시지 구성
    const userContent = [];
    if (text) {
      userContent.push({
        type: 'text',
        text: `다음 문자 메시지를 판별 스키마에 맞춰 JSON으로 분석해 주세요.\n\n[분석 대상 문자]\n${text}`
      });
    } else {
      userContent.push({
        type: 'text',
        text: '첨부된 문자 캡처 이미지의 내용을 먼저 extracted_text에 정확히 옮겨 적은 뒤, 스미싱 위험도를 판별 스키마 JSON으로 분석해 주세요.'
      });
    }

    if (imageDataUrl) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageDataUrl }
      });
    }

    // 동일 입력 캐시 키 생성 (개인정보를 서버 디스크/DB에 저장하지 않고 메모리 해시만 사용)
    const cacheHash = crypto
      .createHash('sha256')
      .update(`${text}|${imageDataUrl.slice(0, 200)}|${imageDataUrl.length}`)
      .digest('hex');

    const result = await callOpenRouterJson({
      messages: [
        { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      temperature: 0.15,
      maxTokens: 1500,
      cacheKey: `analyze:${cacheHash}`
    });

    const normalized = validateAndNormalizeAnalyzeResult(result.data, text);

    return res.status(200).json({
      ok: true,
      source: 'openrouter',
      cached: result.cached,
      model: result.model,
      latencyMs: result.latencyMs,
      result: normalized
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      ok: false,
      errorCode: error?.errorCode || 'ANALYZE_FAILED',
      message: error?.message || '문자 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
    });
  }
}
