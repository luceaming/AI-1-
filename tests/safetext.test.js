/**
 * SafeText Trainer 핵심 순수 로직 단위 테스트 (node:test 사용)
 * - JSON 파싱·복구, 점수-등급 보정, 위험 신호 원문 대조(환각 제거),
 *   훈련 모드 안전 규칙 정화(예약 도메인·가상 번호·가상 기관명), 개인정보 마스킹을 검증합니다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractJsonObject,
  reconcileRiskScoreAndLevel,
  verifySignalsInSource,
  validateAndNormalizeAnalyzeResult,
  sanitizeTrainingText,
  validateAndNormalizeTrainResult
} from '../api/_openrouter.js';
import {
  generateSignalSampleSvg,
  BACKUP_SIGNAL_SAMPLES,
  GEMMA_MODEL_SLUG
} from '../api/signal-sample.js';
import {
  sanitizeTextForStorage,
  computeNormalizedHash,
  extractSearchKeywords,
  rankSimilarCases,
  formatRagExamplesForPrompt,
  formatTrainReferencePatterns,
  saveAnalyzedCase,
  findSimilarCases,
  listStoredCases
} from '../api/_supabase.js';
import {
  maskPersonalInfo,
  getBackupScenario,
  BACKUP_TRAINING_SCENARIOS,
  resetSessionStats,
  buildSignalSampleSvg,
  CLIENT_SIGNAL_SAMPLES,
  formatCaseInputTypeLabel,
  buildCaseExcerpt,
  state
} from '../script.js';

test('extractJsonObject는 코드 펜스나 설명 문구가 섞인 모델 응답에서도 JSON을 추출한다', () => {
  const raw = '분석 결과입니다:\n```json\n{"risk_score": 88, "risk_level": "위험"}\n```\n참고하세요.';
  const parsed = extractJsonObject(raw);
  assert.equal(parsed.risk_score, 88);
  assert.equal(parsed.risk_level, '위험');
});

test('reconcileRiskScoreAndLevel은 점수와 등급의 일관성을 보정한다', () => {
  assert.deepEqual(reconcileRiskScoreAndLevel(92), { risk_score: 92, risk_level: '위험' });
  assert.deepEqual(reconcileRiskScoreAndLevel(45), { risk_score: 45, risk_level: '주의' });
  assert.deepEqual(reconcileRiskScoreAndLevel(12), { risk_score: 12, risk_level: '안전' });
  assert.deepEqual(reconcileRiskScoreAndLevel(150), { risk_score: 100, risk_level: '위험' });
});

test('verifySignalsInSource는 입력 원문에 없는 환각 문구를 하이라이트에서 제외한다', () => {
  const source = '[○○기관] 오늘까지 https://example.com/check 확인 바랍니다.';
  const signals = [
    { text: '[○○기관]', category: '기관사칭', reason: '기관 사칭' },
    { text: '없는 문구입니다', category: '긴급성', reason: '환각 테스트' },
    { text: 'https://example.com/check', category: 'URL', reason: '외부 URL 포함' }
  ];

  const verified = verifySignalsInSource(signals, source);
  assert.equal(verified.length, 2);
  assert.equal(verified[0].text, '[○○기관]');
  assert.equal(verified[1].text, 'https://example.com/check');
});

test('validateAndNormalizeAnalyzeResult는 점수가 90인데 등급이 안전으로 온 경우 위험으로 보정한다', () => {
  const source = '긴급 확인 https://example.com/a';
  const normalized = validateAndNormalizeAnalyzeResult(
    {
      risk_score: 90,
      risk_level: '안전',
      scam_type: '기관사칭',
      signals: [{ text: '긴급 확인', category: '긴급성', reason: '긴급 유도' }]
    },
    source
  );

  assert.equal(normalized.risk_score, 90);
  assert.equal(normalized.risk_level, '위험');
  assert.equal(normalized.signals.length, 1);
});

test('sanitizeTrainingText는 실제 URL·전화번호·실제 기관명을 안전 규칙에 맞게 치환한다', () => {
  const unsafe =
    '[검찰청] 긴급 안내입니다. http://bad-phish.kr/login 으로 접속하거나 010-1234-5678, 계좌 110-123-456789 로 연락하세요. 국민은행 확인 필요.';
  const safe = sanitizeTrainingText(unsafe);

  assert.equal(safe.includes('bad-phish.kr'), false);
  assert.equal(safe.includes('010-1234-5678'), false);
  assert.equal(safe.includes('110-123-456789'), false);
  assert.equal(safe.includes('검찰청'), false);
  assert.equal(safe.includes('국민은행'), false);
  assert.equal(safe.includes('example.com'), true);
  assert.equal(safe.includes('000-0000-0000'), true);
  assert.equal(safe.includes('○○기관'), true);
  assert.equal(safe.includes('○○은행'), true);
});

test('validateAndNormalizeTrainResult는 안전 선택지만 best_choices로 허용한다', () => {
  const result = validateAndNormalizeTrainResult(
    {
      scam_type: '택배',
      difficulty: '쉬움',
      message: '[우체국택배] 배송 확인 https://evil-domain.com',
      best_choices: ['링크 누르기', '삭제하기'],
      signals: [{ text: '배송 확인', category: '긴급성', reason: '확인 유도' }],
      explanation: '링크 누르지 마세요.'
    },
    '택배',
    '쉬움'
  );

  assert.equal(result.choices.length, 5);
  assert.deepEqual(result.best_choices, ['삭제하기']);
  assert.equal(result.message.includes('evil-domain.com'), false);
  assert.equal(result.message.includes('우체국택배'), false);
});

test('maskPersonalInfo는 로컬에서 전화번호와 계좌번호를 마스킹한다', () => {
  const input = '연락처 010-9876-5432, 계좌 3333-01-1234567 확인';
  const masked = maskPersonalInfo(input);
  assert.equal(masked.includes('010-9876-5432'), false);
  assert.equal(masked.includes('3333-01-1234567'), false);
  assert.equal(masked.includes('[전화번호]'), true);
  assert.equal(masked.includes('[계좌번호]'), true);
});

test('getBackupScenario는 난이도(쉬움, 보통, 어려움)에 따라 각각 다른 가상 문자를 반환한다', () => {
  const types = ['기관사칭', '택배', '지원금', '지인사칭', '대출'];
  const difficulties = ['쉬움', '보통', '어려움'];

  for (const scamType of types) {
    const easyScenario = getBackupScenario(scamType, '쉬움');
    const normalScenario = getBackupScenario(scamType, '보통');
    const hardScenario = getBackupScenario(scamType, '어려움');

    // 1. 각 난이도 객체의 difficulty가 요청과 일치하는지 확인
    assert.equal(easyScenario.difficulty, '쉬움');
    assert.equal(normalScenario.difficulty, '보통');
    assert.equal(hardScenario.difficulty, '어려움');

    // 2. 난이도별 가상 문자(message)가 서로 다른 고유한 내용인지 확인
    assert.notEqual(
      easyScenario.message,
      normalScenario.message,
      `${scamType}: 쉬움과 보통의 문자가 달라야 함`
    );
    assert.notEqual(
      normalScenario.message,
      hardScenario.message,
      `${scamType}: 보통과 어려움의 문자가 달라야 함`
    );
    assert.notEqual(
      easyScenario.message,
      hardScenario.message,
      `${scamType}: 쉬움과 어려움의 문자가 달라야 함`
    );

    // 3. 3개 난이도 모두에 대해 signals의 text가 message 본문 안에 온전히 존재하는지 검증
    for (const diff of difficulties) {
      const scenario = getBackupScenario(scamType, diff);
      assert.ok(scenario.signals.length > 0, `${scamType} ${diff} 신호가 최소 1개 이상 존재해야 함`);
      for (const sig of scenario.signals) {
        assert.ok(
          scenario.message.includes(sig.text),
          `[${scamType}-${diff}] 신호 "${sig.text}"가 본문에 포함되어야 함`
        );
      }
      // choices는 5개 표준 선택지인지 확인
      assert.equal(scenario.choices.length, 5);
      // best_choices는 유효한 대응인지 확인
      assert.ok(scenario.best_choices.length > 0);
    }
  }
});

test('getBackupScenario는 유효하지 않은 유형이나 난이도 요청 시 안전하게 기본값으로 폴백한다', () => {
  const fallback = getBackupScenario('이상한유형', '외계어');
  assert.equal(fallback.scam_type, '기관사칭');
  assert.equal(fallback.difficulty, '보통');
  assert.ok(fallback.message.length > 0);
});

test('resetSessionStats는 누적 점수, 정답률, 완료 수를 0으로 초기화한다', () => {
  // 임의의 점수 데이터 설정
  state.sessionStats = {
    score: 80,
    total: 4,
    correct: 3
  };

  resetSessionStats();

  assert.equal(state.sessionStats.score, 0);
  assert.equal(state.sessionStats.total, 0);
  assert.equal(state.sessionStats.correct, 0);
});

test('6대 위험 신호 기준(01~06) 예시 데이터가 모두 정의되어 있고 안전 규칙을 준수한다', () => {
  assert.equal(GEMMA_MODEL_SLUG, 'google/gemma-4-26b-a4b-it:free');
  const signalIds = ['01', '02', '03', '04', '05', '06'];

  for (const id of signalIds) {
    const serverSample = BACKUP_SIGNAL_SAMPLES[id];
    const clientSample = CLIENT_SIGNAL_SAMPLES[id];

    assert.ok(serverSample, `서버 샘플 ${id}가 존재해야 함`);
    assert.ok(clientSample, `클라이언트 샘플 ${id}가 존재해야 함`);

    // 안전 규칙 검증: 실제 URL 대신 example.com만 사용
    assert.ok(
      serverSample.message.includes('example.com'),
      `${id} 메시지는 example.com 예약 도메인을 사용해야 함`
    );
    assert.equal(
      serverSample.message.includes('010-'),
      false,
      `${id} 메시지에 실제 휴대폰 번호(010-)가 포함되지 않아야 함`
    );

    // SVG 이미지 생성 검증
    const svg = generateSignalSampleSvg(serverSample);
    assert.ok(svg.startsWith('<?xml'), 'SVG는 xml 선언으로 시작해야 함');
    assert.ok(svg.includes('<svg'), 'SVG 태그가 포함되어야 함');
    assert.ok(svg.includes('</svg>'), 'SVG 닫는 태그가 포함되어야 함');
    assert.ok(svg.includes(id), `SVG 내에 신호 ID "${id}"가 포함되어야 함`);

    // 클라이언트 SVG 생성 함수 검증
    const clientSvg = buildSignalSampleSvg(clientSample);
    assert.ok(clientSvg.includes('<svg'), '클라이언트 SVG 태그가 포함되어야 함');
  }
});

test('sanitizeTextForStorage는 개인정보(전화번호·계좌·주민번호·이메일)를 마스킹하면서 스미싱 URL 패턴은 유지한다', () => {
  const raw =
    '홍길동(900101-1234567)님 010-1234-5678 또는 110-123-456789, user@example.org 확인: https://phish-test.kr/go';
  const sanitized = sanitizeTextForStorage(raw);

  assert.equal(sanitized.includes('900101-1234567'), false);
  assert.equal(sanitized.includes('010-1234-5678'), false);
  assert.equal(sanitized.includes('110-123-456789'), false);
  assert.equal(sanitized.includes('user@example.org'), false);
  assert.equal(sanitized.includes('[주민번호]'), true);
  assert.equal(sanitized.includes('[전화번호]'), true);
  assert.equal(sanitized.includes('[계좌번호]'), true);
  assert.equal(sanitized.includes('[이메일]'), true);
  assert.equal(sanitized.includes('https://phish-test.kr/go'), true);
});

test('extractSearchKeywords와 rankSimilarCases는 입력 문구와 유사한 과거 사례를 우선순위로 찾는다', () => {
  const query = '[검찰청] 명의도용 출석요구서 확인 https://example.com/case';
  const keywords = extractSearchKeywords(query, [
    { text: '[검찰청]', category: '기관사칭' }
  ]);
  assert.ok(keywords.includes('기관사칭'));
  assert.ok(keywords.includes('example.com'));

  const candidates = [
    {
      id: 1,
      input_type: 'text',
      masked_text: '[○○택배] 배송지 불명확 주소 수정 바랍니다',
      keywords: ['택배', '배송지'],
      risk_score: 82,
      risk_level: '위험',
      scam_type: '택배'
    },
    {
      id: 2,
      input_type: 'image',
      masked_text: '[검찰청] 명의도용 사건번호 출석요구서 열람 https://example.com/case2',
      keywords: ['검찰청', '명의도용', '출석요구서', 'example.com'],
      risk_score: 94,
      risk_level: '위험',
      scam_type: '기관사칭'
    }
  ];

  const ranked = rankSimilarCases(query, candidates, 2);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 2);
});

test('formatRagExamplesForPrompt와 formatTrainReferencePatterns는 안전하게 프롬프트 컨텍스트를 생성한다', () => {
  const cases = [
    {
      input_type: 'image',
      risk_level: '위험',
      scam_type: '기관사칭',
      risk_score: 95,
      masked_text: '[검찰청] 즉시 확인 http://evil-phish.kr/login 문의 010-9999-8888',
      summary: '검찰 사칭 및 링크 유도',
      signals: [{ text: '[검찰청]', category: '기관사칭' }]
    }
  ];

  const analyzePrompt = formatRagExamplesForPrompt(cases);
  assert.ok(analyzePrompt.includes('Supabase 누적 유사 판별 사례'));
  assert.ok(analyzePrompt.includes('입력:image'));

  const trainPrompt = formatTrainReferencePatterns(cases);
  assert.equal(trainPrompt.includes('evil-phish.kr'), false);
  assert.equal(trainPrompt.includes('010-9999-8888'), false);
  assert.equal(trainPrompt.includes('검찰청'), false);
  assert.ok(trainPrompt.includes('example.com'));
  assert.ok(trainPrompt.includes('○○기관'));
});

test('saveAnalyzedCase와 findSimilarCases, listStoredCases는 Supabase PostgREST 응답을 처리하고 이미지 추출 텍스트도 저장한다', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

  const calls = [];
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });

    if (url.includes('on_conflict=source_hash')) {
      return {
        ok: true,
        status: 201,
        headers: new Map(),
        text: async () => JSON.stringify([{ id: 101 }])
      };
    }

    if (url.includes('input_type=in.')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-range', '0-0/1']]),
        text: async () => JSON.stringify([{ id: 101 }])
      };
    }

    return {
      ok: true,
      status: 200,
      headers: new Map([['content-range', '0-0/1']]),
      text: async () =>
        JSON.stringify([
          {
            id: 101,
            input_type: 'image',
            masked_text: '[○○택배] 배송 보류 확인 https://example.com/delivery',
            keywords: ['택배', '배송', 'example.com'],
            risk_score: 88,
            risk_level: '위험',
            scam_type: '택배',
            summary: '캡처 이미지에서 추출된 택배 사칭 문구입니다.',
            signals: [{ text: '배송 보류', category: '긴급성' }]
          }
        ])
    };
  };

  try {
    const saved = await saveAnalyzedCase(
      {
        inputType: 'image',
        rawText: '[CJ택배] 010-5555-6666 배송 보류 확인 https://example.com/delivery',
        result: {
          risk_score: 88,
          risk_level: '위험',
          scam_type: '택배',
          summary: '택배 사칭 이미지',
          easy_summary: '가짜 택배 문자',
          signals: [{ text: '배송 보류', category: '긴급성', reason: '조급함 유발' }],
          advice: ['링크 누르지 마세요.']
        },
        model: 'google/gemma-4-26b-a4b-it:free'
      },
      mockFetch
    );

    assert.equal(saved.configured, true);
    assert.equal(saved.saved, true);
    assert.equal(saved.maskedText.includes('010-5555-6666'), false);
    assert.equal(saved.maskedText.includes('[전화번호]'), true);
    assert.equal(calls[0].body.input_type, 'image');
    assert.equal(calls[0].body.source_hash, computeNormalizedHash(saved.maskedText));

    const similar = await findSimilarCases('택배 배송 보류 확인', 3, mockFetch);
    assert.equal(similar.length, 1);
    assert.equal(similar[0].input_type, 'image');

    const listed = await listStoredCases({ limit: 6 }, mockFetch);
    assert.equal(listed.configured, true);
    assert.equal(listed.totalCount, 1);
    assert.equal(listed.imageConvertedCount, 1);
    assert.equal(listed.cases.length, 1);
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('클라이언트 사례 라벨 및 축약 유틸리티가 올바르게 동작한다', () => {
  assert.equal(formatCaseInputTypeLabel('image'), '캡처 이미지 변환');
  assert.equal(formatCaseInputTypeLabel('mixed'), '텍스트+이미지 변환');
  assert.equal(formatCaseInputTypeLabel('text'), '텍스트 입력');
  assert.equal(buildCaseExcerpt('짧은 문장', 20), '짧은 문장');
  assert.equal(buildCaseExcerpt('가나다라마바사아자차카타파하', 5), '가나다라마…');
});

