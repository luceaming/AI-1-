/**
 * Supabase 연동, 개인정보 비식별 마스킹, 유사 사례 검색(RAG) 및 동적 프롬프트 주입을 담당하는 서버 전용 모듈입니다.
 * - 외부 npm 패키지 없이 Node.js 기본 fetch와 crypto만으로 Supabase PostgREST API를 호출합니다.
 * - 주의: 이 파일은 반드시 서버 측(api/ 폴더)에서만 실행되며 SUPABASE_SERVICE_ROLE_KEY는 브라우저에 노출되지 않습니다.
 */

import crypto from 'node:crypto';
import { sanitizeTrainingText } from './_openrouter.js';

// Supabase PostgREST 대상 테이블 이름
const TABLE_NAME = 'smishing_cases';

// 키워드 추출 시 제외할 일반 한국어 불용어 목록
const KOREAN_STOPWORDS = new Set([
  '입니다',
  '합니다',
  '하세요',
  '바랍니다',
  '주세요',
  '확인',
  '안내',
  '관련',
  '문자',
  '내용',
  '고객님',
  '귀하',
  '오늘',
  '지금',
  '바로',
  '문의',
  '전화번호',
  '계좌번호',
  '주민번호',
  '이메일'
]);

/**
 * 환경 변수에서 앞뒤 공백과 따옴표를 제거합니다.
 * @param {string} value 원본 환경 변수 문자열
 * @returns {string} 정제된 문자열
 */
function cleanEnvValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/**
 * Supabase 연결 설정을 조회합니다.
 * @returns {{ url: string, key: string, configured: boolean }} 연결 설정 정보
 */
export function getSupabaseConfig() {
  const url = cleanEnvValue(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key =
    cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    cleanEnvValue(process.env.SUPABASE_ANON_KEY);

  return {
    url,
    key,
    configured: Boolean(url && key && /^https?:\/\//i.test(url))
  };
}

/**
 * Supabase 연동이 활성화되어 있는지 확인합니다.
 * @returns {boolean} 설정 완료 여부
 */
export function isSupabaseConfigured() {
  return getSupabaseConfig().configured;
}

/**
 * DB 저장 전 사용자 텍스트(또는 이미지 OCR 추출 텍스트)에서 개인정보를 마스킹합니다.
 * 단, 스미싱 판별 학습에 핵심이 되는 의심 URL과 스미싱 문구 패턴은 유지합니다.
 * @param {string} text 원본 또는 OCR 추출 텍스트
 * @returns {string} 비식별 처리된 텍스트
 */
export function sanitizeTextForStorage(text) {
  if (typeof text !== 'string') return '';

  return text
    .trim()
    // 주민등록번호 마스킹
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[주민번호]')
    // 휴대폰 번호 마스킹 (010, 011 등)
    .replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '[전화번호]')
    // 일반 유선·인터넷·대표번호 마스킹 (02, 031, 070, 1588 등)
    .replace(/\b0(?:2|[3-6][1-5]|70)[-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '[전화번호]')
    .replace(/\b1[568]\d{2}[-\s.]?\d{4}\b/g, '[전화번호]')
    // 계좌번호 형태 마스킹
    .replace(/\b\d{3,6}-\d{2,6}-\d{4,7}(?:-\d{1,3})?\b/g, '[계좌번호]')
    // 이메일 주소 마스킹
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[이메일]')
    .slice(0, 3000);
}

/**
 * 비식별 텍스트의 공백을 정규화해 중복 판별용 SHA-256 해시를 계산합니다.
 * @param {string} text 비식별 텍스트
 * @returns {string} SHA-256 16진수 해시 문자열
 */
export function computeNormalizedHash(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * 문자 본문과 탐지 신호에서 RAG 유사 사례 검색용 키워드 배열을 추출합니다.
 * @param {string} text 비식별 문자 텍스트
 * @param {Array} [signals] 탐지된 위험 신호 배열
 * @returns {string[]} 최대 12개의 핵심 키워드 배열
 */
export function extractSearchKeywords(text, signals = []) {
  const keywords = new Set();

  // 1. 탐지된 위험 신호 카테고리 및 핵심 토큰 반영
  if (Array.isArray(signals)) {
    for (const sig of signals) {
      if (sig?.category) keywords.add(String(sig.category).trim());
      if (typeof sig?.text === 'string') {
        const cleanedSig = sig.text.replace(/[[\]().,!?"'~]/g, ' ').trim();
        for (const part of cleanedSig.split(/\s+/)) {
          if (part.length >= 2 && part.length <= 24 && !KOREAN_STOPWORDS.has(part)) {
            keywords.add(part.toLowerCase());
          }
        }
      }
    }
  }

  // 2. URL 호스트명 추출
  const urlMatches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  for (const rawUrl of urlMatches) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host) keywords.add(host);
    } catch {
      // 잘못된 URL 형식은 무시
    }
  }

  // 3. 본문에서 의미 있는 한국어·영문 토큰 추출
  const tokens = String(text || '')
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, ' ')
    .replace(/[^가-힣a-zA-Z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 20);

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (KOREAN_STOPWORDS.has(lower)) continue;
    keywords.add(lower);
    if (keywords.size >= 12) break;
  }

  return Array.from(keywords).slice(0, 12);
}

/**
 * 후보 사례 목록에서 입력 문구와 가장 유사한 상위 사례를 점수순으로 정렬합니다.
 * @param {string} queryText 사용자가 입력한 텍스트
 * @param {Array} candidates DB에서 조회한 후보 사례 배열
 * @param {number} [limit=3] 반환할 최대 사례 수
 * @returns {Array} 유사도가 높은 순으로 정렬된 사례 배열
 */
export function rankSimilarCases(queryText, candidates, limit = 3) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const queryKeywords = new Set(extractSearchKeywords(queryText));
  const queryNorm = String(queryText || '')
    .trim()
    .replace(/\s+/g, ' ');

  const scored = candidates
    .map((item) => {
      const candidateText = String(item?.masked_text || '');
      const candidateNorm = candidateText.trim().replace(/\s+/g, ' ');
      // 완전히 동일한 원문은 캐시 경로에서 이미 처리되므로 RAG 예시에서는 제외 가능
      const isExactSame = queryNorm && candidateNorm && queryNorm === candidateNorm;

      const candidateKeywords = Array.isArray(item?.keywords)
        ? item.keywords.map((k) => String(k).toLowerCase())
        : extractSearchKeywords(candidateText);

      let overlap = 0;
      for (const kw of candidateKeywords) {
        if (queryKeywords.has(kw) || candidateText.toLowerCase().includes(kw) && queryNorm.toLowerCase().includes(kw)) {
          overlap += 1;
        }
      }

      // 키워드 배열이 비어 있더라도 질의 키워드가 후보 원문에 포함되면 가점 부여
      for (const qk of queryKeywords) {
        if (candidateText.toLowerCase().includes(qk)) {
          overlap += 0.6;
        }
      }

      return {
        item,
        score: isExactSame ? -1 : overlap
      };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

/**
 * RAG로 검색된 과거 판별 사례를 Gemma 4 판별 프롬프트용 참고 텍스트로 포맷팅합니다.
 * @param {Array} cases 유사 사례 배열
 * @returns {string} 프롬프트에 삽입할 참고 사례 블록
 */
export function formatRagExamplesForPrompt(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return '';

  const lines = cases.slice(0, 3).map((item, idx) => {
    const snippet = String(item.masked_text || '').replace(/\s+/g, ' ').slice(0, 260);
    const sigTexts = Array.isArray(item.signals)
      ? item.signals
          .slice(0, 3)
          .map((s) => (s?.text ? `"${s.text}"(${s.category || '신호'})` : ''))
          .filter(Boolean)
          .join(', ')
      : '';
    return [
      `사례 ${idx + 1} [${item.risk_level || '주의'} / ${item.scam_type || '기타'} / ${item.risk_score ?? 50}점 / 입력:${item.input_type || 'text'}]`,
      `- 비식별 문구: ${snippet}`,
      sigTexts ? `- 주요 신호: ${sigTexts}` : '',
      item.summary ? `- 판별 요약: ${String(item.summary).slice(0, 140)}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `[Supabase 누적 유사 판별 사례 (RAG 참고용 — 일관된 기준 적용에 참고)]\n${lines.join('\n\n')}`;
}

/**
 * Supabase에 저장된 사례를 훈련 모드(/api/train) 프롬프트용 안전 패턴 참고 문구로 변환합니다.
 * 실제 기관명·URL·전화번호가 훈련 출력에 섞이지 않도록 sanitizeTrainingText를 반드시 통과시킵니다.
 * @param {Array} cases 최근 동일 유형 사례 배열
 * @returns {string} 훈련 프롬프트에 삽입할 안전 수법 패턴 블록
 */
export function formatTrainReferencePatterns(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return '';

  const lines = cases.slice(0, 2).map((item, idx) => {
    const safeText = sanitizeTrainingText(String(item.masked_text || '')).slice(0, 220);
    const safeSummary = sanitizeTrainingText(String(item.summary || '')).slice(0, 140);
    return `참고 패턴 ${idx + 1} (${item.scam_type || '스미싱'}): ${safeText}${safeSummary ? ` — 핵심: ${safeSummary}` : ''}`;
  });

  return `[Supabase 누적 최신 수법 참고 (반드시 가상 명칭·example.com·가상 번호로만 재구성)]\n${lines.join('\n')}`;
}

/**
 * Supabase PostgREST 요청을 수행하는 내부 fetch 래퍼입니다.
 * 타임아웃(2.5초)을 두어 DB 지연이 메인 AI 분석 응답을 멈추지 않도록 보호합니다.
 */
async function supabaseRequest(pathWithQuery, options = {}, fetchImpl = fetch) {
  const { url, key, configured } = getSupabaseConfig();
  if (!configured) {
    return { ok: false, configured: false, status: 0, data: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetchImpl(`${url}/rest/v1/${pathWithQuery}`, {
      method: options.method || 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const contentRange = response.headers?.get?.('content-range') || '';
    let data = null;
    const rawText = await response.text().catch(() => '');
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
    }

    return {
      ok: response.ok,
      configured: true,
      status: response.status,
      contentRange,
      data
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      configured: true,
      status: 0,
      error: error?.message || 'Supabase 요청 시간 초과 또는 네트워크 오류',
      data: null
    };
  }
}

/**
 * 동일한 비식별 문구 해시가 이미 Supabase에 저장되어 있는지 조회합니다(API 한도 절약용 캐시).
 * @param {string} sourceHash SHA-256 해시
 * @param {Function} [fetchImpl=fetch] 테스트 주입용 fetch 함수
 * @returns {Promise<object|null>} 기존 저장 사례 또는 null
 */
export async function findExactCaseByHash(sourceHash, fetchImpl = fetch) {
  if (!sourceHash || !isSupabaseConfigured()) return null;

  const query = `${TABLE_NAME}?select=id,input_type,masked_text,risk_score,risk_level,scam_type,summary,easy_summary,signals,advice,model,hit_count,created_at&source_hash=eq.${encodeURIComponent(sourceHash)}&limit=1`;
  const res = await supabaseRequest(query, { method: 'GET' }, fetchImpl);
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
    return null;
  }

  const hit = res.data[0];

  // 조회수(hit_count) 증가는 비동기 최선 시도로 처리
  if (hit?.id) {
    supabaseRequest(
      `${TABLE_NAME}?id=eq.${hit.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { hit_count: Number(hit.hit_count || 1) + 1 }
      },
      fetchImpl
    ).catch(() => {});
  }

  return hit;
}

/**
 * 입력 문구와 유사한 과거 판별 사례를 Supabase에서 검색해 상위 N건을 반환합니다.
 * @param {string} queryText 입력 텍스트
 * @param {number} [limit=3] 반환할 최대 건수
 * @param {Function} [fetchImpl=fetch] 테스트 주입용 fetch 함수
 * @returns {Promise<Array>} 유사 사례 배열
 */
export async function findSimilarCases(queryText, limit = 3, fetchImpl = fetch) {
  if (!queryText || !isSupabaseConfigured()) return [];

  const keywords = extractSearchKeywords(queryText);
  let candidates = [];

  // 1차: 키워드 배열 겹침(overlap) 검색
  if (keywords.length > 0) {
    const pgArray = `{${keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(',')}}`;
    const overlapQuery = `${TABLE_NAME}?select=id,input_type,masked_text,keywords,risk_score,risk_level,scam_type,summary,signals,created_at&keywords=ov.${encodeURIComponent(pgArray)}&order=created_at.desc&limit=15`;
    const overlapRes = await supabaseRequest(overlapQuery, { method: 'GET' }, fetchImpl);
    if (overlapRes.ok && Array.isArray(overlapRes.data)) {
      candidates = overlapRes.data;
    }
  }

  // 2차: 겹침 검색 결과가 부족하면 최근 사례 15건에서 추가 매칭
  if (candidates.length < limit) {
    const recentQuery = `${TABLE_NAME}?select=id,input_type,masked_text,keywords,risk_score,risk_level,scam_type,summary,signals,created_at&order=created_at.desc&limit=15`;
    const recentRes = await supabaseRequest(recentQuery, { method: 'GET' }, fetchImpl);
    if (recentRes.ok && Array.isArray(recentRes.data)) {
      const seenIds = new Set(candidates.map((c) => c.id));
      for (const row of recentRes.data) {
        if (!seenIds.has(row.id)) candidates.push(row);
      }
    }
  }

  return rankSimilarCases(queryText, candidates, limit);
}

/**
 * 훈련 모드(/api/train)에서 참고할 최근 동일 유형 스미싱 사례를 조회합니다.
 * @param {string} scamType 사기 유형
 * @param {number} [limit=2] 최대 조회 수
 * @param {Function} [fetchImpl=fetch] 테스트 주입용 fetch 함수
 * @returns {Promise<Array>} 최근 사례 배열
 */
export async function fetchRecentCasesByType(scamType, limit = 2, fetchImpl = fetch) {
  if (!isSupabaseConfigured()) return [];

  const query = `${TABLE_NAME}?select=id,scam_type,masked_text,summary,risk_level,created_at&scam_type=eq.${encodeURIComponent(scamType)}&risk_level=in.(%22위험%22,%22주의%22)&order=created_at.desc&limit=${limit}`;
  const res = await supabaseRequest(query, { method: 'GET' }, fetchImpl);
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
    return res.data;
  }

  // 해당 유형 사례가 아직 없으면 최근 위험 사례 1~2건으로 대체 참고
  const fallbackQuery = `${TABLE_NAME}?select=id,scam_type,masked_text,summary,risk_level,created_at&risk_level=in.(%22위험%22,%22주의%22)&order=created_at.desc&limit=${limit}`;
  const fallbackRes = await supabaseRequest(fallbackQuery, { method: 'GET' }, fetchImpl);
  return fallbackRes.ok && Array.isArray(fallbackRes.data) ? fallbackRes.data : [];
}

/**
 * 텍스트 또는 캡처 이미지에서 추출된 텍스트를 비식별 마스킹한 뒤 Supabase에 저장(upsert)합니다.
 * @param {object} params 저장 파라미터
 * @param {'text'|'image'|'mixed'} params.inputType 입력 유형
 * @param {string} params.rawText 원문 또는 이미지 OCR 추출 텍스트
 * @param {object} params.result 정규화된 판별 결과
 * @param {string} [params.model] 사용된 모델명
 * @param {Function} [fetchImpl=fetch] 테스트 주입용 fetch 함수
 * @returns {Promise<{ configured: boolean, saved: boolean, skippedReason?: string, maskedText?: string }>}
 */
export async function saveAnalyzedCase({ inputType, rawText, result, model = '' }, fetchImpl = fetch) {
  if (!isSupabaseConfigured()) {
    return { configured: false, saved: false, skippedReason: 'SUPABASE_NOT_CONFIGURED' };
  }

  const maskedText = sanitizeTextForStorage(rawText || result?.extracted_text || '');
  if (maskedText.length < 4) {
    return { configured: true, saved: false, skippedReason: 'TEXT_TOO_SHORT' };
  }

  const sourceHash = computeNormalizedHash(maskedText);
  const keywords = extractSearchKeywords(maskedText, result?.signals);

  const payload = {
    input_type: ['text', 'image', 'mixed'].includes(inputType) ? inputType : 'text',
    source_hash: sourceHash,
    masked_text: maskedText,
    keywords,
    risk_score: Number(result?.risk_score ?? 50),
    risk_level: result?.risk_level || '주의',
    scam_type: result?.scam_type || '기타',
    summary: sanitizeTextForStorage(result?.summary || ''),
    easy_summary: sanitizeTextForStorage(result?.easy_summary || ''),
    signals: Array.isArray(result?.signals)
      ? result.signals.map((sig) => ({
          text: sanitizeTextForStorage(sig?.text || ''),
          category: sig?.category || '긴급성',
          reason: sanitizeTextForStorage(sig?.reason || '')
        }))
      : [],
    advice: Array.isArray(result?.advice) ? result.advice.slice(0, 5) : [],
    model: String(model || '')
  };

  const res = await supabaseRequest(
    `${TABLE_NAME}?on_conflict=source_hash`,
    {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: payload
    },
    fetchImpl
  );

  if (!res.ok) {
    return {
      configured: true,
      saved: false,
      skippedReason: res.error || `HTTP_${res.status}`,
      maskedText
    };
  }

  return {
    configured: true,
    saved: true,
    maskedText,
    sourceHash
  };
}

/**
 * 누적된 비식별 판별 사례 목록 및 요약 통계를 Supabase에서 조회합니다.
 * @param {object} [options] 조회 옵션
 * @param {number} [options.limit=8] 최대 조회 개수
 * @param {string} [options.scamType=''] 필터링할 사기 유형
 * @param {Function} [fetchImpl=fetch] 테스트 주입용 fetch 함수
 * @returns {Promise<{ configured: boolean, totalCount: number, imageConvertedCount: number, cases: Array }>}
 */
export async function listStoredCases({ limit = 8, scamType = '' } = {}, fetchImpl = fetch) {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      totalCount: 0,
      imageConvertedCount: 0,
      cases: []
    };
  }

  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 8));
  const typeFilter = scamType ? `&scam_type=eq.${encodeURIComponent(scamType)}` : '';

  // 목록 + 전체 건수(content-range 헤더) 동시 조회
  const listRes = await supabaseRequest(
    `${TABLE_NAME}?select=id,created_at,input_type,masked_text,keywords,risk_score,risk_level,scam_type,summary,hit_count${typeFilter}&order=created_at.desc&limit=${safeLimit}`,
    {
      method: 'GET',
      headers: { Prefer: 'count=exact' }
    },
    fetchImpl
  );

  // 이미지 변환 저장 건수 별도 카운트 조회
  const imgCountRes = await supabaseRequest(
    `${TABLE_NAME}?select=id&input_type=in.(image,mixed)&limit=1`,
    {
      method: 'GET',
      headers: { Prefer: 'count=exact' }
    },
    fetchImpl
  );

  const parseTotalFromRange = (rangeHeader, fallbackLen) => {
    const match = String(rangeHeader || '').match(/\/(\d+)$/);
    return match ? Number(match[1]) : fallbackLen;
  };

  if (!listRes.ok) {
    return {
      configured: true,
      queryError: listRes.error || `HTTP_${listRes.status}`,
      totalCount: 0,
      imageConvertedCount: 0,
      cases: []
    };
  }

  const cases = Array.isArray(listRes.data) ? listRes.data : [];
  const totalCount = parseTotalFromRange(listRes.contentRange, cases.length);
  const imageConvertedCount = imgCountRes.ok
    ? parseTotalFromRange(imgCountRes.contentRange, 0)
    : cases.filter((c) => c.input_type === 'image' || c.input_type === 'mixed').length;

  return {
    configured: true,
    totalCount,
    imageConvertedCount,
    cases
  };
}
