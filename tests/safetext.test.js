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
import { maskPersonalInfo } from '../script.js';

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
